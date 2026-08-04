# Comprehensive Form Builder — Backend & Frontend Implementation Plan

> **Scope**: Full engineering audit of the current NestJS backend + Next.js frontend, cross-referenced with the _"Architectural Analysis and Market Gap Breakdown"_ document. This plan identifies **every missing engineering practice, scalability gap, and competitive feature deficit**, then provides a phased, actionable roadmap to build a robust, multi-tenant, production-grade platform.

---

## Part A — Backend Engineering Audit (What's Missing)

### A1. Critical Architecture Gaps

| # | Gap | Current State | Impact | Priority |
|---|-----|--------------|--------|----------|
| 1 | **No API versioning** | Routes have no `/v1/` prefix despite architecture doc specifying it | Breaking changes will hit all clients simultaneously | 🔴 Critical |
| 2 | **No `GlobalPipes` for validation** | `main.ts` doesn't set `ValidationPipe` globally | DTOs with class-validator decorators are never enforced | 🔴 Critical |
| 3 | **No CORS configuration** | `main.ts` doesn't call `app.enableCors()` | Frontend can't call backend in production | 🔴 Critical |
| 4 | **No Helmet middleware** | Security headers not applied | XSS, clickjacking, MIME-sniff vulnerabilities | 🔴 Critical |
| 5 | **No compression** | `compression` package installed but not used | 40-60% larger response payloads | 🟡 High |
| 6 | **No cookie-parser** | Installed but not used in `main.ts` | Refresh token cookies can't be read | 🔴 Critical |
| 7 | **No Swagger setup** | `@nestjs/swagger` installed but never initialized | No API documentation | 🟡 High |
| 8 | **No graceful shutdown** | `enableShutdownHooks()` not called | BullMQ jobs may be lost on restart | 🟡 High |
| 9 | **No health checks** | `@nestjs/terminus` installed but no health controller | K8s probes will fail | 🟡 High |
| 10 | **No Throttle/Rate limiting** | `@nestjs/throttler` installed but never configured | Public submission endpoint is vulnerable to abuse | 🔴 Critical |
| 11 | **StorageService import mismatch** | [storage.service.ts](file:///d:/chrome%20download/vibha%20website/form-builder/form-builder-backend/src/modules/storage/storage.service.ts) imports from `./storage.config` but global config is at `../../config/storage.config.ts` | Storage module likely broken | 🔴 Critical |
| 12 | **FormSubmissionFile schema mismatch** | Storage service tries to write `organizationId` and `formId` on `FormSubmissionFile` but schema has neither column | Runtime Prisma error on every file upload | 🔴 Critical |
| 13 | **No `submissionId` on file create** | `FormSubmissionFile.submissionId` is a required non-nullable FK but storage service doesn't have one at presign time | Constraint violation error | 🔴 Critical |

---

### A2. Multi-Tenancy Hardening Gaps

| # | Gap | Risk |
|---|-----|------|
| 1 | **Forms service `deleteForm` does hard-delete** | Cascade-deletes all submissions, files, analytics irreversibly. Should use soft-delete (`deletedAt`) |
| 2 | **No tenant-scoped cache invalidation** | `public_form:{slug}` cache key doesn't include org context. If two orgs ever share similar slugs (unlikely but possible), stale data risk |
| 3 | **No monthly submission quota enforcement** | Schema has `maxSubmissionsMonth` on Organization but no code enforces it |
| 4 | **No storage quota check in actual storage service** | Only the architecture doc's example code checks storage quota. The real [storage.service.ts](file:///d:/chrome%20download/vibha%20website/form-builder/form-builder-backend/src/modules/storage/storage.service.ts) skips it |
| 5 | **Org-level RLS not enforced at DB level** | Relies on service-layer WHERE clauses only. A single missed filter = cross-tenant data leak |
| 6 | **No tenant-level rate limiting** | Rate limits should be per-org in addition to per-IP |

---

### A3. Performance & Scalability Gaps

| # | Gap | Fix |
|---|-----|-----|
| 1 | **Forms list has no pagination** | `getForms()` returns ALL forms for an org with `findMany()` — no skip/take | Add cursor or offset pagination |
| 2 | **No index on `formSubmissions.formId + submittedAt`** | Schema has it, but worth verifying migration ran |
| 3 | **Webhook delivery is synchronous in submission processor** | `processWebhooks` runs inside the submission job. If 5 webhooks × 5s timeout each = 25s blocking | Move to separate BullMQ `webhooks_queue` |
| 4 | **No batch inserts** | Each submission creates 1 row + 1 analytics UPSERT. At high throughput, consider batching |
| 5 | **Prisma query logging on ALL queries in production** | `emit: 'event', level: 'query'` on every query. Huge overhead at scale | Conditional on `NODE_ENV` |
| 6 | **No connection pooling guidance** | No PgBouncer in docker-compose. Direct Prisma connections will exhaust PostgreSQL at ~100 concurrent |
| 7 | **Redis service creates new connection per request cycle** | Single ioredis instance is correct, but `BullModule.forRoot` creates a separate connection. Need shared connection factory |
| 8 | **No response compression** | Large JSON payloads (submission exports) sent uncompressed |

---

### A4. Security Gaps

| # | Gap | Risk |
|---|-----|------|
| 1 | **JWT uses HS256 symmetric secret** | Architecture doc specifies RS256 asymmetric. Current code uses a single `JWT_SECRET`. If leaked, all tokens compromised |
| 2 | **Refresh token not in HttpOnly cookie** | `auth.service.ts` returns `refreshToken` in response body. Frontend stores it in localStorage. XSS = full account takeover |
| 3 | **No CAPTCHA verification** | Submission controller doesn't verify Cloudflare Turnstile tokens before enqueuing |
| 4 | **No input sanitization on JSONB** | Answers payload goes directly to Prisma without deep sanitization |
| 5 | **Webhook HMAC uses SHA-256 hash, not HMAC** | `createHash('sha256').update(payload + secret)` is NOT HMAC. Should use `createHmac('sha256', secret).update(payload)` |
| 6 | **API key guard doesn't hash-compare** | Needs timing-safe comparison (`crypto.timingSafeEqual`) |
| 7 | **No email verification flow** | `emailVerified` field exists but no verification email is sent on registration |
| 8 | **MFA secret stored in plain text** | `mfaSecret` should be encrypted at rest |

---

### A5. Missing Engineering Practices

| # | Practice | Status |
|---|----------|--------|
| 1 | **Unit Tests** | Only `app.controller.spec.ts` exists (boilerplate). Zero business logic tests |
| 2 | **Integration Tests** | No database integration tests |
| 3 | **E2E Tests** | `test/` directory exists but empty |
| 4 | **CI/CD Pipeline** | No GitHub Actions, no Dockerfile |
| 5 | **Database Migrations** | No `prisma/migrations/` directory — schema has never been migrated |
| 6 | **Logging Correlation** | No request-scoped correlation IDs flowing through BullMQ jobs |
| 7 | **Error Monitoring** | No Sentry/Datadog integration |
| 8 | **API Documentation** | Swagger installed but not initialized |
| 9 | **Environment Validation** | Joi schema validates env but doesn't fail-fast on missing required vars |
| 10 | **Code Coverage** | Jest coverage configured but never run |
| 11 | **Database Seeding** | No seed script for development data |
| 12 | **OpenTelemetry/Prometheus** | Architecture doc mentions Prometheus metrics but none implemented |
| 13 | **Dockerfile** | No Dockerfile for containerized deployment |

---

## Part B — Frontend Engineering Audit

### B1. Current Frontend State

| Aspect | Status |
|--------|--------|
| **Framework** | Next.js 16 + React 19 + TailwindCSS 4 |
| **State Management** | TanStack Query for server state |
| **UI Library** | Shadcn/ui + Radix primitives |
| **Form Builder** | Drag-and-drop with @dnd-kit |
| **Auth** | Custom hooks (`use-auth.ts`) with localStorage token |
| **API Client** | Custom `fetchApi()` with token refresh |
| **Animations** | Framer Motion |
| **Charts** | Recharts |
| **Export** | XLSX export utility |

### B2. Frontend Gaps

| # | Gap | Impact |
|---|-----|--------|
| 1 | **Using mock data** | [mockData.ts](file:///d:/chrome%20download/vibha%20website/form-builder/frontend/src/lib/mockData.ts) suggests forms/dashboard still use hardcoded data |
| 2 | **No error boundaries** | Runtime errors crash the entire app |
| 3 | **No loading skeletons** | Flash of empty content on navigation |
| 4 | **No offline/PWA support** | Forms can't be filled offline |
| 5 | **No form auto-save** | Partial submissions lost on page close (critical gap from analysis doc) |
| 6 | **No Web Component embed** | Analysis doc's Pillar 5 — Shadow DOM embedding not implemented |
| 7 | **No conversational card view** | Analysis doc's Pillar 1 — only document view exists |
| 8 | **No bi-directional sync UI** | Analysis doc's Pillar 2 — no integration configuration screens |
| 9 | **No visual logic node editor** | Analysis doc's Pillar 3 — basic conditional logic only |
| 10 | **No partial submission recovery** | Analysis doc's Pillar 4 — no draft save mechanism |
| 11 | **Token stored in localStorage** | XSS vulnerability — should use HttpOnly cookies |
| 12 | **No SSR for public forms** | Public form pages should be SSR'd for SEO and performance |
| 13 | **No i18n/l10n** | No internationalization support |
| 14 | **No accessibility audit** | No WCAG 2.1 AA compliance verification |
| 15 | **No real-time updates** | No WebSocket/SSE for live submission notifications |

---

## Part C — Comprehensive Implementation Roadmap

### Phase 1: Foundation Hardening (Week 1-2)

> **Goal**: Make the existing code production-safe. Zero new features — pure engineering.

#### Backend

##### 1.1 Fix `main.ts` Bootstrap (Critical)
```typescript
// All of these are MISSING and must be added:
app.setGlobalPrefix('v1');
app.enableCors({ origin: config.cors.origins, credentials: true });
app.use(helmet());
app.use(compression());
app.use(cookieParser());
app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
app.enableShutdownHooks();
```

##### 1.2 Fix Storage Module
- Align `storage.service.ts` imports to use global `../../config/storage.config.ts`
- Fix `FormSubmissionFile` creation to handle nullable `submissionId` (make it nullable in schema or use a pending placeholder pattern)
- Add MIME type allowlist validation
- Add org storage quota check

##### 1.3 Fix Authentication Security
- Move refresh token to HttpOnly cookie (set in response, read via `cookie-parser`)
- Add `SameSite=Strict` and `Secure` flags
- Stop returning refresh token in response body
- Add email verification flow with token + confirmation endpoint

##### 1.4 Add Global Middleware Stack
- Swagger setup with `DocumentBuilder`
- Health check controller (Terminus: DB + Redis + MinIO)
- Rate limiting with `@nestjs/throttler` (global + per-route overrides)
- Request ID propagation via `X-Request-Id` header

##### 1.5 Fix Webhook Security
- Change `createHash` → `createHmac` for HMAC-SHA256 signatures
- Move webhook dispatch to separate BullMQ queue (decouple from submission processing)

##### 1.6 Add Dockerfile
```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npx prisma generate && npm run build

FROM node:22-alpine AS runner
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
CMD ["node", "dist/main.js"]
```

##### 1.7 Add PgBouncer to Docker Compose
- Connection pooling for PostgreSQL
- Configure Prisma `?pgbouncer=true&connection_limit=5`

#### Frontend

##### 1.8 Fix Token Security
- Remove `localStorage.getItem('access_token')`
- Refactor `fetchApi()` to rely on HttpOnly cookie-based auth
- Access token can be kept in memory (React context) with silent refresh

##### 1.9 Add Error Boundaries
- Global error boundary wrapping `(dashboard)` layout
- Per-page error boundaries for graceful degradation

##### 1.10 Add Loading States
- Skeleton components for forms list, submissions table, analytics charts

---

### Phase 2: Multi-Tenancy & Scalability (Week 3-4)

#### Backend

##### 2.1 Enforce ALL Quotas
```typescript
// Monthly submission quota enforcement in SubmissionProcessor
const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);
const monthlyCount = await prisma.reader.formSubmission.count({
  where: { form: { organizationId: orgId }, submittedAt: { gte: monthStart } }
});
if (monthlyCount >= org.maxSubmissionsMonth) throw new ForbiddenException('Monthly submission limit reached');
```

##### 2.2 Add Soft-Delete to Forms
- Change `deleteForm()` from `prisma.delete` → `prisma.update({ deletedAt: new Date() })`
- Add `deletedAt: null` filter to all form queries
- Add restore endpoint for admins

##### 2.3 Pagination Everywhere
- `getForms()` — add offset pagination with default limit 20
- `listMembers()` — add pagination
- `listInvitations()` — add pagination
- Use the existing `prisma-extension-pagination` consistently

##### 2.4 Cache Strategy Implementation
```
Cache Layer 1: Redis cache-aside for public forms (5 min TTL) ✅ Already done
Cache Layer 2: Redis cache for org quota reads (1 min TTL) ← MISSING
Cache Layer 3: BullMQ result caching for analytics aggregations ← MISSING
Cache Layer 4: HTTP cache headers (ETag, Cache-Control) on static form configs ← MISSING
```

##### 2.5 Separate Worker Entrypoint
- Create `src/worker.ts` as a separate NestJS app that only registers BullMQ processors
- Don't register HTTP controllers in worker mode
- This enables independent scaling of API vs Worker pods

##### 2.6 Add CAPTCHA Verification
```typescript
// In SubmissionsController, before enqueue:
async verifyCaptcha(token: string): Promise<boolean> {
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: JSON.stringify({ secret: process.env.CLOUDFLARE_TURNSTILE_SECRET, response: token }),
    headers: { 'Content-Type': 'application/json' },
  });
  const data = await res.json();
  return data.success;
}
```

##### 2.7 Conditional Prisma Logging
- Only log queries in `development` mode
- In production, only log slow queries (>100ms) as warnings

#### Frontend

##### 2.8 Real API Integration
- Replace all mock data with actual API calls using TanStack Query
- Add proper mutation invalidation patterns
- Add optimistic updates for form CRUD

##### 2.9 Public Form SSR
- Use Next.js `generateMetadata()` for SEO
- Server-side fetch of public form data
- Client-side hydration for interactive form filling

---

### Phase 3: Advanced Features from Analysis Doc (Week 5-8)

> These map directly to the **5 Strategic Pillars** from the analysis document.

#### Pillar 1: Multi-Paradigm Layout Engine

##### Backend Changes
- Add `layoutMode` field to `Form` model: `'DOCUMENT' | 'CONVERSATIONAL' | 'GRID' | 'PORTAL'`
- Store layout preference per form; pass to frontend in public form config
- No backend logic change needed — this is purely a rendering concern

##### Frontend Changes
- **Document View** (current): Multi-question per page, slash-command-style editor
- **Conversational Card View**: Single-question full-screen with keyboard navigation (Typeform-style)
- **Dense Grid View**: Multi-column responsive grid (Cognito Forms-style)
- **Portal View**: Multi-step wizard with progress stepper
- Create a `<FormRenderer layout={form.layoutMode}>` component that switches renderers

#### Pillar 2: Bi-Directional Sync Engine

##### Backend Changes
- New `integrations` module with:
  - `IntegrationConfig` model (stores OAuth tokens, API keys, sync rules per form)
  - Pre-fetch webhook endpoint: `POST /v1/forms/:id/prefetch` — queries external DB on form load
  - Post-submit sync: BullMQ job that writes back to Airtable/Notion/HubSpot
  - Generic connector interface: `{ fetchRecords(), createRecord(), updateRecord() }`

##### Frontend Changes
- Integration configuration panel in form settings
- Dynamic field pre-population based on URL params or respondent email lookup
- Dropdown option filtering based on external data source

#### Pillar 3: Visual Logic Node Engine

##### Backend Changes
- Enhanced `LogicRule` schema to support:
  - Compound conditions (AND/OR groups)
  - Math expressions: `{field_a} * {field_b} > 100`
  - String operations: `STARTS_WITH`, `ENDS_WITH`, `REGEX`
  - Calculated fields (virtual questions whose value is computed)
- Add `calculatedFieldsJson` to `FormVersion`

##### Frontend Changes
- React Flow-based node editor for conditional logic
- Inline math expression builder with autocomplete for field references
- Logic simulator/debugger: preview all paths without publishing

#### Pillar 4: Partial Submission Recovery

##### Backend Changes
- New `FormDraft` model:
  ```prisma
  model FormDraft {
    id            String   @id @default(uuid())
    formId        String
    fingerprint   String   // Browser fingerprint or session ID
    answers       Json     @db.JsonB
    lastFieldId   String?  // Last field the user interacted with
    progress      Float    // 0.0 to 1.0
    createdAt     DateTime @default(now())
    updatedAt     DateTime @updatedAt
    @@unique([formId, fingerprint])
    @@index([formId, updatedAt])
  }
  ```
- API endpoint: `PUT /v1/public/forms/:slug/draft` — upserts draft
- API endpoint: `GET /v1/public/forms/:slug/draft?fp=...` — retrieves draft
- Auto-cleanup: BullMQ scheduled job deletes drafts older than 30 days
- Dashboard view: "Draft Leads" tab showing abandoned form entries

##### Frontend Changes
- Debounced auto-save (every 3 seconds or on field blur)
- Resume prompt: "You have unsaved progress. Continue where you left off?"
- Progress indicator showing completion percentage

#### Pillar 5: Web Component Embed (Shadow DOM)

##### Backend Changes
- New endpoint: `GET /v1/embed/:slug/config` — returns form config + embed settings
- CORS configured to allow embed origins specified per form

##### Frontend Changes
- Build a standalone Web Component (`<form-builder-embed slug="...">`)
- Uses Shadow DOM to isolate CSS from host page
- CSS custom properties (`--fb-primary-color`) inherited from host
- Published as an npm package + CDN script tag
- Separate Vite build pipeline for the embed component

---

### Phase 4: Enterprise & Production (Week 9-12)

#### Backend

##### 4.1 Testing Suite
```
Unit Tests:
  - AuthService (register, login, refresh, MFA flows)
  - FormsService (CRUD, publish, versioning, quota enforcement)
  - SubmissionProcessor (validation, grading, spam detection)
  - WebhookProcessor (HMAC signing, retry logic)
  - StorageService (presigned URL generation, quota check)

Integration Tests:
  - Full submission pipeline (enqueue → process → persist → analytics)
  - Organization lifecycle (create → invite → accept → role change)
  - Form publish → version snapshot correctness

E2E Tests:
  - Registration → Login → Create Org → Create Form → Publish → Submit → View Submissions
  - File upload flow (presigned URL → upload → verify)
  - Webhook delivery round-trip
```

##### 4.2 CI/CD Pipeline (GitHub Actions)
```yaml
jobs:
  test:
    - Lint (ESLint)
    - Unit tests (Jest)
    - Integration tests (with Docker Compose for PG + Redis)
    - Build check
  deploy-staging:
    - Build Docker image
    - Push to registry
    - Deploy to staging K8s
  deploy-production:
    - Manual approval gate
    - Blue-green deployment
```

##### 4.3 Observability Stack
- **Sentry** for error tracking (backend + frontend)
- **Prometheus** metrics endpoint (`/metrics`)
  - `submissions_total`, `queue_depth`, `http_request_duration_ms`, `db_query_duration_ms`
- **Grafana** dashboards
- **OpenTelemetry** distributed tracing (request → queue → worker → DB)

##### 4.4 HIPAA Compliance Path
- Data encryption at rest (PostgreSQL TDE + MinIO SSE)
- Audit log immutability (append-only, no DELETE)
- BAA-ready infrastructure documentation
- PII field-level encryption for answers containing health data

##### 4.5 Multi-Level Approval Workflows
```prisma
model ApprovalWorkflow {
  id        String @id @default(uuid())
  formId    String
  steps     Json   @db.JsonB  // [{level: 1, approvers: [userId], action: 'APPROVE|REJECT|ESCALATE'}]
  isActive  Boolean @default(true)
}

model ApprovalDecision {
  id             String @id @default(uuid())
  submissionId   String
  workflowStepId String
  approverUserId String
  decision       String // APPROVED | REJECTED | ESCALATED
  comment        String?
  decidedAt      DateTime @default(now())
}
```

##### 4.6 SSO Integration
- SAML 2.0 / OIDC support via `passport-saml` and `openid-client`
- Enterprise org setting to enforce SSO login
- Just-in-time user provisioning from SSO assertions

#### Frontend

##### 4.7 White-Label / Custom Branding
- Custom domain support per organization
- Remove all platform branding on enterprise tier
- Custom email templates with org logo/colors

##### 4.8 Real-Time Dashboard
- WebSocket connection for live submission notifications
- Submission count animation on dashboard
- Real-time respondent activity indicator

##### 4.9 Accessibility (WCAG 2.1 AA)
- Full keyboard navigation for form builder + renderer
- Screen reader announcements for form validation errors
- High-contrast theme option
- Focus management across multi-page forms

##### 4.10 Internationalization
- `next-intl` for frontend i18n
- RTL layout support
- Form creator can provide translations per question

---

## Part D — Backend Performance Optimization Strategies

### D1. Database Layer
| Strategy | Implementation |
|----------|---------------|
| **Connection Pooling** | PgBouncer in `transaction` mode. Prisma `connection_limit=5` per instance |
| **Read Replicas** | Already in PrismaService ✅. Ensure all read-heavy queries use `prisma.reader` |
| **GIN Index** | Add `CREATE INDEX ... USING GIN (answers jsonb_path_ops)` via migration |
| **Table Partitioning** | Monthly partitions on `form_submissions` by `submitted_at` at >5M rows |
| **Materialized Views** | For analytics dashboard aggregations. Refresh every 5 minutes via cron |
| **Query Optimization** | Use `select` clauses everywhere (never `include: { all: true }`). Already mostly done ✅ |

### D2. Application Layer
| Strategy | Implementation |
|----------|---------------|
| **Worker Separation** | Dedicated worker processes that don't serve HTTP |
| **Job Batching** | BullMQ `group` feature for batching analytics UPSERTs |
| **Response Compression** | Brotli/gzip via `compression` middleware |
| **JSON Serialization** | Consider `fast-json-stringify` for known response shapes |
| **Memory Profiling** | Ensure presigned URLs bypass NestJS memory (already designed correctly ✅) |

### D3. Caching Layer
| Strategy | Implementation |
|----------|---------------|
| **Redis Cache-Aside** | Public form config (5 min), org quotas (1 min), user sessions (15 min) |
| **Cache Invalidation** | Publish/update form → `redis.del('public_form:{slug}')` |
| **HTTP Caching** | `Cache-Control: public, max-age=300` on public form endpoints |
| **CDN** | Cloudflare/CloudFront for static assets + API edge caching |

### D4. Infrastructure Layer
| Strategy | Implementation |
|----------|---------------|
| **HPA** | CPU-based for API pods, queue-depth-based for worker pods |
| **Pod Anti-Affinity** | Spread API pods across availability zones |
| **Resource Limits** | `requests: 256Mi/250m`, `limits: 512Mi/500m` per pod |
| **Readiness Probes** | `/health` endpoint with DB + Redis checks |
| **Blue-Green Deploys** | Zero-downtime with database migration compatibility |

---

## Part E — Priority Execution Order

> [!IMPORTANT]
> **Phase 1 items are blockers.** The app currently has critical security vulnerabilities (no CORS, no Helmet, tokens in localStorage, broken storage module) that must be fixed before any new feature work.

```
Week 1-2:  Phase 1 — Foundation Hardening (security, bootstrap, storage fixes)
Week 3-4:  Phase 2 — Multi-Tenancy & Scalability (quotas, pagination, caching)
Week 5-6:  Phase 3a — Partial Submissions + Multi-Layout Engine
Week 7-8:  Phase 3b — Visual Logic Engine + Bi-Directional Sync
Week 9-10: Phase 4a — Testing Suite + CI/CD + Observability
Week 11-12: Phase 4b — Enterprise Features (SSO, Approvals, HIPAA)
Week 13+:  Phase 5 — Web Component Embed + White-Label + i18n
```

---

## Open Questions

> [!WARNING]
> The following decisions will impact the implementation plan. Please review:

1. **JWT Algorithm**: The architecture doc says RS256 (asymmetric) but the code uses HS256 (symmetric `JWT_SECRET`). Should we migrate to RS256 now (requires key pair generation + rotation strategy) or keep HS256 for simplicity?

2. **Multi-Org Support**: Currently users belong to exactly ONE org (`@@unique([userId])` on `OrganizationMember`). The analysis doc implies workspace switching. Should we lift this constraint?

3. **Pricing Tiers**: The analysis doc advocates "unlimited text submissions". Should quotas (`maxSubmissionsMonth`) be retained for a freemium model, or removed entirely per the doc's recommendation?

4. **Embed Strategy**: Should the Web Component embed be a separate package/repo, or built within the Next.js monorepo?

5. **Storage Default**: Current code uses MinIO (self-hosted). For a SaaS product targeting broad adoption, should the default be AWS S3 with MinIO as a self-hosted alternative?

6. **AI Features**: The analysis doc mentions AI runtime optimization (dynamic question reordering, drop-off analysis). Is this in scope for the current roadmap?

---

## Verification Plan

### Automated Tests
- `npm run test` — Unit tests for all services
- `npm run test:e2e` — End-to-end tests with Docker Compose deps
- `npm run test:cov` — Coverage report (target: >80%)
- `npx prisma migrate deploy` — Verify migrations apply cleanly
- `docker compose up --build` — Full stack smoke test

### Manual Verification
- Test public form submission flow end-to-end in browser
- Verify file upload with presigned URLs
- Test webhook delivery with RequestBin
- Verify refresh token rotation with cookie inspection
- Load test with `autocannon` or `k6` (target: 1000 submissions/sec)
