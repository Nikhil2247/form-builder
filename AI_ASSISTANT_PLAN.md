# AI Assistant — Full Implementation Plan (Claude-only)

Status: implementation-ready plan, v2. Supersedes v1: adds a platform-level superadmin capability, and replaces Gemini with Claude everywhere (no dual-provider state).

Written after reviewing `prisma/schema.prisma`, the NestJS module structure (`form-builder-backend/src/modules/`), the existing Gemini form-generation feature (`forms.service.ts`), the rules engine (`src/common/rules/`), and the admin/platform module (`src/modules/admin/`).

**Note on data policy**: per the requester, Claude is used under Vibha's own enterprise agreement, so the org-wide "no student data to AI without governance approval" restriction is treated as satisfied at the account level for this project. That's recorded here as a **stated fact from the user**, not something this plan independently verified — worth keeping a written record of the enterprise agreement's data-handling terms on file, since agentic tool access to `FormSubmission.answers` is still worth auditing even when the contractual gate is cleared (§7 keeps the audit trail for that reason — operational hygiene, not a compliance blocker).

---

## 1. Scope: four capabilities, one platform

| # | Capability | Level | Who uses it | Data touched |
|---|---|---|---|---|
| 1 | **Org insights bot** — Q&A over one org's form/Form App responses | Org | Org VIEWER+ | That org's submissions/analytics |
| 2 | **Help/guide bot** — how to build forms, rules, calculations, Form Apps | Org | Org EDITOR+ | Form schema, rules AST, static help docs |
| 3 | **Idea/suggestion bot** — propose forms/Form Apps from a description; review an existing form | Org | Org EDITOR+ | Templates, form schema; writes DRAFT forms |
| 4 | **Platform insights bot (new)** — cross-org Q&A: compare PMUs, platform-wide adoption/usage trends, org health | Platform | `SUPER_ADMIN` only | All orgs' aggregated analytics (never raw answers) |

All four share one Claude integration layer and one router service; #4 is a separate controller with its own guard and its own system prompt/tool set, because its authorization model (bypass org scoping intentionally) must never share a code path with the org-scoped tools by accident.

---

## 2. Provider decision: Claude only, Gemini removed

Replace `generateFormWithAI()` (Gemini, `forms.service.ts:332-409`) with a Claude-backed equivalent inside the new assistant module, and retire the Gemini dependency entirely.

**Migration steps:**
1. Add `@anthropic-ai/sdk` to `form-builder-backend/package.json`; add `ANTHROPIC_API_KEY` to env config (`.env.example`, deployment secrets).
2. Build `IdeaService.generateForm()` in `modules/assistant/` reproducing the current behavior (prompt → structured form JSON → create `Form` in `DRAFT` status → audit log `form.generated_ai`), but via Claude with `output_config.format` (JSON schema) instead of Gemini's system-instruction-constrained JSON parsing.
3. Point `POST /organizations/:orgId/forms/generate` (`forms.controller.ts:80-89`) at the new service (keep the route and its `EDITOR` guard unchanged — only the implementation moves).
4. Delete `@google/genai` from `package.json`, remove `GEMINI_API_KEY` from env config/deployment, delete the old code path in `forms.service.ts`.
5. Update `CODEBASE_ANALYSIS.md` / relevant docs to drop the Gemini reference.

No dual-provider period is needed — cut over in one PR once the new idea service passes the same test cases the Gemini path had (check `forms.service.spec.ts` / equivalent for existing coverage to port).

---

## 3. Data model changes (Prisma)

Add to `prisma/schema.prisma`:

```prisma
model AssistantSession {
  id             String   @id @default(cuid())
  organizationId String?               // null for platform-level (superadmin) sessions
  organization   Organization? @relation(fields: [organizationId], references: [id])
  userId         String
  user           User     @relation(fields: [userId], references: [id])
  mode           AssistantMode
  title          String?               // first-question summary, for a session list UI
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  messages       AssistantMessage[]

  @@index([organizationId, userId])
  @@index([userId, mode])
}

model AssistantMessage {
  id            String   @id @default(cuid())
  sessionId     String
  session       AssistantSession @relation(fields: [sessionId], references: [id])
  role          AssistantMessageRole   // USER | ASSISTANT | TOOL
  content       Json                   // text and/or structured payload (insight card, proposed rule, etc.)
  modelUsed     String?                // "claude-haiku-4-5" | "claude-sonnet-5"
  inputTokens   Int?
  outputTokens  Int?
  cacheReadTokens Int?
  toolCalls     Json?                  // [{name, input, resultSummary}] — never raw PII payloads, see §7
  createdAt     DateTime @default(now())

  @@index([sessionId, createdAt])
}

enum AssistantMode {
  ORG_INSIGHTS
  HELP_GUIDE
  IDEA_SUGGESTION
  PLATFORM_INSIGHTS
}

enum AssistantMessageRole {
  USER
  ASSISTANT
  TOOL
}
```

