# Form Builder — Final Comprehensive Implementation Plan

> **Version**: 2.0 — Incorporates all 14 competitor gaps + user feedback  
> **Scope**: Backend (NestJS) + Frontend (Next.js) — full engineering audit + phased roadmap  
> **Notes**: Engineering practices (testing, CI/CD) deferred per user request. Offline/PWA excluded.

---

## Table of Contents

1. [Phase 1 — Foundation Hardening (Week 1-2)](#phase-1--foundation-hardening-week-1-2)
2. [Phase 2 — Core Features & Multi-Tenancy (Week 3-5)](#phase-2--core-features--multi-tenancy-week-3-5)
3. [Phase 3 — Strategic Pillars + Competitive Features (Week 6-9)](#phase-3--strategic-pillars--competitive-features-week-6-9)
4. [Phase 4 — Enterprise & Production (Week 10-12)](#phase-4--enterprise--production-week-10-12)
5. [Phase 5 — AI & Advanced (Week 13+)](#phase-5--ai--advanced-week-13)
6. [Open Questions](#open-questions)

---

## Phase 1 — Foundation Hardening (Week 1-2)

> [!CAUTION]
> **Blockers**: The app has critical security vulnerabilities and broken modules. No feature work until these are resolved.

### Backend Tasks

#### 1.1 Fix `main.ts` Bootstrap
**File**: [main.ts](file:///d:/chrome%20download/vibha%20website/form-builder/form-builder-backend/src/main.ts)

Currently missing all production middleware. Add:
- `app.setGlobalPrefix('v1')` — API versioning
- `app.enableCors({ origin, credentials: true })` — CORS for frontend
- `app.use(helmet())` — Security headers (XSS, clickjacking, MIME-sniff)
- `app.use(compression())` — Response compression (40-60% payload reduction)
- `app.use(cookieParser())` — Required for refresh token cookies
- `app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))` — DTO validation enforcement
- `app.enableShutdownHooks()` — Graceful BullMQ drain on restart
- Swagger setup with `DocumentBuilder` — API documentation

---

#### 1.2 Fix Storage Module (Broken)
**File**: [storage.service.ts](file:///d:/chrome%20download/vibha%20website/form-builder/form-builder-backend/src/modules/storage/storage.service.ts)

**Problem**: 3 breaking issues:
1. Imports from `./storage.config` but global config is at `../../config/storage.config.ts`
2. Writes `organizationId` and `formId` to `FormSubmissionFile` — columns don't exist in schema
3. `submissionId` is required (non-nullable FK) but unknown at presign time

**Fix**:
- Update imports to use global storage config factory
- Make `submissionId` nullable in Prisma schema (files are created before submission)
- Remove invalid field writes
- Add org storage quota check (read `storageQuotaBytes` vs `storageUsedBytes`)
- Add MIME type allowlist validation from architecture doc

---

#### 1.3 Fix Authentication Security
**Files**: [auth.service.ts](file:///d:/chrome%20download/vibha%20website/form-builder/form-builder-backend/src/modules/auth/auth.service.ts), [api.ts](file:///d:/chrome%20download/vibha%20website/form-builder/frontend/src/lib/api.ts)

| Issue | Fix |
|-------|-----|
| Refresh token returned in response body | Set as `HttpOnly, Secure, SameSite=Strict` cookie via `res.cookie()` |
| Frontend stores token in `localStorage` | Remove `localStorage.setItem('access_token')`. Keep access token in React context (in-memory) with silent refresh |
| No email verification | Add verification token on registration → send email with link → `GET /v1/auth/verify-email?token=...` |
| JWT uses HS256 symmetric secret | Evaluate migration to RS256 (see Open Questions) |

---

#### 1.4 Fix Webhook Security
**File**: [submission.processor.ts](file:///d:/chrome%20download/vibha%20website/form-builder/form-builder-backend/src/modules/submissions/queues/submission.processor.ts)

| Issue | Fix |
|-------|-----|
| Uses `createHash` instead of `createHmac` | Change to `crypto.createHmac('sha256', webhook.secret).update(JSON.stringify(payload)).digest('hex')` |
| Webhook delivery blocks submission processing (synchronous, 5s timeout × N webhooks) | Move to separate BullMQ `webhooks_queue` — enqueue webhook job after submission persist |

---

#### 1.5 Add Global Guards & Middleware
**New files in** `src/common/`

| Component | Purpose |
|-----------|---------|
| Health controller (`/health`) | Terminus checks: PostgreSQL + Redis + MinIO. Required for K8s probes |
| Throttle guard (`@nestjs/throttler`) | Global: 100 req/min, Submission endpoint: 10 req/min per IP |
| Request ID middleware | Generate `X-Request-Id` UUID, attach to logger context, propagate to BullMQ jobs |

---

#### 1.6 Add Dockerfile + PgBouncer
**New files**: `Dockerfile`, update `docker-compose.yml`

- Multi-stage Docker build (builder → runner, ~150MB final image)
- Add PgBouncer service to docker-compose for connection pooling
- Update `DATABASE_URL` to use `?pgbouncer=true&connection_limit=5`

---

#### 1.7 Conditional Prisma Query Logging
**File**: [prisma.service.ts](file:///d:/chrome%20download/vibha%20website/form-builder/form-builder-backend/src/common/prisma/prisma.service.ts)

- Development: log all queries with duration
- Production: only log slow queries (>100ms) as warnings
- Remove `emit: 'event', level: 'query'` from production to reduce overhead

---

### Frontend Tasks

#### 1.8 Fix Token Security
**File**: [api.ts](file:///d:/chrome%20download/vibha%20website/form-builder/frontend/src/lib/api.ts)

- Remove all `localStorage.getItem('access_token')` / `localStorage.setItem`
- Refactor auth flow:
  - Access token stored in React Context (memory only, lost on refresh)
  - Silent refresh on app mount via `POST /v1/auth/refresh` (cookie-based)
  - `fetchApi()` gets token from context, not localStorage

#### 1.9 Add Error Boundaries
- Global error boundary wrapping `(dashboard)` layout
- Per-route error boundaries with "Something went wrong" + retry button

#### 1.10 Add Loading States
- Skeleton components for: forms list, submissions table, analytics charts, team members
- Suspense boundaries at route level

---

## Phase 2 — Core Features & Multi-Tenancy (Week 3-5)

> **Goal**: Complete the basic feature set that every form builder must have. Fix multi-tenancy gaps.

### Backend Tasks

#### 2.1 CSV/JSON Export Endpoint 🔴 Critical
**New**: `GET /v1/orgs/:orgId/forms/:formId/export?format=csv|json|xlsx`

- Streaming response for large datasets (cursor-based pagination internally)
- For >10K rows: enqueue BullMQ export job → return download link via notification
- Format options: CSV, JSON, XLSX
- Include question labels as column headers (from FormVersion.questionsJson)

---

#### 2.2 Email Notifications on Submission 🔴 Critical
**Files**: [submission.processor.ts](file:///d:/chrome%20download/vibha%20website/form-builder/form-builder-backend/src/modules/submissions/queues/submission.processor.ts), [mail.service.ts](file:///d:/chrome%20download/vibha%20website/form-builder/form-builder-backend/src/modules/mail/mail.service.ts)

After submission persist in processor:
```
1. Load form.notifyEmails (already in schema)
2. If notifyEmails.length > 0:
   - Build email with submission summary (top 5 answers)
   - Send via MailService (non-blocking, fire-and-forget)
```

---

#### 2.3 Form Cloning 🔴 Critical
**New endpoint**: `POST /v1/orgs/:orgId/forms/:formId/clone`

- Deep copy: form metadata + pagesJson + questionsJson + logicJson + themeConfig
- Generate new slug (nanoid)
- New form starts in DRAFT status
- Does NOT clone submissions, analytics, or webhooks

---

#### 2.4 Pre-fill via URL Parameters 🟡 High
**Frontend only** — no backend changes needed

- Parse URL query params on form load: `?field_email=user@example.com&field_name=John`
- Map params to question IDs → pre-populate default values
- Support both `field_{questionId}` and `field_{questionLabel}` formats

---

#### 2.5 Form Templates System 🟡 High
**New module**: `src/modules/templates/`

```prisma
model FormTemplate {
  id          String @id @default(uuid())
  name        String
  description String?
  category    String     // "survey", "feedback", "registration", "quiz", "order"
  thumbnail   String?    // Preview image URL
  formData    Json @db.JsonB  // { pages, questions, logic, theme }
  isPublic    Boolean @default(true)
  usageCount  Int @default(0)
  createdAt   DateTime @default(now())
}
```

- `GET /v1/templates` — list public templates with categories
- `POST /v1/orgs/:orgId/forms/from-template/:templateId` — create form from template
- Admin can promote published forms to templates

---

#### 2.6 Multi-Layer Spam Detection 🟡 High

| Layer | Implementation | Where |
|-------|---------------|-------|
| 1. CAPTCHA | Cloudflare Turnstile verification | Submissions controller (before enqueue) |
| 2. Honeypot | Hidden `_gotcha` field must be empty | Form renderer (frontend) + processor validation |
| 3. Velocity | Redis sliding window: 10 submissions per IP per form per 60s | Rate limiter guard on submission endpoint |
| 4. Duplicate IP hash | Compare daily-salted IP hash within 1-min window | Submission processor (already partially done ✅) |
| 5. Bot blocklist | Regex patterns on `User-Agent` header | Submission processor pre-validation |

---

#### 2.7 Enforce All Quotas

| Quota | Current State | Fix |
|-------|--------------|-----|
| `maxForms` per org | ✅ Enforced in `createForm()` | — |
| `maxSubmissionsMonth` per org | ❌ Not enforced | Add monthly count check in SubmissionProcessor |
| `maxMembers` per org | ✅ Enforced in `createInvitation()` | — |
| `storageQuotaBytes` per org | ❌ Not enforced in real storage service | Add projected usage check in `generatePresignedUrl()` |

---

#### 2.8 Soft-Delete Forms
**File**: [forms.service.ts](file:///d:/chrome%20download/vibha%20website/form-builder/form-builder-backend/src/modules/forms/forms.service.ts)

- Change `deleteForm()`: `prisma.delete` → `prisma.update({ deletedAt: new Date() })`
- Add `deletedAt: null` filter to ALL form queries
- Add `POST /v1/orgs/:orgId/forms/:formId/restore` for admins
- Add `GET /v1/orgs/:orgId/forms/trash` to list soft-deleted forms

---

#### 2.9 Pagination Everywhere

| Endpoint | Current | Fix |
|----------|---------|-----|
| `getForms()` | Returns ALL forms | Add offset pagination (default limit: 20) |
| `listMembers()` | Returns ALL members | Add pagination |
| `listInvitations()` | Returns ALL invites | Add pagination |
| All admin endpoints | ✅ Already paginated | — |

---

#### 2.10 Cache Strategy Enhancement

| Cache | Key | TTL | Status |
|-------|-----|-----|--------|
| Public form config | `public_form:{slug}` | 5 min | ✅ Done |
| Org quota reads | `org:quota:{orgId}` | 1 min | ❌ Add |
| Form submission count | `form:count:{formId}` | 30 sec | ❌ Add |
| HTTP `Cache-Control` headers | On public form GET | `max-age=300` | ❌ Add |
| Cache invalidation on publish | Delete `public_form:{slug}` | — | ❌ Add |

---

### Frontend Tasks

#### 2.11 Replace Mock Data with Real API
- Wire all TanStack Query hooks to actual backend endpoints
- Add proper mutation invalidation patterns
- Add optimistic updates for form CRUD operations

#### 2.12 Public Form SSR
- Use Next.js `generateMetadata()` for SEO on public form pages
- Server-side fetch of form config
- Client-side hydration for interactive filling

---

## Phase 3 — Strategic Pillars + Competitive Features (Week 6-9)

> **Goal**: Implement the 5 pillars from the analysis document + competitive gaps.

### Pillar 1: Multi-Paradigm Layout Engine

#### Backend
- Add `layoutMode` enum: `'DOCUMENT' | 'CONVERSATIONAL' | 'GRID' | 'PORTAL'`
- Add field to `Form` model (default: `DOCUMENT`)
- Pass layout mode in public form config API response

#### Frontend
| Layout | Description | Implementation |
|--------|-------------|----------------|
| **Document** | Multi-question per page, content-rich | Current default ✅ |
| **Conversational** | Single-question full-screen, keyboard nav, progress bar | New `ConversationalRenderer` component |
| **Grid** | Multi-column dense layout for business forms | New `GridRenderer` with CSS Grid |
| **Portal** | Multi-step wizard with sidebar progress stepper | New `PortalRenderer` component |

Create `<FormRenderer layout={form.layoutMode}>` that switches between renderers.

---

### Pillar 2: Bi-Directional Sync Engine

#### Backend — New `integrations` module
```prisma
model IntegrationConfig {
  id              String @id @default(uuid())
  organizationId  String
  formId          String?        // null = org-wide
  provider        String         // "airtable", "notion", "hubspot", "postgresql"
  credentials     Json @db.JsonB // Encrypted OAuth tokens or API keys
  syncRules       Json @db.JsonB // Field mappings, sync direction, triggers
  isActive        Boolean @default(true)
  createdAt       DateTime @default(now())
}
```

- Pre-fetch endpoint: `POST /v1/forms/:id/prefetch` — query external DB on form load by email/ID
- Post-submit sync: BullMQ job writes back to Airtable/Notion/HubSpot after submission
- Generic connector interface: `fetchRecords()`, `createRecord()`, `updateRecord()`
- Initial connectors: Airtable, Notion, Google Sheets, HubSpot

#### Frontend
- Integration settings panel in form configuration
- Field mapping UI (drag form fields → external columns)
- Dynamic dropdown filtering based on external data

---

### Pillar 3: Visual Logic Node Engine with Math

#### Backend
- Enhanced `LogicRule` schema:
  - Compound conditions (AND/OR groups)
  - Math expressions: `{field_a} * {field_b} > 100`
  - String ops: `STARTS_WITH`, `ENDS_WITH`, `REGEX`
  - Calculated fields (virtual questions with computed values)
- Add `calculatedFieldsJson` to `FormVersion`
- Expression evaluator in submission processor for server-side validation

#### Frontend
- **React Flow** node editor for conditional logic visualization
- Inline math expression builder with autocomplete for `{field_id}` references
- Logic simulator: preview all paths without publishing
- Formula result preview during form design

---

### Pillar 4: Partial Submission Recovery

#### Backend
```prisma
model FormDraft {
  id          String   @id @default(uuid()) @db.Uuid
  formId      String   @map("form_id") @db.Uuid
  fingerprint String   @db.VarChar(64)  // Browser fingerprint or session ID
  answers     Json     @db.JsonB
  lastFieldId String?  @map("last_field_id") @db.VarChar(100)
  progress    Float    @default(0)  // 0.0 to 1.0
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  form Form @relation(fields: [formId], references: [id], onDelete: Cascade)

  @@unique([formId, fingerprint])
  @@index([formId, updatedAt])
  @@map("form_drafts")
}
```

- `PUT /v1/public/forms/:slug/draft` — upsert draft (debounced from frontend)
- `GET /v1/public/forms/:slug/draft?fp=...` — retrieve saved draft
- Cleanup cron: delete drafts older than 30 days
- Dashboard tab: "Draft Leads" showing abandoned entries with contact info

#### Frontend
- Auto-save every 3 seconds (debounced) or on field blur
- Resume prompt: "You have unsaved progress. Continue where you left off?"
- Progress bar showing completion percentage
- Draft indicator icon in form renderer

---

### Pillar 5: Web Component Embed (Shadow DOM)

#### Backend
- `GET /v1/embed/:slug/config` — returns form config + embed settings
- Per-form embed origin allowlist for CORS

#### Frontend — Separate build target
- `<form-builder-embed slug="abc123">` custom element
- Shadow DOM isolates CSS from host page
- CSS custom properties (`--fb-primary-color`, `--fb-font-family`) inherited from host
- Separate Vite build pipeline → CDN-hosted JS bundle
- Usage: `<script src="https://cdn.formbuilder.com/embed.js"></script>`

---

### Competitive Feature: Payment Collection (Stripe)

#### Backend
```prisma
model PaymentConfig {
  id              String @id @default(uuid()) @db.Uuid
  formId          String @unique @map("form_id") @db.Uuid
  stripeAccountId String @map("stripe_account_id")  // Stripe Connect account
  currency        String @default("usd") @db.VarChar(3)
  isActive        Boolean @default(true)
}

model PaymentRecord {
  id              String @id @default(uuid()) @db.Uuid
  submissionId    String @map("submission_id") @db.Uuid
  stripePaymentId String @map("stripe_payment_id")
  amount          Int    // Amount in cents
  currency        String @db.VarChar(3)
  status          String // "succeeded", "pending", "failed"
  createdAt       DateTime @default(now())
}
```

- New `PAYMENT` question type
- Stripe Connect for org-level payment collection
- Stripe Checkout Session created during form submission
- Webhook handler for payment confirmation

#### Frontend
- Stripe Elements embedded in form renderer at payment question
- Payment summary before submission
- Receipt display after successful payment

---

### Competitive Feature: Repeating Sections

#### Backend
- New question type: `REPEATING_SECTION`
- Answers stored as arrays in JSONB: `{ "section_1": [{ "name": "John", "email": "..." }, { "name": "Jane", ... }] }`
- No schema change needed — JSONB already supports nested structures
- Validation in submission processor iterates array items

#### Frontend
- "Add Row" / "Remove Row" buttons in form renderer
- Min/max row count validation
- Template row with configurable sub-fields
- Table-like display in submission viewer

---

### Competitive Feature: AI Form Generation

#### Backend
- `POST /v1/orgs/:orgId/forms/generate` — accepts natural language description
- Calls OpenAI/Claude API to generate structured form JSON
- Returns `{ pages, questions, logic, theme }` matching existing schema
- User can edit/refine before saving

#### Frontend
- "Create with AI" button on forms list page
- Text area: "Describe the form you want to create..."
- Preview generated form → one-click save as draft
- "Refine" button to iterate on generation

---

## Phase 4 — Enterprise & Production (Week 10-12)

### 4.1 HIPAA Compliance Path
- Data encryption at rest (PostgreSQL TDE + MinIO SSE)
- Audit log immutability (no DELETE on audit_logs table)
- BAA-ready infrastructure documentation
- PII field-level encryption option for health data answers

### 4.2 SSO Integration
- SAML 2.0 / OIDC via `passport-saml` + `openid-client`
- Org setting: `ssoEnabled`, `ssoProvider`, `ssoMetadataUrl`
- Just-in-time user provisioning from SSO assertions
- Enforce SSO-only login per organization

### 4.3 Multi-Level Approval Workflows
```prisma
model ApprovalWorkflow {
  id       String  @id @default(uuid()) @db.Uuid
  formId   String  @map("form_id") @db.Uuid
  steps    Json    @db.JsonB  // [{level, approverUserIds, action}]
  isActive Boolean @default(true)
}

model ApprovalDecision {
  id             String   @id @default(uuid()) @db.Uuid
  submissionId   String   @map("submission_id") @db.Uuid
  stepLevel      Int      @map("step_level")
  approverUserId String   @map("approver_user_id") @db.Uuid
  decision       String   // "APPROVED" | "REJECTED" | "ESCALATED"
  comment        String?  @db.Text
  decidedAt      DateTime @default(now()) @map("decided_at")
}
```

### 4.4 Observability Stack
- Sentry integration (backend + frontend error tracking)
- Prometheus `/metrics` endpoint: `submissions_total`, `queue_depth`, `http_duration_ms`
- Structured logging with request correlation IDs
- Grafana dashboard templates

### 4.5 White-Label / Custom Branding
- Custom domain support per organization
- Remove platform branding on enterprise tier
- Custom email templates with org logo/colors

### 4.6 Real-Time Dashboard (WebSocket)
- WebSocket gateway for live submission notifications
- Submission count animation on dashboard
- Real-time respondent activity indicator
- Notification bell with unread count

### 4.7 Accessibility (WCAG 2.1 AA)
- Full keyboard navigation for form builder + renderer
- Screen reader announcements for validation errors
- High-contrast theme option
- Focus management across multi-page forms

### 4.8 Internationalization (i18n)
- `next-intl` for frontend translations
- RTL layout support
- Form creator can add translations per question label

### 4.9 Respondent Authentication Flow
- Login gate on form renderer when `requireAuth=true`
- Link submission to authenticated user
- "My Submissions" view for logged-in respondents

### 4.10 Dynamic Calculations for E-commerce
- Calculated field type with expression evaluation
- Live formula result preview in form renderer
- Server-side calculation validation in submission processor
- Order summary with quantity × price totals

---

## Phase 5 — AI & Advanced (Week 13+)

### 5.1 AI Runtime Optimization
- Track per-field abandonment rates in analytics
- ML model analyzes drop-off patterns
- "AI Suggestions" panel: recommend question reordering, label changes
- A/B testing framework for form variants

### 5.2 Form Scheduling
- `publishAt` DateTime field on Form
- BullMQ delayed job to auto-publish at scheduled time
- Auto-close when `expiresAt` reached (already in schema, needs enforcement)

### 5.3 GDPR Data Retention
- `dataRetentionDays` field on Form
- BullMQ scheduled job: delete submissions older than retention period
- User data export (`GET /v1/auth/my-data`) for GDPR right-of-access
- User data deletion (`DELETE /v1/auth/my-data`) for right-to-erasure

### 5.4 SOC 2 Compliance
- Security policy documentation
- Access control audit evidence
- Encryption-at-rest verification
- Penetration testing schedule

---

## Open Questions

> [!IMPORTANT]
> Please answer these before execution begins — they impact Phase 1 implementation:

1. **JWT Algorithm**: Migrate to RS256 (asymmetric, more secure, allows public key distribution) or keep HS256 (simpler, single secret)?

2. **Multi-Org Support**: Lift the single-org constraint on users? Allow workspace switching?

3. **Pricing Model**: Keep `maxSubmissionsMonth` quotas for freemium tiers, or go unlimited per the analysis doc?

4. **Embed Build**: Web Component embed as a separate package/repo or within the Next.js monorepo?

5. **Storage Default**: Keep MinIO as default, or switch to AWS S3 as primary for SaaS?

6. **AI Provider**: OpenAI (GPT-4) or Anthropic (Claude) for form generation? Or provider-agnostic with adapter pattern?

---

## Execution Summary

| Phase | Weeks | Tasks | Focus |
|-------|-------|-------|-------|
| **Phase 1** | 1-2 | 17 | Security fixes, broken modules, Dockerfile |
| **Phase 2** | 3-5 | 16 | Export, notifications, cloning, quotas, templates, spam |
| **Phase 3** | 6-9 | 14 | 5 Pillars + payments + repeating sections + AI generation |
| **Phase 4** | 10-12 | 10 | HIPAA, SSO, approvals, WebSocket, a11y, i18n |
| **Phase 5** | 13+ | 4 | AI optimization, scheduling, GDPR, SOC 2 |
| **Total** | **14+** | **61 tasks** | **Full competitive platform** |
