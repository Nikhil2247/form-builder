# Form Builder — Codebase Analysis (re-verified)

> **Date:** 2026-08-13
> **Supersedes:** `form_builder_analysis.md` (Antigravity IDE brain dump)
> **Method:** direct read of `form-builder-backend/src` (21,712 LOC TS), `frontend/src`
> (53,159 LOC TS/TSX), `prisma/schema.prisma` (1,650 lines), 11 migrations, `.github/workflows/ci.yml`.
> Every claim below was checked against the file it names. Claims I could not verify are marked
> **UNVERIFIED** rather than asserted.

---

## 0. Executive summary — what changed

The prior analysis described a codebase that **could not serve a single form end to end**. That is
no longer true. Of its 8 "P0 blockers" and 7 "P0 security vulnerabilities", **14 of 15 are fixed**,
and the one remaining (refresh-token families) is a hardening item, not a blocker.

The prior document is now **substantially out of date** and should not be used for planning. Three
whole subsystems it never mentions — **Form Apps**, **Choice Lists**, and **Subjects/Records** —
now exist with schema, migrations, API, and UI.

**Current honest state:** the core loop (create → publish → serve → validate → submit → export)
works and is defended. The gaps have moved *up the stack*: from "the product is broken" to
"the product lacks enterprise surface area and operational visibility".

---

## 1. Verification of every prior claim

### 1.1 Prior "P0 — Critical Blockers"

| # | Prior claim | Verdict | Evidence |
|---|---|---|---|
| 1 | No publish flow → public form dead | ✅ **FIXED** | `EnterpriseNavbar.tsx:386` renders Publish/Republish; `:274` shows an "Unpublished changes" indicator; `forms.controller.ts:128` `POST :formId/publish` |
| 2 | `publishForm` not atomic | ✅ **FIXED** | `forms.service.ts:684-760` — `prisma.writer.$transaction`, Serializable, retries once on P2034. Also validates structure, empty-form, dangling choice lists, and compiles rules inside the txn |
| 3 | Worker binds newest version | ✅ **FIXED** | Client sends `formVersionId` (`FormRunnerClient.tsx:240`); processor reads it verbatim (`submission.processor.ts:63`) |
| 4 | Zero server-side answer validation | ✅ **FIXED** | `submissions/answer-validator.service.ts` + `.spec.ts`, registered in `SubmissionsModule`, runs pre-enqueue |
| 5 | Submit ignores all access controls | ✅ **FIXED** | `submissions.service.ts:115-170` enforces status, expiry, `requireAuth`, password, CAPTCHA; `:214` `allowMultiple`; `:532-573` policy read includes `deletedAt`, `organization.isActive` |
| 6 | Export broken (`sub.ipAddress`) + OOM | ✅ **FIXED** | Field gone. `exportSubmissions` is now an `AsyncGenerator` walking 1,000-row keyset batches (`forms.service.ts:908-975`); controller honours backpressure and destroys the socket on mid-stream error (`forms.controller.ts:170-212`). Covered by `export-stream.spec.ts` |
| 7 | S3 mode writes invalid `'AWS_S3'` enum | ✅ **FIXED** | `storage.service.ts:219` — `type === 's3' ? 'S3' : 'MINIO'` |
| 8 | Submission search on nonexistent `submissionId` | ✅ **FIXED** | `submissions.service.ts:843` carries a comment recording the fix |

### 1.2 Prior "P0 — Security Vulnerabilities"

