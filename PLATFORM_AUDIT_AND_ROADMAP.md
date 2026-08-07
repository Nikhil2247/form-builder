# FormBuilder — Platform Audit & Hardening Roadmap

**Audit date:** 2026-08-07
**Scope:** `form-builder-backend/` (NestJS 11 + Prisma 5 + Postgres + Redis/BullMQ + MinIO) and `frontend/` (Next.js 16 + React 19 + TanStack Query + Zustand + shadcn/Tailwind v4)
**Method:** Full read of the Prisma schema (1,084 lines), all 80 backend TS files, and the frontend's app router tree, hooks, API client, builder, and public form runner (156 files, ~21k LOC).

> **Note on verification:** Node was not on `PATH` inside my shell, so I could not execute `tsc`, the test suite, or the app. Every finding below is derived from reading the source, and I cite `file:line` so you can confirm each one. Where I say something "will not compile," treat it as "verify with `npm run build`" — I flag exactly why.

---

## 0. Executive summary

You have built a genuinely well-architected **skeleton**. The schema design (form versioning, JSONB payloads, pre-aggregated analytics, org-scoped everything), the async submission pipeline, the guard hierarchy, and the read/write Prisma split are all the right decisions — most projects at this stage don't have them. The documentation inside the schema is better than most production systems.

But there is a large gap between what the comments *describe* and what the code *does*. The headline finding:

> **The platform cannot currently serve a single public form end-to-end.** The frontend builder never calls `POST /organizations/:orgId/forms/:formId/publish`, so no `FormVersion` row is ever created. `getPublicForm()` requires `versions.length > 0` (`forms.service.ts:589`), so every public form URL 404s, and `SubmissionProcessor` throws `No published version for form` (`submission.processor.ts:31`) for every job that does get enqueued.

Beyond that, the three themes you asked about break down as follows.

| Theme | Current state | Verdict |
|---|---|---|
| **Robust** | Core happy paths coded; no answer validation, no form-access enforcement on submit, ~0 tests, several compile/runtime-breaking bugs | 🔴 Not production-ready |
| **Efficient** | Good ideas (queue, cache, read replica) undermined by per-request DB round-trips, a `COUNT(*)` on the hot ingest path, and 4× duplicated Prisma connection pools | 🔴 Will not survive load |
| **Secure** | Argon2id, hashed tokens, MFA, guards, helmet — solid foundation; but unauthenticated upload endpoint, webhook SSRF, in-memory rate limiter, no trust-proxy, plaintext secrets | 🟠 Foundation good, holes are serious |
| **Millions of requests** | Async ingest is the right shape; nothing else is horizontally safe yet | 🔴 ~50–200 RPS ceiling today |
| **Multi-tenant, multi-role** | Single-org-per-user is a **hard DB constraint**; roles are 3 fixed enum values | 🟠 Needs a structural change |

**Realistic effort to production-grade:** ~14–18 weeks for one senior full-stack engineer, or ~8–10 weeks for a team of three. The phased plan in §12 sequences this.

---

## 1. What actually exists today (verified inventory)

### 1.1 Backend modules

| Module | Controller routes | Status |
|---|---|---|
| `auth` | register, login, login/mfa, refresh, logout, verify-email, forgot/reset-password, mfa setup/verify/disable, me | Working, with gaps (§4) |
| `organizations` | me, get/update/delete org, members list/role/remove, invitations create/list/revoke/accept, audit-logs | Working |
| `forms` | CRUD, publish, clone, from-template, AI generate, trash/restore, submissions, export | Working, publish unused by UI |
| `public-forms` | get by slug, save/get draft, embed code | Working (blocked by missing versions) |
| `submissions` | `POST /forms/:formId/submit`, list by org | 🔴 No validation, no access control |
| `storage` | `POST /storage/presigned-url` | 🔴 **Unauthenticated** |
| `analytics` | global, per-form | Working, but `views`/`starts` never written |
| `webhooks` | create/list/delete per form | 🔴 SSRF, plaintext secret |
| `templates` | list, get by id | Public, unauthenticated (probably fine) |
| `admin` | dashboard, orgs, users, suspend/activate, quotas, audit-logs | Working |
| `audit` | (service only, no controller) | Working |
| `mail` | (service only) | Working |
| `lookup` | (service only, cache helper) | **Not used by any caller** |
| `health` | `/health` | Partial (§8.3) |

### 1.2 Schema models with **no API at all**

`Notification`, `FormComment`, `IntegrationConfig`, `ApiKey` (guard exists but no CRUD controller and the guard is applied to **zero** routes), `FormSubmissionFile` (written once, never verified/linked), `WebhookDelivery` (written, never read).

### 1.3 Frontend routes

- **Marketing:** `/`, about, contact, features, form-templates, pricing, privacy, terms, compliance
- **Auth:** login, signup, forgot-password, reset-password, mfa
- **Dashboard (viewer):** dashboard, forms, forms/[formId], forms/[formId]/submissions, submissions, analytics
- **Dashboard (editor):** forms/builder, integrations, trash
- **Dashboard (admin):** team, org-audit, settings/organization, settings/billing
- **Dashboard (super-admin):** platform, platform/organizations, platform/users, platform/audit-logs, global-audit
- **Shared:** profile, notifications, templates, invite/accept
- **Public:** `/f/[id]`

61 shadcn UI primitives, 13 builder components. That's a lot of surface already built.

---

## 2. 🔴 P0 — Blockers that break the product right now

### 2.1 No publish flow → the whole public path is dead

`forms.controller.ts:112` exposes `POST /:formId/publish`. A repo-wide grep of `frontend/src` for `publish` returns exactly one hit — a webhook event label string in `use-webhooks.ts:20`. The builder's `handleSaveChanges` (`builder/page.tsx:~224`) only `PUT`s to `/organizations/:orgId/forms/:formId`, which writes the *draft* columns `pagesJson`/`questionsJson`/`logicJson` and leaves `status: 'DRAFT'`.

Consequences, in order:
1. `FormVersion` table stays empty forever.
2. `getPublicForm()` (`forms.service.ts:589`) throws `NotFoundException` because `form.status !== 'PUBLISHED'` **and** `form.versions.length === 0`.
3. `/f/[slug]` server component gets a 404 and renders `notFound()`.
4. Even if you force `status`, `SubmissionProcessor` (`submission.processor.ts:25-31`) throws `No published version for form ${formId}` and every job burns its 5 retries into the failed set.

**Fix:** add a Publish action to `EnterpriseNavbar` that calls the publish endpoint with the current builder state, and surface published/draft status + a "you have unpublished changes" diff indicator.

### 2.2 `publishForm` is not atomic and can collide

```ts
// forms.service.ts:384-403
const nextVersion = form.currentVersion + (form.status === 'DRAFT' ? 0 : 1);
const version = await this.prisma.writer.formVersion.create({ ... });   // write 1
await this.prisma.writer.form.update({ ... currentVersion: nextVersion }); // write 2
```

Two problems:
- The two writes are not in a transaction. If write 2 fails, `currentVersion` and the actual versions diverge permanently.
- `nextVersion` is computed from a stale read. Two concurrent publishes both compute the same number and one dies on the `@@unique([formId, version])` constraint — surfacing as a raw 409 with a Prisma message, not a clean retry.

