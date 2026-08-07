# Implementation Log — Phase 0/1 + Dependency Upgrade

**Date:** 2026-08-07
**Verification:** backend `tsc` clean · backend `nest build` clean · frontend `tsc` clean · frontend `next build` clean · Nest DI graph fully constructs · SSRF guard 17/17 · answer validator 13/13 · otplib round-trip verified

---

## 1. Dependency upgrade

| Package | From | To | Notes |
|---|---|---|---|
| `prisma` / `@prisma/client` | 5.22 | **7.9.1** | Major. Rust engine removed; driver adapter now required |
| `@prisma/adapter-pg` + `pg` | — | 7.9.1 / 8.22 | New — supplies the connection, with explicit pool control |
| `bullmq` | 5.81 | **6.0.9** | |
| `ioredis` | 5.11 | **6.0.0** | |
| `otplib` | 12.0.1 | **13.4.1** | Major. Full API rewrite — see §2 |
| `@aws-sdk/client-s3` + presigner | 3.1095 | 3.1105 | |
| `nanoid` | 6.0.0 | 6.0.1 | |
| `@types/node` | 24 | **26.1.2** | |
| `eslint` / `@eslint/js` | 9 | **10.8.0 / 10.0.1** | |
| `typescript-eslint` | 8.65 | 8.66 | |
| `@nest-lab/throttler-storage-redis` | — | 1.2.0 | New — distributed rate limiting |
| `ipaddr.js` | — | 2.5.0 | New — SSRF address classification |

### TypeScript deliberately held at 5.9

TypeScript 7.0.2 is `latest`, but it is the native Go port. NestJS depends entirely on `emitDecoratorMetadata` + `reflect-metadata` for dependency injection — if metadata emit differs, the DI container breaks in ways a typecheck will not reveal. That is a migration to run on its own, with the DI smoke test as the gate. Everything else is on latest.

### Prisma 7 migration specifics

- `url` is no longer allowed in the schema `datasource`; the connection comes from `PrismaPg` at runtime and from `prisma.config.ts` for the CLI.
- `prisma.config.ts` rewritten to the required `defineConfig()` form; the seed command moved there from `package.json`'s `prisma` key.
- `binaryTargets` removed — no engine binaries exist to target, which also simplifies the Dockerfile.
- **Prisma 7's stricter types caught three latent bugs as compile errors** (see §3).

---

## 2. otplib 13 — the migration that would have silently broken MFA

otplib 13 removed the `authenticator` singleton the code used behind a `@ts-ignore`. Two changes are dangerous:

```js
// v13 verify() is ASYNC and returns an OBJECT, not a boolean:
await verify({ secret, token }) // -> { valid: true, delta: 0 }

// A naive port keeps the old check:
if (!isValid) throw new UnauthorizedException('Invalid MFA code');
// !{valid:false} === false  ->  EVERY CODE ACCEPTED
```

Verified empirically before writing the fix. Also: v13 defaults `epochTolerance` to `0` where v12 allowed ±1 step, so any clock skew on the user's phone would reject valid codes.

Both are contained in `common/crypto/totp.service.ts`, which returns a real boolean and restores a ±30s window.

While in there: MFA secrets are now **encrypted at rest** (AES-256-GCM, `CryptoService`), single-use **recovery codes** were added, and disabling MFA now requires the account password.

---

## 3. Bugs the compiler surfaced during the upgrade

| Bug | Impact |
|---|---|
| `provider: 'AWS_S3'` vs enum `S3` | Every presigned upload in S3 mode threw at runtime |
| `getMe()` omitted `mfaEnabled` from its `select` | Always returned `undefined` — the UI could never show MFA as enabled |
| `notifyEmails` treated as `string[]` (it is `JsonValue`) | Unsafe `.length` on a JSON column |
| `metadata: null` on a `Json` column | Prisma rejects bare `null`; audit writes with no metadata failed |

---

## 4. Audit findings fixed

### P0 — product was non-functional
- **Publish flow wired end-to-end.** The builder never called `/publish`, so no `FormVersion` ever existed → every public form 404'd and every submission job failed. Added Publish/Republish to the builder navbar with live/draft status, an unpublished-changes indicator, and a "view live" link.
- **`publishForm` made atomic** — Serializable transaction, version derived from `MAX(version)`, one retry on write conflict.
- **Submissions bind to the correct version.** The worker took "newest version"; it now uses the `formVersionId` resolved at ingest and echoed by the client.
- **CSV export** no longer reads a non-existent `ipAddress` column; added CSV-injection escaping, CRLF, and a row cap (was unbounded → OOM).
- **Submission search** filtered on a non-existent `submissionId` column and threw on every search.
- **Registration email** sent "Reset your password" for signup; added a real `sendVerificationEmail`.

### P0 — security
- **Upload endpoint was fully unauthenticated and unthrottled.** Now: throttled, form must be published/undeleted/unexpired in an active org, question must exist in the published version *and* be `FILE_UPLOAD`, MIME + extension allowlisted (`.html`/`.svg` blocked), size honours `MAX_FILE_SIZE_MB` and is bound into the S3 signature, and re-verified against actual object size by a new `FileVerifierProcessor`.
- **Files are now linked to submissions and counted against quota.** `submissionId` was never set and `storageUsedBytes` was never incremented, so the quota could never trip. Added an org-scoped download endpoint (none existed).
- **Webhook SSRF closed.** HTTPS-only, no embedded credentials, blocked ports, DNS resolution with rejection of loopback/private/link-local/metadata addresses — re-checked at delivery time (DNS rebinding), redirects not followed, response capture cut to 512 bytes. Verified 17/17 against real attack URLs, including AWS/GCP metadata endpoints. NAT64 (`64:ff9b::/96`) is unwrapped to the embedded IPv4 so legitimate hosts on DNS64 resolvers still work.
- **Webhook secrets encrypted** and no longer returned from read endpoints; added rotation + delivery history.
- **Rate limiting actually works.** Was in-memory (per-pod, reset on deploy) with no `trust proxy` — behind a load balancer the whole internet shared one bucket. Now Redis-backed with correct client-IP extraction.
- **Brute-force protection** on login (5/15min), MFA (5/5min), forgot/reset password.
- **Email HTML injection** — respondent answers were interpolated unescaped into notification emails.