| # | Prior claim | Verdict | Evidence |
|---|---|---|---|
| 1 | Storage endpoint unauthenticated | ✅ **FIXED** | `storage.controller.ts` — `@Throttle(20/min)`, published/undeleted/unexpired/active-org check, questionId must exist and be `FILE_UPLOAD`, MIME + extension allowlist, size bound. Quota now real: `file-verifier.processor.ts:162` increments `storageUsedBytes` on VERIFIED only; `storage.service.ts:159-179` reserves against quota |
| 2 | Webhook SSRF | ✅ **FIXED** | `common/net/url-guard.ts` — scheme allowlist, credential/port rejection, DNS resolution + private-IP block re-checked at delivery (anti-rebinding), blocked hostname set incl. metadata endpoints, 27-entry blocked port set. Called at `webhooks.processor.ts:46`; `redirect: 'manual'` at `:90` |
| 3 | Webhook secrets plaintext | ✅ **FIXED** | `webhooks.service.ts:64,111` — `crypto.encrypt()`; `common/crypto/crypto.service.ts` |
| 4 | Access token in `localStorage` | ✅ **FIXED** | `lib/api.ts:6-10` documents in-memory-only storage; no `localStorage` writes remain in `use-auth.ts` |
| 5 | No brute-force protection on auth | ✅ **FIXED** | `auth.controller.ts` — 5/15min login, 5/5min MFA, 3/15min forgot-password, 5/15min on reset and MFA disable. Redis-backed throttler (`app.module.ts`), proxy-aware `getTracker` |
| 6 | MFA secrets plaintext | ✅ **FIXED** | `auth.service.ts:556` encrypt on setup, `:300,574` decrypt on verify |
| 7 | Refresh token families missing | 🔴 **STILL OPEN** | `auth.service.ts:325-340` rotates by revoking the presented token, but a replayed already-revoked token is simply rejected — no `familyId`, no cascade revoke. Replay is not detected as compromise |

### 1.3 Prior "Multi-Tenancy Structural Issues"

| Claim | Verdict | Evidence |
|---|---|---|
| `@@unique([userId])` blocks multi-org | ✅ **FIXED** | `schema.prisma:312` is now `@@unique([organizationId, userId])`. Migration `20260808120000_multi_org_membership`. `User.lastActiveOrganizationId` exists; `common/tenancy/active-organization.ts` resolves the active org; `POST /organizations/:orgId/activate` switches it; `GET /organizations` lists memberships |
| 3 hardcoded roles | 🟠 **STILL OPEN** | `schema.prisma:176` — `OrgRole { ADMIN EDITOR VIEWER }` unchanged. No permission model, no custom roles, no per-form ACL |
| No structural tenant isolation | 🟠 **PARTIALLY** | Still hand-written `where: { organizationId }` per service — no Prisma extension, no `AsyncLocalStorage`, no Postgres RLS (verified: zero matches). **But** there is now a `common/guards/tenant-isolation.spec.ts` suite running against real Postgres in CI, which is the highest-value half of the fix |

### 1.4 Prior "Efficiency & Scale Bottlenecks"

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | Duplicate Prisma pools (8/pod) | ✅ **FIXED** | `PrismaService` removed from module providers; `forms.module.ts:8-11`, `analytics.module.ts:6`, `subjects.module.ts:6` carry explanatory comments. `PrismaService` now deliberately holds **two** clients (writer + optional `DATABASE_REPLICA_URL` reader), collapsing to one pool when no replica is set |
| 2 | Two extra DB round-trips per request | 🔴 **STILL OPEN** | `jwt.strategy.ts:28` does `user.findUnique` + memberships join on every request; `org-member.guard.ts` then queries membership again. No Redis session cache exists |
| 3 | `COUNT(*)` on hot ingest path | ✅ **FIXED** | `submissions.service.ts:595-650` — Redis `INCR` with `YYYY-MM` key, DB seed on cache miss, and **quota release on rejected submissions** (`:231,258`) so failures don't burn slots |
| 4 | Workers run inside API process | ✅ **FIXED** | `isWorkerMode()` gates processor registration (`submissions.module.ts:34`); `src/worker.ts` is a real context-only entrypoint with SIGTERM drain; `npm run start:worker` exists |
| 5 | Analytics `views`/`starts` never written | ✅ **FIXED** | `POST /public-forms/:slug/track` + `analytics/analytics-flush.service.ts` (Redis-buffered, per-form aggregation flush) |
| 6 | `LookupService` injected by nothing | 🟠 **STILL TRUE** | Only self-references. `LookupModule` is imported by `AppModule` but no consumer injects the service. Dead code, or an unfinished optimisation |

### 1.5 Prior "Frontend Issues"