Add to `Organization`:
```prisma
maxAiQueriesMonth   Int      @default(500)
aiQueriesThisMonth  Int      @default(0)   // reset by existing monthly-quota reset job, same pattern as maxSubmissionsMonth
```

Migration also needs a `@@index` review on `FormAnalytics`/`FormSubmission` for the new cross-org platform queries (likely fine as-is since they're already indexed by `organizationId`; confirm during Phase 3 implementation, not before).

---

## 4. Backend module structure

New module: `form-builder-backend/src/modules/assistant/`

```
assistant/
  assistant.module.ts
  controllers/
    assistant.controller.ts          # /organizations/:orgId/assistant/*  (modes 1-3)
    platform-assistant.controller.ts # /admin/assistant/*                 (mode 4, SuperAdminGuard)
  services/
    claude-client.service.ts         # thin wrapper: model routing, caching config, retries
    router.service.ts                # Haiku call: classify mode/complexity, decide escalate-to-Sonnet
    org-insights.service.ts
    help-guide.service.ts
    idea.service.ts                  # supersedes forms.service.ts#generateFormWithAI
    platform-insights.service.ts
    session.service.ts               # AssistantSession/AssistantMessage CRUD
    quota.service.ts                 # maxAiQueriesMonth enforcement
  tools/
    get-form-schema.tool.ts
    query-submissions.tool.ts        # org-scoped, returns aggregates only
    get-form-analytics.tool.ts       # reads FormAnalytics
    explain-rule.tool.ts             # walks compiledRules AST
    propose-rule.tool.ts             # generates FormRule[], validates via compiler.ts before returning
    search-help-docs.tool.ts         # small static corpus, see §5
    propose-form.tool.ts             # structured form/Form App generation
    review-form.tool.ts
    cross-org-query.tool.ts          # platform-only, explicit org-bypass, used only by platform-assistant.controller
  dto/
    ask-assistant.dto.ts
    assistant-session.dto.ts
  prompts/
    org-insights.system.ts
    help-guide.system.ts
    idea.system.ts
    platform-insights.system.ts
```

**Routing/guards:**
- `assistant.controller.ts`: `JwtAuthGuard, OrgMemberGuard, RoleGuard` — `@RequiredRole('VIEWER')` for insights read endpoints, `@RequiredRole('EDITOR')` for help-authoring and idea-generation endpoints that can write drafts.
- `platform-assistant.controller.ts`: `JwtAuthGuard, SuperAdminGuard` only — deliberately has no `OrgMemberGuard` in its chain, because its entire purpose is cross-org reads. `cross-org-query.tool.ts` must only ever be registered on this controller's Claude client instance, never on the org-scoped one — enforce this with a unit test that asserts the org-scoped tool list excludes it.

**Endpoints:**

| Method | Path | Guard | Purpose |
|---|---|---|---|
| POST | `/organizations/:orgId/assistant/sessions` | VIEWER | start a session (mode: insights/help/idea) |
| POST | `/organizations/:orgId/assistant/sessions/:id/messages` | VIEWER (insights) / EDITOR (help write actions, idea) | send a message, stream response (SSE) |
| GET | `/organizations/:orgId/assistant/sessions` | VIEWER | list a user's past sessions |
| GET | `/organizations/:orgId/assistant/sessions/:id` | VIEWER | load session history |
| POST | `/organizations/:orgId/forms/generate` | EDITOR | unchanged route, now backed by `idea.service.ts` |
| POST | `/admin/assistant/sessions` | SUPER_ADMIN | start a platform-level session |
| POST | `/admin/assistant/sessions/:id/messages` | SUPER_ADMIN | cross-org insight Q&A, streamed |
| GET | `/admin/assistant/sessions` | SUPER_ADMIN | list platform sessions |

---

## 5. Claude integration layer

**`claude-client.service.ts` responsibilities:**
- Single place constructing the Anthropic client (`ANTHROPIC_API_KEY`, dynamic import so a missing key doesn't crash boot — same defensive pattern the Gemini code used).
- Model constants: `MODEL_HAIKU = 'claude-haiku-4-5'`, `MODEL_SONNET = 'claude-sonnet-5'`.
- One static system-prompt + tool-list builder per mode, each cached via a single `cache_control: {type: 'ephemeral'}` breakpoint placed after the fixed instructions/schema/tool-definition block and before the per-request question — this is the one thing every mode's prompt builder must do identically, since caching is where most of the cost saving comes from.
- Structured output helper: wraps `output_config.format` calls for propose-rule/propose-form/insight-card responses, using `client.messages.parse()`-equivalent validation.
- Usage capture: every response's `usage.input_tokens`/`usage.output_tokens`/`usage.cache_read_input_tokens` written onto the corresponding `AssistantMessage` row (§3) — this is what makes real cost tracking possible instead of estimating.

**`router.service.ts`:**
- One Haiku call per incoming user message: classify `{mode, needsToolCalls, needsEscalation}`.
- If the question matches a static help-doc answer with high confidence, return it directly from Haiku without calling Sonnet at all.
- Otherwise dispatch to the mode's service, which escalates to Sonnet only when it needs multi-step reasoning or generation.

**`search-help-docs.tool.ts`:** the help corpus (how to add a rule, how periods work in Form Apps, etc.) is small and static — write it as a curated set of markdown/JSON docs checked into the repo (e.g. `assistant/help-content/*.md`), loaded and lexically/embedding-searched at request time. This is the one place in the system where a lightweight retrieval step (even just a small local embedding index, or to start, simple keyword/BM25 search over ~20-50 docs) is worth it — unlike response data, this corpus doesn't change per-query and won't go stale mid-session.

**Tool design rule (applies to every tool in `tools/`):** every tool returns aggregated/derived JSON, never a raw `FormSubmission.answers` blob array. `query-submissions.tool.ts` takes `{formId, filters, groupBy}` and returns counts/distributions computed via Prisma aggregate queries or `FormAnalytics`, the same way the export/analytics services already query — reuse `analytics.service.ts` query-building logic rather than duplicating it.

---

## 6. Feature list by capability (unchanged core ideas, now Claude-only and with #4 added)

### 1. Org insights bot
- NL Q&A over `FormAnalytics` + aggregate submission queries: completion counts, trends by period, comparisons across Form App periods/subjects within the org.
- Scheduled "insight cards" (anomaly flags) via the Batch API, surfaced on the org dashboard.
- Structured, chart-ready output feeding existing Recharts components.
- Multi-turn drill-down in one session (context editing keeps cost down turn-over-turn).
- Export an insight as a report via the existing `ExportJob` pipeline.

### 2. Help/guide bot
- "How do I…" answers from the static help corpus (§5), Haiku-first.
- "Explain this form" — walks `FormVersion.compiledRules`/`logicJson` and explains it in plain language.
- Rule/calculation authoring: user describes intent → bot proposes `FormRule[]` JSON → validated against `compiler.ts` before display, so nothing unpublishable is ever suggested.
- Plain-language explanation when publish-time compilation rejects a rule (cycle, budget).

### 3. Idea/suggestion bot
- Replaces `generateFormWithAI` — generates single forms **and** full Form App structures (multi-step, with periods) from a description, via Claude structured output.
- "Review my form" — suggests missing validation, better question types, simplification.
- Template suggestions ranked against `FormTemplate.usageCount` + similarity to the description.

### 4. Platform insights bot (superadmin, new)
- Cross-org comparisons: "compare form completion rates between Punjab PMU and Nagaland PMU this quarter," "which orgs are approaching their submission quota," "show adoption trend platform-wide."
- Org health signals: quota utilization, inactive orgs, forms published vs. drafted ratio, error/spam-flag rates by org — pulling from the same data the `/admin/dashboard` and `/admin/system/*` endpoints already expose (`admin.controller.ts`), just conversational instead of fixed dashboard widgets.
- Explicitly out of scope for now: any per-respondent drill-down across orgs — the platform bot answers in aggregates same as the org bot, it just aggregates across the `organizationId` boundary instead of within it.
- Because there's no first-class program/geography model yet (each PMU is one `Organization`), "cross-PMU" today literally means "cross-organization" — call this out in the UI copy so expectations match the data model until a real hierarchy exists.

---

## 7. Governance-lite: what stays even without a policy blocker

Since the enterprise agreement removes the hard governance gate, the plan drops mandatory field-level redaction as a *blocking* requirement, but keeps three things because they're good engineering regardless:

1. **Aggregation-first tool design stays** (§5) — not for compliance, but because it's also the cost-optimal design (§ old-plan §5) and keeps the assistant's answers auditable/explainable (a tool call that returns "312 completions in March" is trivially checkable; one that returns 300 raw answer blobs is not).
2. **Audit logging stays** — every assistant question, tool call, and generated artifact (proposed rule, proposed form) is logged to the existing `AuditLog` model, same as `form.generated_ai` today. This is operational visibility (who asked what, what got proposed/created), not a compliance workaround.
3. **Per-org and platform quota stays** (`maxAiQueriesMonth`) — bounds cost exposure regardless of data policy.

If Vibha's actual enterprise agreement has specific data-handling clauses (retention, training-data opt-out, region), those belong in a short addendum to this doc once the agreement terms are available — worth a quick confirmation pass even though it's not blocking implementation.

---

## 8. Cost optimization (carried over, Claude-only context)

1. Aggregate, don't embed — tools return summaries, not raw rows (§5, §6).
2. One cached system-prompt prefix per mode; per-request data always after the cache breakpoint.
3. One shared tool list per controller (org vs. platform) rather than swapping per sub-mode, to preserve cache hits across a session that moves between insights/help/idea.
4. Structured output (`output_config.format`) for every generative response — bounds output tokens, removes parsing fragility.
5. Context editing (clear stale tool results once summarized) over full compaction for normal sessions.
6. Batch API (50% discount) for scheduled digests (insight cards, platform health summaries) — not user-interactive, so latency doesn't matter.
7. BullMQ-backed async path for heavy multi-form/multi-org analysis, mirroring the export job pattern, so slow answers don't hold an HTTP connection or force over-fetching to answer in one round trip.
8. Haiku-first routing (§5) — the router call classifies and often fully answers the request itself; Sonnet is the exception path, not the default.

**Model assignment by capability:**

| Capability | Default model | Escalates to Sonnet when |
|---|---|---|
| Help/guide | Haiku | Rule generation, non-trivial explanation |
| Org insights | Haiku (routing) → Sonnet (analysis) | Almost always — insight synthesis is Sonnet's job |
| Idea/suggestion | Sonnet | Always — generation quality matters more than cost here |
| Platform insights | Haiku (routing) → Sonnet (cross-org synthesis) | Almost always |

---

## 9. Frontend implementation plan

- New shared chat component (`frontend/src/components/assistant/`) — slide-over panel, reusable across the three org modes and the platform surface, mode passed as a prop.
- Mounted in: `(dashboard)/(shared)` for org insights/help (available to VIEWER+), `(dashboard)/(roles)/editor` for idea/suggestion + rule-authoring, `(dashboard)/(roles)/super-admin` for platform insights.
- Streaming via SSE, reusing the existing pattern from `notification-stream.service.ts` rather than introducing a second streaming mechanism.
- TanStack Query for session list/history; Zustand for local in-flight chat state (matches existing state-management split in the app).
- Insight cards and proposed rules/forms render as structured cards (using the JSON schema from §5's structured-output helper) with explicit "Apply"/"Create draft" actions — the bot proposes, the user confirms, nothing auto-publishes.
- Recharts for any chart-shaped insight output, matching existing dashboard charts.

---

## 10. Phased implementation roadmap

**Phase 0 — Claude infra & Gemini cutover — DONE (2026-08-20)**
- Added `@anthropic-ai/sdk` (0.120.0) and `zod` (structured-output schemas must use the `zod/v4` subpath — see comments in `claude-client.service.ts`); removed `@google/genai` entirely.
- `src/modules/assistant/claude-client.service.ts` — Anthropic client wrapper: dynamic import + boot-safe missing-key handling (mirrors the old Gemini pattern), `MODEL_HAIKU`/`MODEL_SONNET` constants, a `structuredCompletion()` helper (cached system prompt + Zod-validated JSON output via `client.messages.parse()`), usage capture.
- `src/modules/assistant/idea.service.ts` — replaces `FormsService#generateFormWithAI` one-for-one (same inputs, same DRAFT-form output, same `form.generated_ai` audit action), now via Claude Sonnet 5 with structured output instead of Gemini's freeform-JSON parsing. `POST /organizations/:orgId/forms/generate` is unchanged for callers.
- Prisma: added `AssistantMode`, `AssistantMessageRole` enums, `AssistantSession`/`AssistantMessage` models, and `Organization.maxAiQueriesMonth`/`aiQueriesThisMonth`; hand-authored migration `20260820120000_assistant_foundation` (not yet applied to any database — run `bun run db:migrate` locally or `db:migrate:deploy` in deployment when ready).
- Registered `AssistantSession` in `common/tenancy/tenant-scope.extension.ts`'s `ORG_SCOPED_MODELS` — the repo has a test (`tenant-scope.spec.ts`) that fails loudly if an org-scoped model is added without being registered there; it caught this immediately.
- Seeded feature flag `AI_ASSISTANT` (off by default, same dark-launch pattern as `FORM_APPS`/`FORM_RULES`) for the chat-based surfaces coming in later phases — deliberately does **not** gate `/forms/generate`, since that endpoint already worked pre-flag and gating it now would regress existing callers.
- Verified: `tsc --noEmit` clean, ESLint clean (0 new errors), full Jest suite green (577/577; the one pre-existing Redis-dependent export-queue test needs local Redis, unrelated to this change).
- Scope note: `idea.service.ts` generates the same question-type subset the old Gemini prompt did (13 of the 18 `QuestionType` values — no FILE_UPLOAD/SIGNATURE/MATRIX/SECTION_HEADER/REPEATING_SECTION yet). Widening that, and building out the session/tool-catalog/controllers, is Phase 1+ below.
- Not yet decided: whether to add pgvector for help-doc retrieval (Phase 1) and template-similarity ranking (Phase 3) — raised mid-build; folding it in is a Phase 1/3 decision, not a Phase 0 blocker.

**Phase 1 — Help/guide bot — DONE (2026-08-20)**
- `tools/search-help-docs.tool.ts` + `help-content/docs.ts` — 12 curated docs (building forms, question types, validation/calculation/show-hide rules, publishing & versions, Form Apps, periods, choice lists, roles, exporting, troubleshooting). Plain term-overlap scoring, no external index — reasonable at this corpus size; revisit (pgvector, discussed mid-build) once the corpus grows past a few dozen docs.
- `tools/explain-rule.tool.ts` — deterministic AST walk over a form's *current draft* (`Form.rulesJson`/`logicJson`/`questionsJson`, not an old published `FormVersion` snapshot) into plain language. No LLM call — reuses `buildKeyMaps` from `common/rules` for id/key resolution. Handles both the new rules engine and the legacy SHOW/HIDE/JUMP_TO_PAGE system, since both can be active on the same form simultaneously (confirmed from `submissions.service.ts` — this was not obvious going in).
- `tools/propose-rule.tool.ts` — Sonnet generates a rule from a description against a depth-bounded (4 levels, not `z.lazy()` recursive — safer for structured-output JSON Schema) Zod schema covering the engine's full 45-operator set; every proposal is run through the real `compileRules()` before ever being shown, with the compiler's own error messages available for the model to explain. Cross-form references (`RefNode`) are deliberately out of scope for v1 — proposals are same-form only.
- `help-guide.service.ts` — manual tool-use loop (not the SDK's tool runner, since handlers need org-scoped Prisma access), capped at 4 iterations. Model choice deliberately never changes within the loop: it stays on Haiku throughout, and only `propose_rule`'s *internal* generation call escalates to Sonnet — this satisfies the plan's Haiku/Sonnet split in §8 without needing a separate router service.
- `session.service.ts` (`AssistantSession`/`AssistantMessage` persistence) and `quota.service.ts` (Redis-counter monthly quota, same pattern as the existing submissions quota — `Organization.aiQueriesThisMonth` is a best-effort visibility counter, never the enforcement path).
- `assistant.controller.ts` — `POST/GET .../assistant/help/messages` and `.../help/sessions[/:id]`, `EDITOR`+ throughout.
- Frontend: `HelpChatPanel.tsx` built on the repo's existing (previously unused) `message`/`bubble`/`message-scroller` chat-UI kit and `Sheet`, triggered from the dashboard `Header`. Gated on both `useFeature('AI_ASSISTANT')` (off by default) and the new `assistant:use` permission (EDITOR+, added to `config/roles.ts`).
- Scope decisions made explicitly, not by default: **no token streaming** — one request/response per turn, a loading state covers the tool-loop latency; this is an additive upgrade later, not a breaking change to the API shape. Conversation history is replayed as plain text per turn, not raw `tool_use`/`tool_result` blocks, consistent with "context editing over full replay."
- Verified: backend `tsc --noEmit` and ESLint clean, full Jest suite green (583/583); frontend `tsc --noEmit` and ESLint clean. Two more structural safety-net tests caught real gaps and were fixed: `tenant-scope.spec.ts` (Phase 0 — `AssistantSession` wasn't in `ORG_SCOPED_MODELS`) and `tenant-isolation.spec.ts` (Phase 1 — `AssistantController` wasn't in the hand-maintained controller list); both are now registered.
- Not done: actually running the migration against a database, and manually exercising the chat panel in a browser (no local Redis/Postgres in this environment per the toolchain note — needs your own verification pass).

**Phase 2 — Org insights bot — DONE (2026-08-20)**
- `tools/get-form-analytics.tool.ts` — wraps `AnalyticsService` verbatim (`getOrgSummary`/`getGlobalAnalytics`/`getFormAnalytics`/`getTopForms`, imported from `modules/analytics`, zero new query logic) behind one tool with a `view` discriminator (`summary`/`timeseries`/`top_forms`) — the plan's "reuse, don't duplicate" instruction turned out to be fully satisfiable with no new Prisma queries at all.
- `tools/query-submissions.tool.ts` — the one genuinely new query path, for dimensions the daily rollup doesn't have: counts grouped by `status` or by Form App `periodId` (joined against `FormAppPeriod` for label/dates), or a plain total, all within an optional date range on `occurredAt`. Never selects `answers` — confirmed from the schema that it's exactly the free-text/PII-bearing payload the aggregation-only design exists to avoid touching.
- `org-insights.service.ts` — same manual tool-loop shape as `help-guide.service.ts`, but runs on **Sonnet throughout** rather than Haiku: §8's model table has org insights escalating to Sonnet "almost always," so defaulting the whole loop to it — instead of adding a Haiku router pass just to confirm the common case — is the same simplification Phase 1 made for `propose_rule`, applied one level up.
- Chart-ready output (§6/§9's requirement): when the loop calls `get_form_analytics(view=timeseries)`, the raw series is captured and returned alongside the prose reply as `chartData`, so the frontend renders a chart from real numbers rather than the model re-typing them.
- Routing: added `POST/GET .../assistant/insights/messages` and `.../insights/sessions[/:id]` to the *same* `AssistantController` from Phase 1, with a **method-level** `@RequiredRole('VIEWER')` override on top of the class-level `EDITOR` default — confirmed `RoleGuard` reads `getAllAndOverride`, so this is the intended way to mix tiers on one controller rather than splitting into a second one.
- Frontend: `InsightsChatPanel.tsx`, structurally a clone of `HelpChatPanel.tsx` (deliberately not extracted into a shared base — two consumers doesn't justify the abstraction yet), reusing the **existing** `ActivityChart` Recharts component from the dashboard (same `next/dynamic` boundary, same sparse-date-gap-fill logic copied from the dashboard page) rather than building a new chart component. Gated on `useFeature('AI_ASSISTANT')` + `can('analytics:view')` — reused the existing VIEWER-tier permission rather than inventing a new one, since it's exactly the right tier already.
- Verified: backend `tsc --noEmit`/ESLint clean, full Jest suite green (589/589, no new structural-safety-net failures — no new controller or org-scoped model this phase); frontend `tsc --noEmit`/ESLint clean.
- Not done: the Batch API scheduled insight-card digest and BullMQ wiring from the original phase description — descoped from this pass as a standalone enhancement (proactive/scheduled insights, not user-driven Q&A) rather than blocking the interactive bot; worth its own pass once the interactive path has real usage to learn from. Exporting an insight as a report via the existing `ExportJob` pipeline (§6) is similarly deferred.

**Phase 3 — Idea/suggestion bot expansion — DONE (2026-08-20)**
- `IdeaService.generateFormApp()` — extends the Phase 0 single-form generator to a full multi-step Form App: one structured-output Sonnet call proposes a subject type name, an app name/description, and 1–10 steps (each a form's worth of questions), then creates a `SubjectType`, a `FormApp`, and one DRAFT `Form` + `FormAppStep` per step — calling `SubjectsService`/`FormAppsService`'s own creation methods verbatim (slug uniqueness, the 30-step cap, cross-tenant checks) rather than re-deriving that logic, matching those services' own no-`$transaction` sequential-create style. Handles the two realistic collisions gracefully: an existing subject type of the same name is reused instead of erroring, and an app name that collides on slug gets disambiguated rather than failing the whole generation.
- **Scope limit surfaced during research, not guessed past**: only the first step is wired as the registration form (`subjectRole: 'REGISTERS'`, via `SubjectsService#updateSubjectType` — confirmed the *only* place in the codebase that writes that field). Later steps are left at the schema default (`NONE`) rather than asserting an `ATTACHES` role — there is no existing write path for it anywhere in the app today, so inventing one here would create state nothing else in the product can produce or reason about. Flagging this as a real product gap worth its own ticket, not a Phase 3 shortcut.
- `tools/review-form.tool.ts` — always one Sonnet call (unlike `explain_rule`, there's no deterministic path: wording clarity and question-type fit are judgment calls, not something to mechanically check), returns a structured `{summary, suggestions[]}` — explicitly told to return an empty suggestion list for a form that's already fine rather than manufacturing feedback.
- `tools/suggest-templates.tool.ts` — confirmed `FormTemplate` has no `organizationId` at all (platform-global, not org-scoped), so this needed no tenant filter. Ranks by keyword overlap over the same three fields (`name`/`description`/`category`) `TemplatesService`'s own search already checks, with a small bounded `usageCount` nudge — same no-embeddings, keyword-scoring approach as Phase 1's help-doc search, and the same open pgvector question.
- `tools/propose-form.tool.ts` — thin tool wrappers around `generateForm`/`generateFormApp` so the chat loop can trigger either.
- `idea-chat.service.ts` — same tool-loop shape as Phases 1–2, running on **Sonnet throughout** per §8's model table ("Idea/suggestion: Sonnet always" — no cheaper default to fall back to, unlike the help/insights loops).
- Routing: `POST/GET .../assistant/idea/messages` and `.../idea/sessions[/:id]` on the same `AssistantController`, at the class-level `EDITOR` default (no override needed).
- Frontend: `IdeaChatPanel.tsx`, a third structural clone of the same Sheet/MessageScroller/Bubble shell, gated on the same `assistant:use` permission as the help bot (same EDITOR+ tier — both create/propose drafts, unlike insights' read-only VIEWER+ tier).
- Verified: backend `tsc --noEmit`/ESLint clean, full Jest suite green (595/595, no new structural-safety-net failures); frontend `tsc --noEmit`/ESLint clean.
- Not done: linking a created form/Form App's id directly to an "open in builder" action in the chat reply — the bot states the id in plain text (per its system prompt) but the panel doesn't parse or link it yet; a reasonable small follow-up once there's real usage to justify it. Form App periods (recurring reporting windows) are also not generated — every proposed app defaults to `periodMode: NONE`, left for the user to configure if their program needs one.

**Phase 4 — Platform insights bot — DONE (2026-08-21)**
- `tools/cross-org-query.tool.ts` — one tool, four views. `platform_summary` is a pure passthrough to `AdminService.getDashboard()` (zero new queries, same reuse-first pattern Phase 2 used for `get-form-analytics`). `org_breakdown` and `quota_watch` share a `loadOrgBreakdown()` helper that runs exactly 3 bulk queries regardless of org count (`organization.findMany` + two `groupBy`s on `Form`/`FormSubmission`, merged in JS) rather than one query per org. `adoption_trend` is the one genuinely new query the existing admin/analytics endpoints don't answer — a raw `date_trunc('day', occurred_at)` aggregate across `form_submissions` with no `organizationId` filter, since a platform-wide trend line has no per-org dimension to reuse from `AnalyticsService`. Every view returns aggregates only — no tool here can return a single respondent's answers.
- `platform-insights.service.ts` — identical manual tool-loop shape to `org-insights.service.ts` (Sonnet throughout, 4-iteration cap, plain-text history replay), with `orgId` hardcoded to `null` at every session/audit call site instead of threaded through from a route param. `SessionService`'s three methods (`createSession`/`getSession`/`listSessions`) had their `orgId` parameter widened from `string` to `string | null` to support this — a backward-compatible signature change, since `AssistantSession.organizationId` was already nullable in the schema from Phase 0.
- `platform-assistant.controller.ts` — `POST /admin/assistant/messages`, `GET /admin/assistant/sessions[/:id]`, guarded by `JwtAuthGuard, SuperAdminGuard` only, matching `AdminController`'s exact guard chain rather than the plan's originally-sketched `/admin/assistant/sessions/:id/messages` path shape — kept consistent with how `AssistantController` already names its `messages`/`sessions`/`sessions/:id` routes per mode.
- **Quota gap found and closed during implementation**: `QuotaService.assertWithinMonthlyQuota()` is hardwired to look up `Organization.maxAiQueriesMonth` — there is no platform-level equivalent field anywhere in the schema, because a platform session has no Organization row to hold one. Added `assertWithinPlatformMonthlyQuota()` alongside it: a flat Redis counter gated by an env-configurable `PLATFORM_AI_MAX_QUERIES_MONTH` (default 2000/month), with no database-backed limit — the pragmatic choice for a superadmin-only surface over inventing a settings table for one number.
- `AssistantModule` now imports `AdminModule` (already exports `AdminService`) so `PlatformInsightsService` can call `getDashboard()` directly rather than re-deriving the same platform counts a second time. `SystemService`/`/admin/system/*` (health, queue depths, DB/Redis stats) was deliberately **not** wired in — it describes the pod that answered a given request, not cross-org data, so it doesn't fit a *cross-org* query tool; a superadmin already has `/admin/system` for that.
- Structural safety nets: `PlatformAssistantController` added to `tenant-isolation.spec.ts`'s hand-maintained `ALL_CONTROLLERS` list (the file-scan completeness check would otherwise have caught this at CI time regardless). New `platform-insights.spec.ts` source-scans the org-scoped services and `assistant.controller.ts` to assert none of them reference `cross-org-query.tool`/`CROSS_ORG_QUERY_TOOL`, that `platform-insights.service.ts` is the only importer, and that `platform-assistant.controller.ts`'s `@UseGuards(...)` list contains `SuperAdminGuard` but neither `OrgMemberGuard` nor `RoleGuard` — file-scanned rather than instantiated via a Nest testing module, same reasoning `tenant-isolation.spec.ts` already uses (these services need Prisma/Redis/Anthropic DI just to construct, for a check that's really about which files import which).
- Verified: backend `tsc --noEmit` clean, ESLint clean (0 new errors — a handful of new `no-unsafe-*` warnings on `(req.user as any).sub`, identical to the pre-existing pattern in every other controller in this module), full Jest suite green (602/602, up from 595; the one pre-existing Redis-dependent export-queue test still logs its expected `ECONNREFUSED` without failing, unrelated to this change).
- Not done: the frontend surface (`PlatformInsightsChatPanel.tsx`, a `platform/insights` page or trigger under `(dashboard)/(roles)/(super-admin)/platform/`, and a `use-assistant.ts` hook for the new endpoints) — backend-only this pass, matching how the plan's phases are scoped; frontend needs a product decision first (§11: reuse `AI_ASSISTANT` flag with `orgId=null` vs. a new key, and `platform:access` vs. a finer-grained permission — flagged as open, not resolved, by the earlier research pass). Also not done: naming individual orgs by name vs. anonymizing them in cross-org comparisons (§11, still open) — the system prompt and `org_breakdown`/`quota_watch` tool output both return real org names today, consistent with "superadmins already have full visibility," but this was a judgment call, not something the plan settled.

Each phase ships behind its own flag and gets a short usage/cost check (via the `AssistantMessage` token-usage columns from §3) before the next phase starts — this is the checkpoint that validates the caching/routing design is actually holding cost down in practice, not just in theory.

---

## 11. Open questions for the team

- Confirm the enterprise Claude agreement's specific data-handling terms (retention, region, training opt-out) for the record, even though it's not blocking implementation.
- Should platform-insights answers ever be allowed to name individual orgs by name in a comparison, or should smaller/sensitive orgs be anonymized in cross-org comparisons shown to superadmins? (Likely fine to name them since superadmins already have full visibility — flagging only because it's a one-line prompt decision, not a data-access one.)
- Keep the help-doc corpus hand-authored/curated (recommended for accuracy) vs. auto-generated from existing docs (`CODEBASE_ANALYSIS.md` etc.) — recommend starting curated, since the audience is end users of the form builder, not developers.