### P0 — the submit endpoint accepted anything
- **Server-side answer validation** (`AnswerValidatorService`): required fields, per-type checks, option membership, length/range bounds, payload and key-count caps, ReDoS-guarded author regex. Unknown keys dropped, values normalised. Runs synchronously so respondents get field-level errors. 13/13 tests pass.
- **Form access controls enforced**: status, `deletedAt`, `expiresAt`, `maxSubmissions` (with auto-close), `requireAuth`, password protection, `allowMultiple`, org active. **None** of these were checked before.
- **File references validated** — a caller could previously attach another tenant's file to their own submission.

### Performance
- **Removed 6 duplicate Prisma connection pools per pod.** `PrismaService` was re-declared in 4 modules despite `PrismaModule` being `@Global`, giving 8 clients instead of 2 (~72 Postgres connections/pod). Same for `RedisService` → new global `RedisModule`. Reader/writer now share one pool when no replica is configured.
- **Removed the `COUNT(*)` from the ingest hot path** — a join+aggregate over the org's entire submission history ran on *every* public submission. Replaced with Redis counters (fail-open).
- **Ingest policy cached in Redis**, invalidated on publish/update/delete/restore.
- **Workers separable from the API** — `PROCESS_ROLE` + `src/worker.ts`, so ingest scales independently.
- **Analytics `views`/`starts` now actually recorded** (they were never written) via a Redis-buffered counter flushed every 30s — avoids a DB write per form view.
- **`avg_completion_ms` fixed** — was `(old + new) / 2`, a recency-weighted average, not a mean. Added `sum_completion_ms` (+ migration with backfill).
- **Public-form cache invalidation** on update/delete/slug change — a deleted form stayed fillable for 5 minutes.

### Frontend
- **`fetchApi` read `body.message`** but the API returns `{ error: { message } }` — *every* error surfaced as a generic status-code string. Now parses correctly and carries field-level issues (`ApiError`).
- **Added `middleware.ts`** — there was no server-side route protection at all. Scoped honestly: it gates on session-cookie presence, not authorization (documented in the file).
- **Added `ErrorBoundary`**; devtools no longer ship to production; `staleTime` 0 → 30s with no retry on 4xx.
- **Builder no longer seeds from mock data** — a failed load showed fake questions the user could save as real content. Added a `beforeunload` guard for unsaved edits.
- **Fixed 19 pre-existing type errors that made `next build` fail.** Most consequential: `FormConfig` declared `pagesJson/questionsJson/logicJson/themeConfig` while *every* consumer used `pages/questions/logic/theme`; `Submission` declared `data`/`completionTime` where the API returns `answers`/`completionTimeMs`; a duplicated `const submissions` referencing an undefined variable; a missing `Badge` import; Radix `asChild` used on Base UI components.
- Port mismatch fixed (frontend defaulted to `:3100`, backend to `:3000`), upload payload migrated to `fileSizeBytes`.

### Build/infra
- **`tsconfig.build.json` `rootDir` pinned.** Adding root-level `prisma.config.ts` (Prisma 7 requires it) silently moved output to `dist/src/main.js` while the Dockerfile and `start:prod` still pointed at `dist/main` — production would have broken with no build failure.
- Dockerfile rebuilt: bun-based multi-stage, non-root, healthcheck, `STOPSIGNAL SIGTERM` for job draining, worker-mode ready.
- `main.ts`: trust proxy, explicit body limits, `X-Api-Key`/`Idempotency-Key` in CORS, helmet CSP scoped off the docs route only.
- `.env.example` updated for both apps.

---

## 5. Not done — deliberately

| Item | Why |
|---|---|
| **Multi-org membership** (audit §4.1) | `@@unique([userId])` is a schema + semantics change touching auth, invites, JWT, and every "my org" call site, plus an org-switcher UI. Wants its own branch. |
| **Permission-based RBAC** (§4.2) | Depends on the above. |
| **Prisma tenant extension + Postgres RLS** (§4.3) | Best landed with the RBAC work. |
| **TypeScript 7** | See §1. |
| **Tests** | No test suite exists. The verification here is typecheck + build + DI construction + targeted scripts for the validator, SSRF guard, and TOTP. A real suite — especially cross-tenant isolation tests — is the highest-value next step. |
| **Async export jobs, notifications/comments/integrations/billing/API-key modules** | Phase 4 in the roadmap. |
| **Partitioning, `organizationId` denormalisation** | Phase 3; needs a data migration on a populated database. |

---

## 6. Before running

```bash
# Backend
cd form-builder-backend
bun install
openssl rand -base64 32          # -> ENCRYPTION_KEY in .env (REQUIRED in production)
bun run db:migrate               # applies the MFA recovery + analytics migration
bun run build && bun run start:prod
bun run start:worker             # separate process/deployment

# Frontend  (backend owns :3000, so run the UI elsewhere)
cd frontend && bun install && bun run dev -- -p 3001
```

`ENCRYPTION_KEY` is mandatory in production — the app refuses to boot without it rather than silently storing secrets in plaintext. In development it derives a key from `JWT_SECRET` and warns.