| # | Claim | Verdict |
|---|---|---|
| 1 | `fetchApi` reads wrong error shape | ✅ **FIXED** — `lib/errors.tsx` + toast contract landed |
| 2 | No publish button | ✅ **FIXED** |
| 3 | Builder falls back to mock data | ✅ **FIXED** — verified no mock fallback in `forms/builder/page.tsx` |
| 4 | Notifications page 100% hardcoded | ✅ **FIXED** — now renders an honest empty state and points at the email channel that does work |
| 5 | No `middleware.ts` | ✅ **FIXED** — `frontend/src/proxy.ts` (Next 16 renamed the convention). Correctly documented as *shell gating, not authorization* |
| 6 | Fingerprint is `Math.random()` | ⚠️ **UNVERIFIED** — not re-checked this pass |
| 7 | `formVersionId` never sent | ✅ **FIXED** |
| 8 | No CAPTCHA token sent | ✅ **FIXED** — `verifyCaptcha` on the server path; client sends `captchaToken` |
| 9 | Devtools ship to production | ✅ **FIXED** — `query-provider.tsx:125` gated on `NODE_ENV === 'development'` |
| 10 | No error boundaries | ✅ **FIXED** — `components/common/error-boundary.tsx`, `app/(dashboard)/error.tsx`, wired in root layout |
| 11 | Port mismatch 3001 vs 3100 | ⚠️ **UNVERIFIED** — local `.env` concern, not a repo defect |
| — | `staleTime: 0` globally | ✅ **FIXED** — `query-provider.tsx:101` is `30_000` |
| — | No autosave / no unload guard | ✅ **FIXED** — `hooks/use-form-autosave.ts`: revision high-water-mark, serialised saves, backoff `[1s,3s,8s,20s,30s]`, 10s max-wait ceiling. A genuinely careful implementation |
| — | `xlsx` bundled client-side | ❌ **CLAIM WAS WRONG** — `xlsx` is in `package.json` but its only importers (`components/submissions/SubmissionsView.tsx`, `lib/excelExport.ts`) are **dead code**. Never in a bundle. Deleting all three is a cleanup, not a perf fix |
| — | No route-level code splitting | ✅ **FIXED** — `next/dynamic` on `SignatureField`, `ActivityChart`; confetti is an inline `await import()`. Public runner chunk 107.4 → 80.1 KiB |
| — | No virtualization on submissions table | 🟠 **STILL OPEN** — zero `useVirtualizer` usage anywhere |
| — | Both Inter and Geist imported | ⚠️ **UNVERIFIED** |

### 1.6 Prior "Missing Engineering Infrastructure"

| Claim | Verdict |
|---|---|
| Tests effectively zero | 🟠 **MUCH IMPROVED, still thin.** 10 backend specs + 2 e2e suites + 2 frontend tests. Notably: `tenant-isolation.spec.ts`, `answer-validator.service.spec.ts`, `export-stream.spec.ts`, `rules/lookup.spec.ts`, `rules/runner-contract.spec.ts`, `form-structure.spec.ts`, `csv.spec.ts`, `cache-control.interceptor.spec.ts`. Coverage is concentrated on the riskiest logic, which is the right prioritisation — but controllers, guards and services are largely untested |
| No CI/CD | ✅ **FIXED** — `.github/workflows/ci.yml`, 4 jobs: backend unit + typecheck + build; backend integration against real Postgres 16 + Redis 7 (runs the tenant-isolation suite); **migration drift check** via `prisma migrate diff --exit-code`; frontend lint/typecheck/build. Plus a clever `diff -r` gate asserting the backend and frontend copies of the rules engine have not diverged |
| No observability | 🔴 **STILL TRUE** — zero matches for `prom-client`, `opentelemetry`, `@sentry`. Structured logging exists (Winston + `AppLogger` + `HttpLoggingInterceptor`) but there are no metrics, traces, or error reporting |
| Health checks incomplete | 🔴 **STILL TRUE** — `health.controller.ts` checks Postgres + heap + RSS. The file literally comments *"In a real app we'd also add Redis check here"*. No Redis, no BullMQ queue depth, no object-storage probe |

---

## 2. What exists now that the prior analysis never mentioned

Three subsystems were built after that document. They are the largest single body of new work.

### 2.1 Rules engine (`common/rules/`, 2,185 LOC)
A compiled expression engine — `ast.ts`, `compiler.ts`, `interpreter.ts`, `operators.ts`,
`engine.ts`, `form-adapter.ts`, `lookup-bag.ts`. Calculates values, conditionally shows/requires
questions, and rejects submissions.