**Fix:** wrap in `$transaction` and derive the version from the row itself:

```ts
await this.prisma.writer.$transaction(async (tx) => {
  const form = await tx.form.update({
    where: { id: formId, organizationId: orgId, deletedAt: null },
    data: { status: 'PUBLISHED', currentVersion: { increment: 1 } },
  });
  return tx.formVersion.create({
    data: { formId, version: form.currentVersion, pagesJson, questionsJson, logicJson, themeJson },
  });
}, { isolationLevel: 'Serializable' });
```

Note this also changes semantics so version 1 is the first publish — update the `Form.currentVersion` default to `0`.

### 2.3 Submission worker binds to the wrong version

```ts
// submission.processor.ts:25-30
const formVersion = await this.prisma.reader.formVersion.findFirst({
  where: { form: { id: formId } },
  orderBy: { version: 'desc' },
```

This takes the *newest* version, not the version the respondent actually filled in. If someone publishes v2 while a respondent has v1 open, that respondent's answers get attributed to v2's question schema — silently corrupting the exact guarantee the versioning system exists to provide.

**Fix:** the client must send `formVersionId` (it's already in the public form payload), the API must validate it belongs to the form, and the worker must use it verbatim.

### 2.4 Zero server-side answer validation

```ts
// submit-form.dto.ts
export class SubmitFormDto {
  @IsObject() answers: Record<string, any>;
  ...
}
```

That is the entire contract. Nothing checks:
- that required questions are answered
- that answer types match question types (a `NUMBER` can receive `{"a": [1,2,3]}`)
- that choice answers are members of the question's option set
- that string lengths, number ranges, or date bounds are respected
- that the answer keys correspond to *any* question on the form

Express's default 100 KB body limit is the only thing standing between you and arbitrary JSONB garbage. At scale that's 100 KB × millions of rows of unqueryable junk, plus a trivially poisoned export/analytics pipeline.

**Fix:** build a `AnswerValidator` service that compiles the `FormVersion.questionsJson` into a validation plan (cache it — versions are immutable, `LookupService.getFormVersion` already does this and is currently unused), and run it **synchronously in the API** before enqueueing, so the respondent gets a real field-level error response instead of a silent queue failure.

### 2.5 The submit endpoint ignores every form access control

`submissions.service.ts:16-87` checks the honeypot, the CAPTCHA, and the monthly org quota. It does **not** check:

| Field | Consequence of not checking |
|---|---|
| `form.status` | Anyone can submit to `DRAFT`, `ARCHIVED`, or `CLOSED` forms |
| `form.deletedAt` | Submissions accepted into trashed forms |
| `form.expiresAt` | Expiry date is decorative |
| `form.maxSubmissions` | Cap is never enforced; form never auto-closes |
| `form.requireAuth` | "Internal only" forms are public |
| `form.isPasswordProtected` / `passwordHash` | Password gate is never verified server-side |
| `form.allowMultiple` | Duplicate prevention never happens (the `respondentIpHash` is computed but never compared) |
| `organization.isActive` | Suspended orgs keep ingesting |

`getPublicForm` checks *some* of these on the read path, which means the protection is purely cosmetic — the write path is wide open to anyone with a `formId`.

### 2.6 `exportSubmissions` reads a column that doesn't exist

```ts
// forms.service.ts:485
sub.ipAddress || '',
```

`FormSubmission` has `respondentIpHash`, `userAgent`, `country` — there is no `ipAddress` field (schema `:684-735`). Under `noImplicitAny` + Prisma's generated types this is a compile error; run `npm run build` to confirm. Either way, CSV export is broken.

Separately, the same function loads **every submission for the form into memory with no `take`** (`forms.service.ts:460`) and builds one giant string. A form with 500k responses will OOM the pod. Export must be a streamed, cursor-paginated background job (§6.5).

### 2.7 Storage provider enum mismatch — S3 mode is completely broken

```ts
// storage.service.ts:73
provider: storageWrapper.type === 's3' ? 'AWS_S3' : 'MINIO',
```

The Prisma enum is `enum StorageProvider { MINIO S3 }` (schema `:154-157`). `'AWS_S3'` is not a member, so every presign in S3 mode throws a Prisma validation error at the `.create()`.

### 2.8 Submission search crashes

```ts
// submissions.service.ts:99-101
where.OR = [{ submissionId: { contains: search, mode: 'insensitive' } }];
```

`FormSubmission` has no `submissionId` column (the PK is `id`). Any request with `?search=` throws. It also does the wrong thing conceptually — users want to search *answer content*, which is what the GIN index in `prisma/sql/add_gin_index.sql` was built for.

### 2.9 Registration sends the wrong email

```ts
// auth.service.ts:147
this.mailService.sendPasswordResetEmail(result.user.email, verifyUrl).catch(console.error);
// We'd want a proper sendVerificationEmail here in reality, but leveraging this for now
```

New users receive "Reset your FormBuilder password" containing a `/verify-email?token=...` link. Also: the frontend has no `/verify-email` route at all, so the link 404s, and `emailVerified` is never enforced anywhere.

---

## 3. 🔴 P0 — Security findings

### 3.1 The presigned-upload endpoint has no authentication and no rate limit

```ts
// storage.controller.ts — complete file, no @UseGuards, no @Throttle
@Controller('storage')
export class StorageController {
  @Post('presigned-url')
  async getPresignedUrl(@Body() body: {...}) { ... }
}
```

Anyone who knows a published `formId` can mint unlimited 15-minute presigned `PUT` URLs and write arbitrary objects into your bucket. Compounding factors:

- **`fileSizeMb` is a client-supplied number that is never enforced.** MinIO's `presignedPutObject` does not bind `Content-Length`, so a client declaring `0.001` MB can upload 5 GB.
- **No MIME allowlist.** The schema doc (`:750`) claims "MIME type is in the allowlist"; the code has no such check. An attacker uploads `.html`/`.svg` and, if the bucket is ever served publicly, gets stored XSS on your domain.
- **`MAX_FILE_SIZE_MB` (default 25) is ignored** in favour of a hardcoded `> 50` check (`storage.service.ts:14`).
- **`storageUsedBytes` is never incremented anywhere in the codebase**, so the quota check on `storage.service.ts:44` compares against a permanent `0`. The quota can never trip.
- **Files are never linked to a submission.** `FormSubmissionFile.submissionId` stays `NULL` forever — nothing in `SubmissionProcessor` resolves file IDs from the answers payload. Orphaned objects accumulate with no reaper.
- **Files are never verified.** `StorageVerifierProcessor` exists but is **not registered in `storage.module.ts` providers** — it's dead code. It also declares `@Processor(QUEUE_NAMES.WEBHOOKS)` with a comment admitting the author didn't want to make a queue; if you ever do register it, it will compete with `WebhooksProcessor` for webhook jobs and fail all of them.

**Fix:** require auth (JWT for dashboard uploads, a short-lived respondent token issued by `GET /public-forms/:slug` for public uploads), enforce a per-question MIME + size allowlist from the form version, apply `@Throttle`, use `PostObject` policy conditions (S3) / server-side size verification (MinIO `statObject` in the verify worker), and increment `storageUsedBytes` transactionally on verification.

### 3.2 Webhook SSRF

`webhooks.service.ts:29` accepts any user-supplied `url` string with no validation, and `webhooks.processor.ts:24` `fetch`es it from inside your network with a 10s timeout.

An org admin can register `http://169.254.169.254/latest/meta-data/iam/security-credentials/` (AWS IMDS), `http://localhost:9001` (MinIO console), `http://postgres:5432`, or any internal service — and the response body is **stored verbatim in `WebhookDelivery.responseBody`** (2000 chars) and readable back via the API. That is a full cloud-credential exfiltration primitive handed to any paying customer.

**Fix:**
```ts
// Validate at creation AND re-resolve at delivery time (DNS rebinding defence)
const url = new URL(raw);
if (url.protocol !== 'https:') throw new BadRequestException('HTTPS required');
const { address } = await dns.promises.lookup(url.hostname);
if (ipaddr.parse(address).range() !== 'unicast') throw new BadRequestException('Private address');
// then fetch with redirect: 'manual' and re-validate every hop
```
Also: cap `responseBody` to a status line + content-type, never the body. Better still, route all outbound webhooks through a dedicated egress proxy with an allowlist.

### 3.3 Webhook secrets are stored in plaintext and leaked to the API

Schema comment (`:886`): *"Stored encrypted at rest."* Reality: `webhooks.service.ts:32` stores `crypto.randomBytes(32).toString('hex')` raw, and `getWebhooks()` (`:57`) does a bare `findMany` that returns the `secret` field to every caller. Encrypt with an app-level KMS key (or at minimum `pgcrypto`), and `select` it out of all read paths.

### 3.4 Rate limiting is in-memory and proxy-blind

```ts
// app.module.ts:75-78
ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
```

Two independent failures:
1. **No Redis storage.** With N pods the real limit is N × 100/min, and every deploy resets all counters. Under a distributed attack the limiter is decorative.
2. **`app.set('trust proxy', ...)` is never called in `main.ts`.** Behind an ALB/nginx/Cloudflare, `req.ip` is the proxy's IP for *every* request, so the throttler buckets the entire internet into one key. The first 100 requests per minute succeed and everyone else gets 429 — a self-inflicted DoS. (Note `HttpLoggingInterceptor` and `SubmissionsController` read `x-forwarded-for` manually, so the logs will look fine while the throttler misbehaves.)

**Fix:**
```ts
// main.ts
app.getHttpAdapter().getInstance().set('trust proxy', 1);

// app.module.ts
ThrottlerModule.forRootAsync({
  useFactory: () => ({
    throttlers: [{ name: 'default', ttl: 60_000, limit: 100 }],
    storage: new ThrottlerStorageRedisService(process.env.REDIS_URL),
  }),
}),
```

### 3.5 No brute-force protection on auth endpoints

`login`, `login/mfa`, `forgot-password`, and `reset-password` inherit only the global 100/min. That allows ~144,000 password attempts per day per IP against a single account, and — worse — 100 attempts/min against a **6-digit TOTP code** (1M keyspace, `otplib`'s default ±1 step window makes it effectively ~3M/30s of valid codes over time). Add strict per-identifier throttles (`5/15min` on login keyed by email+IP, `5/5min` on MFA keyed by user), plus account lockout with exponential backoff and an alert email.

### 3.6 MFA secrets in plaintext; no backup codes

`users.mfa_secret` (schema `:393`) is a plain `VarChar(255)`. A read-only SQL injection or a leaked backup gives an attacker every user's TOTP seed. Encrypt at the application layer. Also add recovery codes (`MfaRecoveryCode` model, argon2-hashed, single-use) — without them, a lost phone means a support ticket for every user.

### 3.7 Refresh tokens rotate but have no reuse detection

`auth.service.ts:276-317` revokes the old token and issues a new one. Correct as far as it goes, but:
- A **stolen** refresh token used after the legitimate user has rotated will simply fail — you learn nothing and take no action. Implement token *families*: on presentation of an already-revoked token, revoke the entire family and force re-authentication. This is the standard OAuth BCP and it's ~20 lines.
- `logout` revokes only the presented token. There is no "sign out all devices" and no active-sessions UI, despite `RefreshToken.userAgent`/`ipAddress` being captured precisely for that (`:459-461`).
- Refresh TTL is hardcoded to 7 days in `generateTokens` (`:529`) while `JWT_REFRESH_TTL_DAYS` config exists and is ignored. Same for the 15m access TTL vs `JWT_ACCESS_TTL_SECONDS`.

### 3.8 Access token in `localStorage`

`use-auth.ts` writes `localStorage.setItem('access_token', ...)` on login, MFA login, and register. Any XSS anywhere in the app — including a stored-XSS payload in a form title or a submitted answer rendered without escaping — yields a token that works for 15 minutes and can be exfiltrated. `lib/api.ts` already supports an in-memory token (`memoryAccessToken`) and falls back to `localStorage`; finish that migration and rely on the HttpOnly refresh cookie + a silent refresh on mount.

### 3.9 Other security notes

- **CORS `allowedHeaders`** (`main.ts:39`) omits `X-Api-Key`, so the API-key path can never work cross-origin once you wire it up.
- **`helmet()` with defaults** sets a restrictive CSP that will block Swagger UI's inline scripts in any environment where you enable docs.
- **No body-size limits per route.** Set `app.use(json({ limit: '64kb' }))` globally with a larger override only where needed.
- **`ApiKeyGuard` caches for 5 minutes with no invalidation** (`api-key.guard.ts:11`). A revoked key keeps working for up to 5 minutes. It also skips the `expiresAt` check entirely on a cache hit (`:38-47`) — cache the expiry and check it, or set the Redis TTL to `min(300, secondsUntilExpiry)`.
- **`register()` lets anyone create an organization** with no email verification gate — free spam-org creation at scale.
- **Password policy is `MinLength(8)` only.** No breach-list check (`haveibeenpwned` k-anonymity API is one HTTP call), no complexity, no similarity-to-email check.
- **Audit logging is fire-and-forget with `.catch(console.error)`** (`audit.service.ts:50`). Compliance-grade audit trails cannot silently drop writes — enqueue them instead.
- **Audit logs never capture `ipAddress`** in practice: every `audit.log()` call site omits it, so the column is always `NULL`.

---

## 4. 🟠 Multi-tenancy — the structural problem

You asked specifically for "proper multitenant system with each tenant have multiple roles." Here is the honest gap.

### 4.1 A user can belong to exactly one organization — enforced in the database

```prisma
// schema.prisma:299-301
@@unique([organizationId, userId])
// SINGLE-ORG ENFORCEMENT: A user can only have one membership total
@@unique([userId])
```

This is load-bearing across the codebase: `getMyOrganization` uses `findUnique({ where: { userId } })`, `JwtStrategy` and `login` use `memberships: { take: 1 }`, and `acceptInvitation` explicitly rejects users who already belong to an org (`organizations.service.ts:~330`).

**What this blocks:** agencies managing multiple clients, consultants, contractors, a user who is ADMIN of their own workspace and VIEWER of a partner's, enterprise users spanning departments, and any "switch workspace" UX. It is the single most impactful structural limitation in the product.

**Migration path:**
1. Drop `@@unique([userId])`, keep `@@unique([organizationId, userId])`.
2. Add `User.lastActiveOrganizationId` for default-org selection.
3. Make `organizationId` an explicit part of the JWT **and** make every request resolve org context from the route (`:orgId`) — which `OrgMemberGuard` already does correctly, so most of the API needs no change.
4. Replace `/organizations/me` with `/organizations` (list all memberships) and add an org switcher to the frontend `Header`.
5. Rewrite `acceptInvitation` to allow joining additional orgs.

This is a ~2-day backend change and ~2-day frontend change if done before more code accretes around the assumption. It gets much more expensive later.

### 4.2 Roles are three hardcoded enum values

`OrgRole { ADMIN EDITOR VIEWER }` with a numeric hierarchy in `role.guard.ts:12-16`. That's clean and it works, but it cannot express:

- "Can view submissions but not export them" (a very common compliance requirement — VIEWER currently *can* export, per the schema comment on `:173`)
- "Can edit forms A and B but not C" (per-resource permissions)
- "Billing admin who cannot see submission data"
- Customer-defined roles, which every enterprise buyer will ask for

**Recommended target model** — permission-based RBAC with per-tenant custom roles, keeping the current enum as seeded system roles so nothing breaks:

```prisma
model Role {
  id             String   @id @default(uuid()) @db.Uuid
  organizationId String?  @map("organization_id") @db.Uuid  // NULL = system role
  key            String   @db.VarChar(50)                   // "admin", "billing_only"
  name           String   @db.VarChar(100)
  description    String?  @db.Text
  isSystem       Boolean  @default(false) @map("is_system")
  permissions    String[] @db.VarChar(80)                   // ["form:create", "submission:export", ...]

  members        OrganizationMember[]
  organization   Organization? @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([organizationId, key])
  @@map("roles")
}
```

with `OrganizationMember.roleId` alongside the existing `role` enum during migration. Then replace `@RequiredRole('ADMIN')` with `@RequirePermission('member:manage')` and have `PermissionGuard` check set membership. Ship a `permissions.ts` catalogue:

```
form:create form:read form:update form:delete form:publish form:share
submission:read submission:export submission:delete submission:moderate
member:invite member:manage member:remove
org:settings org:billing org:delete
webhook:manage apikey:manage integration:manage
audit:read analytics:read template:manage
```

Also add **per-resource ACLs** (`FormPermission { formId, userId?, roleId?, level }`) for "this team can only touch the HR forms" — the single most requested feature once orgs pass ~20 people.

### 4.3 Tenant isolation depends entirely on developers remembering a `where` clause

There is no structural enforcement. Every service hand-writes `where: { organizationId: orgId }`. It is done correctly in most places I read — but `storage.service.generatePresignedUrl` takes a `formId` from an unauthenticated request body and looks up the org *from the form*, with no check that the caller is entitled to it. That's the pattern of bug this design will keep producing.

**Two defence layers, both worth adding:**

**(a) Prisma client extension that injects `organizationId` automatically.** Use `AsyncLocalStorage` to carry tenant context set by `OrgMemberGuard`:

```ts
export const tenantScoped = Prisma.defineExtension((client) =>
  client.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const orgId = tenantContext.getStore()?.orgId;
          if (!orgId || !TENANT_SCOPED_MODELS.has(model)) return query(args);
          if (READ_OPS.has(operation)) {
            args.where = { ...args.where, organizationId: orgId };
          }
          return query(args);
        },
      },
    },
  }),
);
```

**(b) Postgres Row-Level Security** as the backstop, so even a raw `$queryRaw` mistake cannot cross tenants:

```sql
ALTER TABLE forms ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON forms
  USING (organization_id = current_setting('app.current_org_id', true)::uuid);
```
with `SET LOCAL app.current_org_id` issued at the start of each transaction. Note this requires session-mode pooling or careful `SET LOCAL` inside transactions — with PgBouncer in `transaction` mode (your `docker-compose.yml:35`) `SET LOCAL` inside an explicit transaction is safe.

### 4.4 Missing tenant infrastructure

| Missing | Why it matters at scale |
|---|---|
| Custom domains per tenant (`forms.acme.com`) | Table stakes for white-label; needs a `Domain` model + ACME cert automation |
| Per-tenant branding beyond form theme (email templates, logo on the fill page, "powered by" removal) | The main paid upgrade lever |
| SSO / SAML / OIDC per tenant | Blocks every enterprise deal above ~$20k ACV |
| SCIM user provisioning | Same |
| Tenant data export / deletion (GDPR Art. 15 & 17) | Legal requirement, not optional |
| Tenant-level encryption keys (BYOK) | Required for HIPAA/finance buyers |
| Data residency (EU/US region pinning) | Required for EU enterprise |
| Usage metering & billing (Stripe) | `settings/billing` page exists in the UI with **no backend at all** |
| Org transfer / merge / ownership handoff | Support burden without it |

---

## 5. 🔴 Efficiency & scale — what breaks first under load

Ranked by how soon each one hurts.

### 5.1 Four duplicate Prisma connection pools per pod

`PrismaModule` is `@Global()` (`prisma.module.ts:3`). But `PrismaService` is *also* listed in the `providers` array of `FormsModule` (`:9`), `SubmissionsModule` (`:16`), and `WebhooksModule` (`:14`). Nest creates a **separate instance** for each module-scoped provider, and each `PrismaService` constructor creates **two** `PrismaClient`s (writer + reader).

That's **8 Prisma clients per pod** instead of 2. With Prisma's default `connection_limit = num_cpus * 2 + 1` (≈9 on a 4-core box), that's ~72 Postgres connections per pod instead of ~18. At 20 pods you need 1,440 connections; Postgres defaults to `max_connections = 100`. You will hit `FATAL: sorry, too many clients already` long before you hit any interesting request rate.

**Fix (5 minutes, highest ROI in this document):** delete `PrismaService` from those three `providers` arrays. Same for `RedisService` in `FormsModule` — give it a `@Global() RedisModule`. Then set an explicit `?connection_limit=` on `DATABASE_URL` and route through the PgBouncer you already have in `docker-compose.yml`.

### 5.2 Two extra DB round-trips on every authenticated request

- `JwtStrategy.validate()` (`jwt.strategy.ts:26`) does a `user.findUnique` with a `memberships` join on **every single request**.
- `OrgMemberGuard.canActivate()` (`org-member.guard.ts:64`) then does a **second** query for the same membership.

At 5,000 RPS that's 10,000 extra queries/sec of pure overhead. Both are answering a question that changes maybe once a month.

**Fix:** one Redis-cached session document per user (`session:{userId}` → `{ systemRole, deletedAt, memberships: [...] }`, TTL 60s), invalidated on role change / membership change / suspension. Populate `request.user` and `request.orgMembership` from it in a single guard. This alone should roughly triple authenticated throughput.

### 5.3 A `COUNT(*)` over the whole org on the hot ingest path

```ts
// submissions.service.ts:60-65
const monthlyCount = await this.prisma.reader.formSubmission.count({
  where: { form: { organizationId: form.organizationId }, submittedAt: { gte: monthStart } }
});
```

This runs **on every public form submission**. It's a join from `form_submissions` to `forms` filtered by org, then an aggregate — there is no index that makes this cheap, because `form_submissions` has no `organization_id` column. At 1M submissions/month per org this is a multi-second query, executed synchronously before the 202 response. It is the hardest ceiling in the ingest path.

**Fix:** Redis counter with `INCR` + monthly-expiring key, reconciled nightly from the DB:

```ts
const key = `quota:sub:${orgId}:${yyyymm}`;
const used = await redis.incr(key);
if (used === 1) await redis.expire(key, 60 * 60 * 24 * 40);
if (used > maxSubmissionsMonth) { await redis.decr(key); throw new ForbiddenException(...); }
```

Also **denormalize `organizationId` onto `FormSubmission`**. It makes every org-scoped submission query (list, count, export, analytics, RLS policies) index-only instead of a join, and it's required for partitioning.

### 5.4 Workers run inside the API process

`SubmissionProcessor` (concurrency 20) and `WebhooksProcessor` (concurrency 10) are registered in modules loaded by `AppModule`, so **every API pod is also a worker**. A burst of 10k queued submissions will saturate the same event loop that's serving `/auth/me`, and you cannot scale ingest capacity independently from HTTP capacity.

**Fix:** a second entrypoint (`src/worker.ts`) using `NestFactory.createApplicationContext`, a `WORKER_MODE` env flag that conditionally registers processors, and a separate K8s Deployment with its own HPA keyed on queue depth.

### 5.5 Missing indexes and schema issues for scale

| Issue | Fix |
|---|---|
| `FormSubmission` has no `organizationId` | Add it + `@@index([organizationId, submittedAt(sort: Desc)])` |
| No partitioning despite the schema comment planning it (`:54-60`) | Declarative monthly `RANGE` partitioning on `submitted_at` before 5M rows; automate with `pg_partman` |
| `AuditLog` grows forever, "never deleted" (`:933`) | Partition by `created_at`, ship to cold storage after 90 days |
| `FormDraft` has no TTL/reaper | Abandoned drafts accumulate; add a nightly cleanup job |
| `WebhookDelivery` unbounded | Retain 30 days |
| `avg_completion_ms` upsert math is wrong (`submission.processor.ts:89`): `(existing + new)/2` is a recency-weighted EMA, not a mean | Store `sum_completion_ms BIGINT` + reuse `submissions` as the count; compute the average at read time |
| `FormAnalytics.views` and `starts` are **never written** by any code path | Add `POST /public-forms/:slug/track` (fire-and-forget, Redis-buffered, flushed by a cron worker) |
| `Organization.settings` JSONB with no GIN index | Add if you ever filter on it |

### 5.6 Caching is barely used

- `LookupService` is well-written (immutable form versions cached 24h, org settings 1h) and **is injected by nothing**. Wire it into `SubmissionProcessor` and `PublicFormsController`.
- `getPublicForm` caches for 300s in Redis (`forms.service.ts:607`) — good — but the cache key is only invalidated on publish (`:414`), not on `updateForm`, `deleteForm`, or slug change. A deleted form stays publicly fillable for 5 minutes.
- No HTTP-layer caching: `Cache-Control: public, max-age=300` is set on the public form route (`public-forms.controller.ts:9`) but there's no CDN in front, no `ETag`, and no stale-while-revalidate.
- The Next.js `/f/[slug]` page uses `next: { revalidate: 300 }` — reasonable, but the page is a dynamic server component doing a fetch on every cold request rather than ISR with `generateStaticParams` for hot forms.

### 5.7 What "millions of requests" actually requires

Assume the target is **10k submissions/sec peak, 100k form views/sec**.

| Layer | Needed |
|---|---|
| Edge | CDN (Cloudflare/Fastly) in front of `/f/*` — form definitions are static per version and should never touch your origin |
| Ingest | Separate, stateless "collector" service: validate → `XADD`/`LPUSH` to Redis → 202. No Postgres on this path at all |
| Queue | Redis Cluster or a partitioned BullMQ setup; single-instance Redis tops out around 100k ops/sec and is a SPOF |
| Workers | Autoscaled on queue depth; batch inserts (`createMany` of 100–500 submissions per transaction) instead of one INSERT per job |
| Database | Read replicas (the code is already split — you just need `DATABASE_REPLICA_URL` populated), PgBouncer transaction pooling, partitioned `form_submissions` |
| Analytics | Move off row-per-day upserts to a Redis counter flushed in batches, or ClickHouse/Timescale for real analytics |
| Storage | Direct-to-S3/MinIO already correct; add lifecycle policies |
| Observability | Prometheus metrics, OpenTelemetry traces, queue-depth alerts — currently **none** |

The single biggest architectural change: **the submit endpoint must not touch Postgres**. Today it does two queries (form lookup + monthly count) before enqueueing. Cache the form's ingest policy in Redis (keyed by `formId`, invalidated on publish/update) and the path becomes Redis-only.

---

## 6. Missing backend features

### 6.1 Modules that need to exist

| Module | Endpoints | Priority |
|---|---|---|
| **api-keys** | create/list/revoke/rotate; apply `ApiKeyGuard` + scope checks to a public v1 API | P1 |
| **notifications** | list/mark-read/mark-all/preferences; SSE or WebSocket stream | P1 |
| **comments** | CRUD + resolve on `FormComment` (model exists, no API) | P2 |
| **integrations** | OAuth flows + sync for `IntegrationConfig` (model exists, no API) | P2 |
| **billing** | Stripe subscriptions, plan → quota mapping, usage metering, invoices — the UI page exists with no backend | P1 |
| **exports** | Async export jobs (CSV/XLSX/PDF) → S3 → signed download link + email | P1 |
| **submissions (write ops)** | Currently read-only. Needs: get one, update/annotate, delete (soft), bulk delete, restore, moderate spam, tag, assign | P1 |
| **form-sharing** | Per-form ACLs, public share links with scoped tokens | P2 |
| **files** | List/download/delete submission files with org-scoped signed GET URLs (currently no download path exists at all) | P0 |

### 6.2 Submission pipeline hardening

- **Idempotency keys** on submit (`Idempotency-Key` header → Redis SETNX) so a retrying client doesn't double-submit. Currently `jobId: submissionId` gives BullMQ-level idempotency but the ID is generated server-side per request, so a client retry creates a new one.
- **Dead-letter queue** + an admin UI to inspect and replay failed jobs. `removeOnFail: false` (`bullmq.config.ts:12`) means failed jobs accumulate in Redis forever with nothing reading them.
- **Spam scoring** beyond the honeypot: submission velocity per IP hash, time-to-complete floor (a human can't fill 20 fields in 800ms), disposable-email detection, `FLAGGED_SPAM` status (the enum value exists and is never used).
- **Partial failure isolation:** if the email send throws, the whole job retries and re-inserts the submission. Split notification/webhook fan-out into their own queue jobs.
- **GeoIP country resolution** — `FormSubmission.country` exists and is never populated.
- **Quiz grading** currently only handles `SINGLE_CHOICE`/`DROPDOWN`/`MULTI_CHOICE` and compares against `o.label` (`submission.processor.ts:47`) while the frontend builder writes options with both `label` and `value`. Mismatch risk. No passing-threshold logic despite `isPassed` existing.

### 6.3 Form features worth building

| Feature | Why |
|---|---|
| **Payments** (Stripe/Razorpay field type) | Google Forms' single biggest gap; directly monetizable |
| **Approval workflows** (multi-step, conditional routing) | The enterprise differentiator vs Tally/Fillout |
| **Calculated fields & scoring formulas** | Quotes, estimators, assessments |
| **Lookup/prefill from prior submissions** | Portal use cases |
| **Partial/resume by email link** | `FormDraft` exists but is fingerprint-only, so a device switch loses everything |
| **Scheduling / booking field** | Calendly-style slot picking |
| **Address autocomplete, country/state cascades** | Basic but universally requested |
| **File upload with camera/scan on mobile** | Field-ops use cases |
| **Multi-language forms** | i18n per version |
| **A/B testing form variants** | Growth teams |
| **PDF generation from submissions** | Contracts, certificates, receipts |
| **e-Signature with audit trail** | `SIGNATURE` stores a base64 DataURL in JSONB today — that bloats every row and has no legal audit trail |
| **Webhooks: retries UI, replay, event filtering, `form.published` etc.** | Only `submission.created` is emitted despite the frontend listing more event types |

### 6.4 Compliance

Your `/compliance` marketing page exists. To back it up you need: GDPR data export & erasure endpoints, configurable retention policies per form, a DPA-supporting audit trail (append-only, tamper-evident), PII field tagging + encryption-at-rest for tagged fields, consent capture with versioned policy text, and — if you pursue healthcare — a HIPAA path with BAAs and PHI-scoped access logging.

### 6.5 Export needs to be a job, not a request

Current implementation loads everything into memory and builds a string. Replace with: `POST /forms/:id/exports` → 202 + jobId → worker streams a Postgres cursor into a CSV/XLSX writer piped to S3 → signed URL emailed and shown in-app. Also fixes the CSV injection risk (a cell starting with `=`, `+`, `-`, `@` executes in Excel — prefix with `'`), and the naive quoting on `forms.service.ts:488` which doesn't handle embedded newlines.

---

## 7. Frontend — gaps and efficiency changes

### 7.1 Correctness bugs

| # | Issue | Location |
|---|---|---|
| 1 | **Error messages never surface.** `fetchApi` reads `errorData?.message`, but the backend's filter returns `{ error: { statusCode, message, path } }`. Every failure shows the generic status-code fallback. | `lib/api.ts:~92` |
| 2 | **No publish action** (see §2.1) | `builder/page.tsx` |
| 3 | **Builder initialises from mock data.** `useState<FormConfig>(SAMPLE_FORMS[0])` means a failed load or a new form silently shows fake questions the user may then save. | `builder/page.tsx:71` |
| 4 | **Notifications page is 100% hardcoded** `INITIAL_NOTIFICATIONS` | `notifications/page.tsx:11` |
| 5 | **No `middleware.ts`** — zero server-side route protection. Every dashboard route is client-gated only; the HTML shell for `/platform/users` is served to anyone. | `frontend/src` |
| 6 | **Fingerprint is `Math.random()` in `localStorage`** — not a fingerprint. Clearing storage or opening incognito loses the draft, and it provides no duplicate-submission protection. | `FormRunnerClient.tsx:24` |
| 7 | **Dead code path:** `if (!isReady)` is checked twice, and the second `if (!isReady \|\| !formConfig)` block is unreachable. | `FormRunnerClient.tsx:~105,~130` |
| 8 | **Draft cleared with the wrong key** — writes via API, deletes `localStorage.removeItem('draft_${slug}')` which was never set. | `FormRunnerClient.tsx:~165` |
| 9 | **No CAPTCHA/honeypot sent on submit** despite the backend supporting both. If you set `CLOUDFLARE_TURNSTILE_SECRET`, every submission will fail with "CAPTCHA verification required". | `FormRunnerClient.tsx:~150` |
| 10 | **No `formVersionId` sent** — required for the §2.3 fix | same |
| 11 | **No error boundaries** anywhere; one render throw blanks the app | app tree |
| 12 | **`ReactQueryDevtools` ships to production** — no `NODE_ENV` guard | `query-provider.tsx:29` |
| 13 | **No `.env.example`** for the frontend; `NEXT_PUBLIC_API_URL` defaults to `localhost:3100/v1` (note: backend defaults to port **3000** — the two don't agree) | — |

### 7.2 Efficiency changes that will be felt

1. **`staleTime: 0` globally** (`query-provider.tsx:20`) means every query refetches on every mount. Navigating between dashboard pages re-fetches forms, org, and submissions every time. Set sensible per-query stale times (forms 30s, org 5min, templates 1h) and keep 0 only where freshness genuinely matters.
2. **The builder holds the entire form in one `useState` object** and calls `setForm` with a full spread on every keystroke (`builder/page.tsx` throughout). Every character typed in a question label re-renders all 13 builder components and every field card. Move to a Zustand store with selector subscriptions, or `useReducer` + `React.memo` on `EnterpriseFieldCard`. At 50+ questions the builder will be visibly laggy. (You have `babel-plugin-react-compiler` enabled, which helps with memoisation but does not fix the single-atom state shape.)
3. **No autosave and no unsaved-changes guard.** `hasUnsavedChanges` is tracked but there's no `beforeunload` handler — users will lose work.
4. **No virtualization** on submissions tables or long forms. A 10k-row submissions view will render 10k DOM nodes.
5. **`xlsx` (SheetJS) is bundled client-side** — it's ~600 KB and has had prototype-pollution CVEs. Move export to the server (§6.5) and drop the dependency.
6. **No route-level code splitting for the builder.** `@dnd-kit` + `framer-motion` + `recharts` + `canvas-confetti` + `react-signature-canvas` all land in shared chunks. Dynamic-import the builder, the chart components, and the signature pad.
7. **`recharts` for dashboards** is heavy; consider `visx` or server-rendered SVG for the static charts.
8. **No optimistic updates** anywhere — every mutation waits for a round-trip then invalidates and refetches. TanStack Query's `onMutate` would make the UI feel instant.
9. **Public form page could be fully static.** A published form version is immutable — `generateStaticParams` + ISR (or push to the CDN on publish) would take origin load for form views to near zero.
10. **Fonts:** both `Inter` and `Geist` are imported in `layout.tsx` but only `geist` is applied. Dead weight.

### 7.3 UX / feature gaps in the frontend

- No org switcher (blocked on §4.1), no "active workspace" concept
- No version history / restore UI, no publish-vs-draft diff
- No form preview-as-respondent link before publish
- No undo/redo in the builder (a table-stakes builder feature)
- No keyboard-first navigation beyond the `/` palette
- No bulk actions on forms or submissions
- No saved views/filters on submissions; no per-question filtering (the GIN index exists for exactly this)
- No real-time submission feed (SSE would be ~50 lines)
- No empty states with guidance, no onboarding checklist
- No skeleton parity — some pages have skeletons, most don't
- Accessibility: the builder's drag-and-drop has keyboard sensors wired (good) but the public `FormRunner` needs an a11y pass — forms are the one thing that *must* be WCAG 2.1 AA, and it's also a legal requirement for many of your buyers
- No offline/poor-network resilience on the public form (queue submission in IndexedDB and retry)

---

## 8. Engineering practices

### 8.1 Testing — effectively zero

`src/app.controller.spec.ts` (the Nest scaffold) and `test/app.e2e-spec.ts` (the scaffold) are the only test files. For a platform handling other people's data, target:

- Unit tests on the guard chain, the answer validator, quiz grading, and the logic evaluator
- **Tenant-isolation integration tests** — a suite that, for every org-scoped endpoint, asserts org B cannot read org A's data. This is the test suite that lets you sleep.
- E2E: register → create form → publish → submit → export
- Load test: k6 against the submit endpoint with a realistic payload, to establish the actual RPS ceiling before and after each §5 fix

### 8.2 CI/CD — nonexistent

No `.github/` directory. Minimum: lint + typecheck + test + `prisma migrate diff` check on PR; build and push images on merge; migrations run as a pre-deploy job, not at app boot.

### 8.3 Observability

- **No metrics endpoint.** Add `prom-client`: request rate/latency/errors by route, queue depth and job duration, DB pool utilisation, cache hit rate, submissions/sec by org.
- **No tracing.** OpenTelemetry across API → queue → worker → DB is what makes "why was this submission slow" answerable.
- **No error tracking.** Sentry (or equivalent) with release tagging and source maps.
- **Logging is file-based** via `winston-daily-rotate-file`. In a container that writes to an ephemeral disk nobody reads. Log structured JSON to stdout and let the platform collect it. Also: `nestjs-pino` + `pino-http` are in `package.json` but unused — pick one logger and delete the other.
- **Health check is incomplete** (`health.controller.ts:24` — "In a real app we'd also add Redis check here"). Add Redis, queue, and storage checks, and split `/health/live` (process up) from `/health/ready` (dependencies up) so K8s doesn't kill pods during a transient DB blip. The 300 MB heap/RSS thresholds will also flap under normal Node GC behaviour.

### 8.4 Operations

- No graceful-shutdown verification: `enableShutdownHooks()` is called (`main.ts:84`) but BullMQ workers need explicit `worker.close()` on `SIGTERM` to drain in-flight jobs.
- No backup/restore runbook, no tested PITR.
- No migration strategy for zero-downtime deploys (expand/contract pattern).
- `docker-compose.yml` has hardcoded `password`/`minioadmin` credentials — fine for local, but make sure that file is never the basis for a prod deploy.
- No K8s manifests / Helm chart / Terraform.
- `.env.example` is missing `GEMINI_API_KEY`, `FRONTEND_URL`, `SMTP_*`, `CLOUDFLARE_TURNSTILE_SECRET`, and `DATABASE_REPLICA_URL` — all of which the code reads.
- Two config sources compete: `configuration.ts` (a typed factory) and direct `process.env` reads scattered through services (`auth.service.ts:145`, `forms.service.ts:139`, `submissions.service.ts:24`, `redis.service.ts:14`, `storage.config.ts` …). Consolidate on `ConfigService` so validation actually protects you.

---

## 9. Quick wins — highest impact per hour

Do these first. Roughly one day of work total, and they remove the worst risks.

| # | Fix | File | Impact |
|---|---|---|---|
| 1 | Remove `PrismaService` from `providers` in Forms/Submissions/Webhooks modules | 3 modules | 4× fewer DB connections |
| 2 | `app.set('trust proxy', 1)` | `main.ts` | Rate limiting starts working at all |
| 3 | Redis storage for `ThrottlerModule` | `app.module.ts` | Rate limiting works across pods |
| 4 | Add `@UseGuards` + `@Throttle` to `StorageController` | `storage.controller.ts` | Closes open bucket-write |
| 5 | Fix `'AWS_S3'` → `'S3'` | `storage.service.ts:73` | S3 mode works |
| 6 | Fix `sub.ipAddress` → remove or use `respondentIpHash` | `forms.service.ts:485` | Build/export unblocked |
| 7 | Fix `submissionId` → `id` in search | `submissions.service.ts:100` | Search stops throwing |
| 8 | Wrap `publishForm` in a transaction | `forms.service.ts:378` | No divergent version state |
| 9 | Fix `fetchApi` error parsing to read `error.message` | `lib/api.ts` | Users see real errors |
| 10 | HTTPS + private-IP validation on webhook URLs | `webhooks.service.ts` | Closes SSRF |
| 11 | Guard `ReactQueryDevtools` behind `NODE_ENV` | `query-provider.tsx` | Smaller prod bundle |
| 12 | Add `sendVerificationEmail` | `mail.service.ts` | Correct signup email |

---

## 10. Recommended new data models

```prisma
// ── RBAC ──────────────────────────────────────────────────────────
model Role { /* see §4.2 */ }
model FormPermission {
  id       String @id @default(uuid()) @db.Uuid
  formId   String @map("form_id") @db.Uuid
  userId   String? @map("user_id") @db.Uuid
  roleId   String? @map("role_id") @db.Uuid
  level    String  @db.VarChar(20)   // "view" | "edit" | "manage"
  @@unique([formId, userId, roleId])
}

// ── Billing ───────────────────────────────────────────────────────
model Plan          { id, key, name, priceMonthly, quotas Json, features String[] }
model Subscription  { organizationId, planId, stripeCustomerId, stripeSubscriptionId, status, currentPeriodEnd, cancelAtPeriodEnd }
model UsageRecord   { organizationId, metric, value BigInt, periodStart, periodEnd }
model Invoice       { organizationId, stripeInvoiceId, amountCents, status, pdfUrl, issuedAt }

// ── Enterprise auth ───────────────────────────────────────────────
model SsoConnection { organizationId, provider, metadataXml, entityId, isActive }
model ScimToken     { organizationId, tokenHash, lastUsedAt }
model MfaRecoveryCode { userId, codeHash, usedAt }
model RefreshTokenFamily { id, userId, revokedAt, reason }  // for reuse detection

// ── Workflow & collaboration ──────────────────────────────────────
model ApprovalWorkflow { formId, steps Json, isActive }
model ApprovalDecision { submissionId, stepIndex, approverId, decision, comment, decidedAt }
model FormAssignment   { submissionId, assigneeId, status, dueAt }

// ── Ops ───────────────────────────────────────────────────────────
model ExportJob   { organizationId, formId, requestedById, format, status, rowCount, objectKey, expiresAt }
model Domain      { organizationId, hostname, verifiedAt, certStatus }
model RetentionPolicy { organizationId, formId?, retainDays, action }  // "delete" | "anonymize"
model DataRequest { organizationId, userId, type, status, resultKey } // GDPR export/erasure
model WebhookEndpoint { /* replace FormWebhook — org-level, multi-event, versioned */ }
```

Plus schema modifications:
- `FormSubmission.organizationId` (denormalized, indexed) — required for partitioning and RLS
- `FormSubmission.isDuplicate`, `.spamScore`, `.tags String[]`
- `Form.publishedVersionId` (explicit FK rather than an int pointer)
- `FormAnalytics.sumCompletionMs BigInt` (replace the broken running average)
- Drop `OrganizationMember.@@unique([userId])`
- `Organization.region`, `.dataResidency`, `.encryptionKeyId`

---

## 11. Feature ideas worth building (competitive differentiation)

Grouped by how defensible they are.

**High differentiation, high effort**
- Approval workflows with conditional routing and SLA tracking — this is the wedge against Typeform/Tally, which have nothing
- Bi-directional database sync (Airtable/Notion/Sheets/Postgres) — `IntegrationConfig` is already modelled for it
- Form-as-portal: authenticated respondents see their own submission history and can update prior answers
- Native payments with tax/invoice handling
- AI beyond generation: auto-summarise open-text responses, sentiment clustering, anomaly detection on submission patterns, "explain this data" over the submission set

**Moderate effort, high perceived value**
- Real-time collaborative editing (Yjs/Liveblocks) on the builder
- Version history with visual diff and one-click rollback
- Conditional email/PDF receipts with a template editor
- Embeddable Web Component with Shadow DOM (your embed endpoint currently emits a `<script src="/embed.js">` tag pointing at a file that doesn't exist)
- Partial-submission analytics: drop-off funnel per question — you have `starts`, `views`, `submissions` modelled and nothing writing them
- Public API + SDKs (the `ApiKey` model and guard are already built and unused)

**Low effort, immediate delight**
- Slash-command palette in the builder — **already built**, good
- Duplicate question, bulk-edit options, question templates
- Form-level QR code + short link
- Response notifications digest (hourly/daily instead of per-submission)
- Submission comments/mentions — `FormComment` is modelled, no API

---

## 12. Phased roadmap

### Phase 0 — Unbreak (1 week)
Everything in §9, plus the publish flow (§2.1) and the version-binding fix (§2.3). **Exit criteria:** you can create a form in the UI, publish it, open `/f/{slug}` in an incognito window, submit it, and see the row in the submissions table.

### Phase 1 — Security & correctness (2–3 weeks)
Answer validation (§2.4) · form access enforcement on submit (§2.5) · storage auth + MIME/size enforcement + file→submission linking + verify worker (§3.1) · webhook SSRF + secret encryption (§3.2–3.3) · auth brute-force protection (§3.5) · MFA secret encryption + recovery codes (§3.6) · refresh-token families (§3.7) · move access token out of `localStorage` (§3.8) · Next.js `middleware.ts` · error boundaries.
**Exit criteria:** an external pentest finds nothing critical; the tenant-isolation test suite is green.

### Phase 2 — Multi-tenancy done properly (2–3 weeks)
Multi-org membership (§4.1) · permission-based RBAC with custom roles (§4.2) · Prisma tenant extension + Postgres RLS (§4.3) · org switcher UI · per-form ACLs · API keys module with scopes.
**Exit criteria:** one user can belong to three orgs with different roles; a custom "Analyst" role can view but not export.

### Phase 3 — Scale (3–4 weeks)
Split the worker process (§5.4) · Redis session cache (§5.2) · Redis quota counters (§5.3) · denormalize `organizationId` + partition `form_submissions` (§5.5) · batch worker inserts · read replicas + PgBouncer wired · CDN in front of `/f/*` · async export jobs (§6.5) · Prometheus + OTel + Sentry (§8.3) · k6 load-test suite.
**Exit criteria:** sustained 5k submissions/sec on a defined cluster size, p99 < 150ms on the submit endpoint, with a load-test report to prove it.

### Phase 4 — Monetisation & enterprise (4–6 weeks)
Stripe billing + plan→quota enforcement · usage metering · SSO/SAML + SCIM · custom domains · GDPR export/erasure + retention policies · audit-log integrity · notifications module · admin dead-letter/replay UI.

### Phase 5 — Differentiation (ongoing)
Approval workflows · payments · bi-directional sync · real-time collaboration · advanced analytics · public API + SDKs · mobile-optimised respondent experience.

---

## 13. Appendix — file:line index of every finding

| Finding | Location |
|---|---|
| No publish call in frontend | `frontend/src` (grep: 0 hits) |
| Publish not transactional | `forms.service.ts:378-420` |
| Worker binds newest version | `submission.processor.ts:25-31` |
| No answer validation | `submissions/dto/submit-form.dto.ts` |
| Submit ignores form access controls | `submissions.service.ts:16-87` |
| `sub.ipAddress` doesn't exist | `forms.service.ts:485` |
| Export loads all rows | `forms.service.ts:460-463` |
| `'AWS_S3'` invalid enum | `storage.service.ts:73` |
| `submissionId` search column | `submissions.service.ts:100` |
| Wrong signup email | `auth.service.ts:145-147` |
| Storage controller unauthenticated | `storage.controller.ts` (whole file) |
| Hardcoded 50 MB vs `MAX_FILE_SIZE_MB` | `storage.service.ts:14` |
| `storageUsedBytes` never incremented | (no write site in repo) |
| Verifier on wrong queue / not registered | `storage-verifier.processor.ts:16`, `storage.module.ts` |
| Webhook SSRF | `webhooks.service.ts:29`, `webhooks.processor.ts:24` |
| Webhook secret plaintext + returned | `webhooks.service.ts:32,57` |
| In-memory throttler | `app.module.ts:75-78` |
| No trust proxy | `main.ts` (absent) |
| No auth-endpoint throttles | `auth.controller.ts` (no `@Throttle`) |
| MFA secret plaintext | `schema.prisma:393` |
| No refresh reuse detection | `auth.service.ts:276-317` |
| Token in localStorage | `hooks/use-auth.ts` (4 sites) |
| API-key cache not invalidated | `api-key.guard.ts:11,38-47` |
| Single-org DB constraint | `schema.prisma:301` |
| Duplicate `PrismaService` providers | `forms.module.ts:9`, `submissions.module.ts:16`, `webhooks.module.ts:14` |
| Per-request auth queries | `jwt.strategy.ts:26`, `org-member.guard.ts:64` |
| `COUNT(*)` on ingest path | `submissions.service.ts:60-65` |
| Workers in API process | `submissions.module.ts`, `webhooks.module.ts` |
| Broken average math | `submission.processor.ts:89` |
| `views`/`starts` never written | (no write site in repo) |
| `LookupService` unused | `lookup/lookup.service.ts` |
| Cache invalidation only on publish | `forms.service.ts:414` |
| `fetchApi` error shape mismatch | `lib/api.ts:~92` vs `http-exception.filter.ts:~63` |
| Builder seeded from mock data | `builder/page.tsx:71` |
| Notifications hardcoded | `notifications/page.tsx:11` |
| No middleware.ts | `frontend/src` (absent) |
| Fake fingerprint | `FormRunnerClient.tsx:24` |
| Unreachable code | `FormRunnerClient.tsx:~130` |
| Wrong draft-clear key | `FormRunnerClient.tsx:~165` |
| No CAPTCHA/version on submit | `FormRunnerClient.tsx:~150` |
| Devtools in prod | `query-provider.tsx:29` |
| `staleTime: 0` global | `query-provider.tsx:20` |
| Health check incomplete | `health.controller.ts:24` |
| Audit writes fire-and-forget | `audit.service.ts:50` |
| Unused `nestjs-pino` | `package.json` |