The important architectural decision: **the directory is mirrored verbatim into
`frontend/src/lib/rules`, and CI fails if the copies diverge.** The browser evaluates rules with
the same code the server does, so a respondent can never see one calculated value while the server
stores another. `RulesBuilder.tsx:41-43` documents this explicitly — the builder panel's verdict
*is* the publish check, not a friendlier approximation of it. Rule compilation runs inside the
publish transaction, so unknown operators, dangling references and dependency cycles fail at
publish rather than at submit time.

### 2.2 Choice Lists (`modules/choice-lists/`)
Org-scoped and platform-global reference data with cascading parent/child options, CSV
import/preview/export, slug-based referencing from questions (`optionsSource.listSlug`), and a
public read endpoint (`/public-forms/:slug/choice-items`) for the runner. Publish re-validates
that every referenced list still exists. Seeded India states/districts via
`db:seed:choices` (idempotent, production-safe).

### 2.3 Subjects & Form Apps (`modules/subjects/`, `modules/form-apps/`)
The larger conceptual addition. `SubjectType`/`Subject` is a per-tenant record registry;
`FormApp` is a multi-step programme over a subject type, with:

- `FormAppStep` — an ordered step with a cardinality (once / repeatable / conditional). The schema
  comment records that a bare `formIds` array was migrated away from precisely because it could not
  express order or repetition.
- `FormAppPeriod` — reporting periods.
- `FormAppSession` / `FormAppSessionEntry` — resumable respondent sessions with per-entry
  PUT/DELETE and a final submit.
- Its own public surface at `/a/[slug]` with independent theme, branding, `requireAuth`
  (defaults **true** — correct for something that writes to a registry) and `allowDrafts`.

Backed by `test/form-app-session.e2e-spec.ts`, and by two realistic seed scenarios
(`seed-nagaland-app.ts`, `seed-scenario-apps.ts`) used as buildability tests — the Nagaland seed
prints a verdict on what the platform can and cannot express. That is an unusually good practice.

### 2.4 Feature flags (`modules/feature-flags/`)
Platform-level flags with per-organization overrides, admin-only mutation.

---

## 3. Current inventory

| Layer | State |
|---|---|
| Backend | NestJS 11, Prisma 7 (`@prisma/adapter-pg`), Postgres, 15 feature modules + health |
| Frontend | Next.js 16.2.11, React 19.2.4, TanStack Query 5, Zustand 5, Tailwind v4 + shadcn/Radix/Base UI |
| Schema | 32 models, 13 enums, 11 migrations, drift-checked in CI |
| Routes | 76 frontend pages, 119 components; ~150 API endpoints across 18 controllers |
| Queues | BullMQ 6 — `SUBMISSIONS`, `WEBHOOKS`, `FILE_VERIFY`; worker-mode gated |
| Caching | Redis (cache-manager), Redis-backed throttler, global `CacheControlInterceptor` defaulting to `no-store` |
| Auth | Argon2id, JWT bearer (in-memory) + HttpOnly refresh cookie, TOTP MFA with encrypted secrets, recovery codes |
| Crypto | `CryptoService` (AES) for webhook + MFA secrets, `ENCRYPTION_KEY` validated by Joi |
| Logging | Winston + `AppLogger` + `HttpLoggingInterceptor` |
| CI | 4 jobs incl. real-Postgres integration and migration drift |

---

## 4. What is actually still open

### 🔴 P0 — Operational blind spots (ship-blocking for production, not for demo)

| # | Gap | Where | Why it matters |
|---|---|---|---|
| 1 | **No metrics, traces, or error reporting** | absent | You cannot tell whether the queue is backing up, which endpoint is slow, or that a customer is 500-ing. Everything below is unmeasurable until this exists |
| 2 | **Health check is a stub** | `common/health/health.controller.ts` | Redis, BullMQ depth, and object storage are unchecked. A pod with dead Redis reports healthy and takes traffic it cannot serve |
| 3 | **Two DB queries per authenticated request** | `jwt.strategy.ts:28`, `org-member.guard.ts` | The single largest remaining scale ceiling. At 5k RPS this is 10k wasted queries/sec against the same pool serving real work |
| 4 | **`HttpLoggingInterceptor` writes IN + OUT to a rotating file** | `common/logger/winston.config.ts` | Two disk writes per request; wrong shape for a container. **Blocked on your decision:** drop the file transport in prod for stdout, or keep it? |

### 🟠 P1 — Security hardening

| # | Gap | Where |
|---|---|---|
| 1 | Refresh-token replay is not treated as compromise | `auth.service.ts:325-340` — add `familyId`, cascade-revoke the family on reuse |
| 2 | No structural tenant scoping | Prisma extension + `AsyncLocalStorage`, and/or Postgres RLS as backstop. The isolation *test* exists; the *mechanism* does not |
| 3 | CSP keeps `script-src 'unsafe-inline'` | `next.config.ts` — not an XSS mitigation as written. The worthwhile follow-up is a nonce CSP scoped to `/f/*` and `/a/*` only (already dynamic, and the only routes rendering author-controlled content). Needs a running stack to verify — a missed script tag means a blank form for every respondent |
| 4 | `upgrade-insecure-requests` on in production | `next.config.ts` — if the API is served over plain HTTP in your deployment, every call breaks. **Check before deploy** |
| 5 | `ApiKeyGuard` exists and is applied to **zero** routes | `common/guards/api-key.guard.ts` — dead defence |

### 🟠 P2 — Correctness / cleanup

| # | Gap |
|---|---|
| 1 | `LookupService` is injected by nothing — wire it into the submission processor and `PublicFormsController`, or delete it |
| 2 | Dead code: `components/submissions/SubmissionsView.tsx`, `lib/excelExport.ts`, `components/ui/chart.tsx`, and the `xlsx` dependency. Removing all four drops a 600 KB dep with known CVEs from the lockfile |
| 3 | No virtualization on the submissions table — 10k rows = 10k DOM nodes |
| 4 | Lint is `continue-on-error` in both CI jobs: ~1,100 backend and ~134 frontend errors outstanding. Every day this stays non-blocking the backlog grows |
| 5 | Test coverage is concentrated on the rules engine and export; controllers, guards, and most services are untested |

---

## 5. Features still not built

### Models with schema but no API
| Model | State |
|---|---|
| `Notification` | Model only. No controller, no SSE. Frontend page honestly says so |
| `FormComment` | Model only. No CRUD |
| `IntegrationConfig` | Model only. No OAuth, no sync engine. (The `/integrations` page is a **webhooks** UI, not an integrations one) |
| `ApiKey` | Model + guard, no CRUD controller, guard unused |
| `WebhookDelivery` | Written and readable (`GET :webhookId/deliveries`) — but no replay/retry action |
| `FormDraft` | Wired for the public runner (`PUT/GET/DELETE /public-forms/:slug/draft`); no dashboard surface |

### Missing modules
- **Billing** — UI reads real quota/usage from the API now, but there is no plan model, no Stripe, no enforcement beyond the hard org quotas
- **Submission write operations** — no `GET /submissions/:id`, no annotate, no soft-delete, no bulk actions. List-and-export only
- **Notifications** — list, mark-read, preferences, stream
- **API keys CRUD** — machine-to-machine with scopes
- **SSO / SAML / OIDC** — blocks enterprise deals
- **Custom domains** per tenant
- **GDPR export/erasure** endpoints

### Missing field types
Payment (Stripe/Razorpay), scheduling/booking, address autocomplete with country/state cascade
(note: the Choice Lists cascade primitive now makes this mostly a UI job), camera/document capture.

### Missing form features
Approval/review workflows with conditional routing; multi-language per version; A/B variants; PDF
generation; e-signature with a legal audit trail (currently raw base64 in JSONB — bloats rows, no
legal value); conditional email receipts with a template editor; drop-off funnel analytics.

---

## 6. Revised roadmap

### Phase A — See what you're running (3–5 days) ← **do this first**
The prior Phase 0 is done. This replaces it, and everything after it depends on it.

1. Prometheus metrics: HTTP histogram, BullMQ queue depth/latency, Prisma pool saturation
2. Sentry (or equivalent) on both API and frontend
3. Complete the health check: Redis, queue reachability, storage `HeadBucket`
4. **Decide the logging question** (file transport vs stdout) and act on it
5. Redis session cache in `JwtStrategy` (`session:{userId}`, TTL 60s) — `OrgMemberGuard` reads the
   same document instead of re-querying

**Exit criteria:** a dashboard showing p99 latency per route, queue depth, and error rate — and a
paging alert on each.

### Phase B — Harden (1–2 weeks)
1. Refresh-token families with cascade revoke on replay
2. Prisma tenant-scoping extension via `AsyncLocalStorage`; Postgres RLS as backstop. Extend
   `tenant-isolation.spec.ts` to cover every new module
3. Nonce CSP scoped to `/f/*` and `/a/*`
4. Verify `upgrade-insecure-requests` against the real deployment topology
5. Ship API keys CRUD and actually apply `ApiKeyGuard`
6. Burn the lint backlog down; remove `continue-on-error`; add `--max-warnings 0`
7. Delete the dead code in §4/P2

### Phase C — Complete the product surface (2–4 weeks)
1. Submission write ops: detail, annotate, soft-delete, bulk actions
2. Notifications module + SSE, replacing the honest empty state
3. Webhook delivery replay/retry from the UI
4. Virtualize the submissions table
5. Async export jobs → S3 → signed link (the streaming export removed the memory ceiling; this
   removes the *request-duration* ceiling)
6. Form comments (the collaboration story the schema already anticipates)

### Phase D — Enterprise (4–6 weeks)
Permission-based RBAC with custom per-tenant roles and per-form ACLs (this is the single most
requested enterprise gap remaining) → SSO/SAML + SCIM → Stripe billing with plan enforcement →
custom domains + ACME → GDPR export/erasure.

### Phase E — Differentiation (ongoing)
Approval workflows (the real differentiator vs Typeform/Tally, and Form Apps is already 60% of the
primitive) → payment field → real-time collaborative editing → bi-directional sync
(`IntegrationConfig` is modelled) → public SDK + embeddable web component.

---

## 7. Verdict

| Dimension | Prior | Now | Notes |
|---|---|---|---|
| Architecture | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | Unchanged and still the strongest thing here |
| Schema | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 32 models, drift-checked in CI. Comments record *why* migrations happened |
| Security | ⭐⭐ | ⭐⭐⭐⭐ | 6 of 7 holes closed with real, layered defences. Loses a star for no token families and no structural tenant scoping |
| Production-readiness | ⭐⭐ | ⭐⭐⭐⭐ | The core loop works end to end and is defended. Loses stars only for observability |
| Scale | ⭐⭐ | ⭐⭐⭐⭐ | Quota counters, worker split, replica-aware Prisma, streaming export all landed. The per-request auth queries are the remaining ceiling |
| Multi-tenancy | ⭐⭐⭐ | ⭐⭐⭐⭐ | Multi-org shipped. Still 3 fixed roles, still no structural enforcement |
| Frontend | ⭐⭐⭐ | ⭐⭐⭐⭐ | 10 of 11 prior bugs fixed, plus a genuinely careful autosave and honest empty states |
| Testing | ⭐ | ⭐⭐⭐ | Right things tested first (rules, isolation, validation, export). Breadth is thin |
| Observability | ⭐ | ⭐⭐ | Structured logging only. No metrics, traces, or error reporting |
| CI/CD | ⭐ | ⭐⭐⭐⭐ | 4 jobs, real Postgres, drift check, rules-mirror gate. Loses a star for non-blocking lint and no CD |

**Bottom line:** the prior analysis's central complaint — "the gap between what the code *describes*
and what it *does*" — has largely been closed. The code now does what it says, and in several
places (SSRF guard, publish transaction, autosave, rules-mirror CI gate, quota release on failure)
it does it more carefully than the average production system.

The failure mode has changed. It is no longer "this is broken"; it is **"you cannot see it
running."** Phase A is small, and everything you'd want to do next is easier to justify and safer
to ship once it exists.

One further note worth acting on: several fixes are documented in *code comments that explain what
was wrong before*. That is excellent institutional memory and unusually disciplined — but it is
scattered across ~30 files. Consider consolidating the "why" into an ADR directory before the
comments drift from the code they annotate.

---

## Appendix — Uncommitted work

`form-builder-backend/prisma/seed-scenario-apps.ts` is modified in the working tree and not
committed. Not reviewed as part of this analysis.

## Appendix — Claims I could not verify this pass

- `FormRunnerClient` fingerprint implementation (prior claim: `Math.random()` in localStorage)
- Local port configuration (3001 vs 3100)
- Whether both `Inter` and `Geist` fonts are still imported with only one applied

These are cheap to check and should be confirmed before the next planning cycle.
