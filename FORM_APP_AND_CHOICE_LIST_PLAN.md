# Plan — Choice Lists & Form Apps as Multi-Step Programmes

**Date:** 2026-08-10
**Goal:** reproduce the Samagra Shiksha Nagaland *Monitoring Progress Reporting System* — and anything shaped like it — as **configuration in our builder**, not as a hand-written app.
**Companion doc:** `FORM_CAPABILITY_ANALYSIS.md` (Phase 1 runner/rules fixes, already applied).

---

## 0. The central insight

You said the Form App module feels like the right fit. It is — and it is a better fit than it first appears.

Look at what the reference form actually is:

| Section | What it really is |
| --- | --- |
| A — Respondent Details | Answered **once**. Identifies who is reporting. |
| Training Attended | **Zero or more** records, each with the same five fields. |
| Training Conducted | **Zero or more** records, same shape. |
| B — School Monitoring | **One or more** substantial records, each with a checklist, a numeric block and a conditional sub-group. |
| *Submit All Reports* | All of it lands together, as one act. |

The obvious reading is "one form with three repeat groups". That reading is a trap. Repeat groups force the hardest problem in the whole system: **rules would need per-row scoping**. A rule like "show 9.2 only when 9.1 is Yes" has to mean *this row's* 9.1 — and our rules address a flat `key → value` map. Solving that means re-architecting the engine's addressing, the compiler's dependency graph, and the answer shape.

The better reading — and the one that matches how the data is actually used — is:

> **A Form App is a guided, multi-step session over one subject. Each step is a form, submitted once or many times. Each repetition is its own submission.**

Under that model:

- "School Visit #2" is a **second submission** of the *School Monitoring* form, bound to the same subject.
- Rules inside it stay **flat**. `9.2 shows when 9.1 = Yes` is an ordinary SHOW rule, because each visit is its own answer set. **No per-row scoping is needed at all.**
- Each visit is independently queryable, exportable, countable, and analysable — which is what the ministry actually wants from this data. A repeat group buries all of that inside one JSONB blob.
- Versioning, validation, the rules engine, subject binding and the submissions pipeline **already work this way**. We are configuring existing machinery, not building new machinery.

`Subject`, `SubjectType`, `Form.subjectRole` (`REGISTERS` / `ATTACHES`), `FormApp`, and cross-form `ref` nodes already exist. What is missing is the **session** that ties several submissions into one act, the **step configuration** that drives the UI, and **choice lists**.

Inline repeat groups still have a place — for genuinely small, non-queryable lists — but they become Phase D, not a blocker.

---

## 1. What the reference form needs, mapped to work

| Reference construct | Mechanism | Phase |
| --- | --- | --- |
| District / Block dropdowns | Choice list + cascade | **A** |
| School Name dropdown filtered by Block | Choice list cascade, 2 levels deep | **A** |
| UDISE Code auto-fills from School | `lookup()` operator + CALCULATE rule → renders read-only (already works since Phase 1) | **A** |
| Section A answered once | Step with `mode: SINGLE`, `subjectRole: REGISTERS` | **B** |
| "+ Add Training" / "+ Add School Visit" | Step with `mode: REPEATABLE` | **B** |
| *Optional* badge, "You can add multiple…" | Step `isOptional`, `description` | **B** |
| Collapsible "School Visit #1" cards | App runner entry accordion | **B** |
| *Submit All Reports* | Session submit — one transaction, N submissions | **B** |
| "Duplicate schools not allowed" | Step `uniqueBy: ['school_name']` | **C** |
| `Feb – May 2026 · Fixed Reporting Period` | `FormAppPeriod` | **C** |
| Header logo, green theme, gov footer | App-level theme + branding | **C** |
| 9.2/9.3 shown only when 9.1 = Yes | Ordinary SHOW rules — **works today** | — |
| 8.2 ≤ 8.1 numeric constraints | Ordinary VALIDATE rules — **works today** | — |
| 7-row Yes/No/NA checklist | `MATRIX` (rows = items, columns = Yes/No/NA) — **works today** | — |
| `Reset` button | App runner control | **C** |
| Numbered labels `8.1`, `9.3` | Author types them, or Phase D auto-numbering | D |

**Two-thirds of the form already works.** The gaps are choice lists and the session.

---

## 2. The India states/districts data — delivered

`form-builder-backend/prisma/data/in-states-districts.json`

- **36 states/UTs, 784 districts**, extracted from IGOD (`igod.gov.in/sg/{CODE}/E042/organizations`) on 2026-08-10.
- Validated: no duplicate names within a state, no value collisions across the whole set.
- Value scheme: state = the IGOD two-letter code (`NL`); district = `{STATE}-{slug}` (`NL-kohima`). Districts carry `parentValue = state code`, which is exactly the cascade shape in §3.

**Caveats, recorded in the file's `_meta` and repeated here because they matter:**

- **IGOD has no blocks and no schools.** The reference form needs District → **Block** → **School (UDISE)**. Those must come from elsewhere:
  - **Blocks/sub-districts:** LGD — `lgdirectory.gov.in`, which publishes State/District/Sub-district/Block/Village with official LGD codes as downloadable CSV. This is the canonical source and should be preferred over IGOD if you want codes.
  - **Schools + UDISE codes:** UDISE+ — `udiseplus.gov.in`. School lists are per-state downloads. For Nagaland this is a few thousand rows.
- **No LGD/census codes** in this extract — IGOD exposes only opaque internal ids. The value scheme is designed so a `code` column can be added later **without touching a single stored answer**.
- **Puducherry** is missing Mahe and Yanam in IGOD (2 of 4 districts). Not silently added — the file is exactly what the source contains.
- **Delhi** shows 13 entries including "Central North", "Old Delhi", "Outer North", which are not among the 11 standard revenue districts.
- Two editorial fixes, both logged in `_meta.editorialChanges`: `MAUGANJ` → `Mauganj`, `Ntr` → `NTR`.

**Recommendation:** ship this as a **platform-global** choice list pair (`in-states`, `in-districts`) available to every tenant read-only, and re-source from LGD before any customer depends on official codes.

---

## 3. Choice Lists

### 3.1 Data model

```prisma
/// A managed set of options a question can draw from, instead of the author
/// re-typing them on every question. Platform-global when organizationId is
/// null (India states/districts ship this way); org-owned otherwise.
model ChoiceList {
  id             String   @id @default(uuid()) @db.Uuid
  organizationId String?  @map("organization_id") @db.Uuid
  name           String   @db.VarChar(120)
  slug           String   @db.VarChar(60)
  description    String?  @db.VarChar(500)

  /// The list whose items are this list's parents. Districts -> States.
  /// Self-referential rather than a generic "hierarchy" table: a list has at
  /// most one parent, which is what a cascading select actually needs, and it
  /// keeps the item query a single indexed lookup.
  parentListId   String?  @map("parent_list_id") @db.Uuid
  parentList     ChoiceList?  @relation("ChoiceListHierarchy", fields: [parentListId], references: [id])
  childLists     ChoiceList[] @relation("ChoiceListHierarchy")

  /// Declared metadata columns: [{ key, label, type }]. Drives the import
  /// mapper, the lookup operator's field picker, and nothing at runtime —
  /// items are stored as JSONB regardless.
  metadataSchema Json     @default("[]") @map("metadata_schema") @db.JsonB

  /// Bumped on every item mutation. The public items endpoint is cached on it,
  /// so an edit invalidates without a cache-busting sweep.
  version        Int      @default(1)
  itemCount      Int      @default(0) @map("item_count")

  items          ChoiceItem[]
  organization   Organization? @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")
  deletedAt      DateTime? @map("deleted_at")

  @@unique([organizationId, slug])
  @@index([organizationId, deletedAt])
  @@map("choice_lists")
}

model ChoiceItem {
  id          String  @id @default(uuid()) @db.Uuid
  listId      String  @map("list_id") @db.Uuid
  list        ChoiceList @relation(fields: [listId], references: [id], onDelete: Cascade)

  /// Stored in the answer. Immutable once in use — renaming `label` is safe,
  /// renaming `value` orphans every historical answer.
  value       String  @db.VarChar(120)
  label       String  @db.VarChar(300)

  /// The parent list item this one belongs under. Null for a root list.
  parentValue String? @map("parent_value") @db.VarChar(120)

  /// Extra columns — udise_code, school_type, block_code. What lookup() reads.
  metadata    Json    @default("{}") @db.JsonB

  sortOrder   Int     @default(0) @map("sort_order")
  isActive    Boolean @default(true) @map("is_active")

  @@unique([listId, value])
  @@index([listId, parentValue, isActive])
  @@index([listId, label])
  @@map("choice_items")
}
```

**Why `parentValue` and not a `parentItemId` FK:** the cascade filter runs against the *answer* the respondent gave, which is a value, not an id. Storing the value means the runtime filter is `WHERE list_id = ? AND parent_value = ?` — one index hit, no join, and it survives a re-import that regenerates item ids.

**Scale:** UDISE for one state is a few thousand rows; all-India is ~1.5M. The `(listId, parentValue, isActive)` index keeps the cascade query fast, and §3.4 never sends an unfiltered large list to the browser.

### 3.2 Binding a question to a list

Additive — existing `options` keeps working untouched.

```ts
// frontend/src/types/form.ts
export interface QuestionOptionsSource {
  kind: 'CHOICE_LIST';
  /** ChoiceList.slug, resolved within the org then falling back to global. */
  listSlug: string;
  /**
   * Cascade: show only items whose parentValue equals the answer to this
   * question. Addressed by KEY, like rules — so renaming a label is safe.
   */
  parentQuestionKey?: string;
  /** Metadata column to show instead of `label`, when the list has one. */
  displayField?: string;
  /** Type-to-search rather than a full <select>. Forced on above ~200 items. */
  searchable?: boolean;
}

export interface FormQuestion {
  // …
  /** Absent = static `options`. Present = options come from a managed list. */
  optionsSource?: QuestionOptionsSource;
}
```

`normalizeFormStructure` validates it: the slug must resolve to a list visible to the org, `parentQuestionKey` must name a real question **earlier in the form**, and the parent question must itself be bound to the parent list. Reject at save with a readable message — this is a configuration error the author can fix immediately, unlike a dangling logic target.

### 3.3 Server-side validation

`AnswerValidatorService` currently builds `allowed` from `q.options`. Extend `optionValues()`: when `optionsSource` is present, check membership against `ChoiceItem` instead. Two rules:

- The validator must **not** issue a query per question. Collect every `(listSlug, value)` pair for the submission, resolve in one `IN` query, validate from the result.
- Cascade consistency is enforced too: if `block = NL-kohima-chiephobozou`, its `parentValue` must equal the submitted `district`. Otherwise a crafted payload pairs a Kohima block with a Phek district and the data is quietly wrong.

### 3.4 API

```
GET  /choice-lists                          → lists visible to the org (own + global)
GET  /choice-lists/:slug                    → metadata + itemCount
GET  /choice-lists/:slug/items?parent=&q=&limit=&cursor=
POST /organizations/:orgId/choice-lists                     (EDITOR)
POST /organizations/:orgId/choice-lists/:id/items:import    (EDITOR) — CSV/JSON
PATCH/DELETE …                                              (EDITOR/ADMIN)

GET  /public-forms/:slug/choice-items?question=&parent=&q=  ← the respondent-facing one
```

The public endpoint is the important one and needs care:

- **Scoped by form**, not by list slug, so a public URL cannot enumerate an arbitrary org's lists. It resolves the question → its `optionsSource` → the list, and refuses anything else.
- **Never unbounded.** `limit` capped at 200, cursor-paginated, `q` does a prefix match on `label`.
- **Cached** on `(listId, parentValue, version)` with a long TTL — items change rarely and `version` invalidates.
- Rate-limited like `/track`.

### 3.5 The `lookup` operator — the UDISE auto-fill

This is what makes `UDISE Code` fill itself. A new operator:

```
lookup(<list slug literal>, <field node>, <metadata key literal>)
```

`UDISE Code` becomes a CALCULATE rule:

```json
{ "kind": "CALCULATE", "target": "udise_code",
  "expr": { "op": "lookup", "args": [
    { "lit": "ng-schools" }, { "field": "school_name" }, { "lit": "udise_code" }
  ]}}
```

Because Phase 1 made calculated values visible, this renders exactly as the reference form does: a greyed read-only box that fills in the moment a school is picked, and announces itself to a screen reader.

**Preserving the interpreter's purity.** `src/common/rules/` performs no I/O — that is what lets the same code run in the browser and lets the server reproduce what the respondent saw. `lookup` must not break it. So:

> **The second argument is constrained to a bare `field` node, enforced by the compiler.**

That single restriction means every `(list, value)` pair a plan can need is knowable from the **raw answers alone**, before any evaluation. One resolve pass fills a bag — exactly like `refs` does today — and the interpreter stays a pure post-order walk.

The alternative (an arbitrary expression) forces multi-pass evaluation with a lookup-depth analysis in the compiler, for no case anyone has actually asked for. If a real need appears, `lookupChain` can be added later as a distinct operator with explicit depth limits.

Changes:
- `ast.ts` — no new node type; `lookup` is an ordinary `OpNode`.
- `compiler.ts` — validate arg shapes; emit `plan.lookups: Array<{ list, field }>`; reject a `lookup` whose slug does not resolve.
- `operators.ts` — `lookup` reads `ctx.lookups[lookupKey(list, value, field)]`, returning `null` when absent (a school with no UDISE recorded is not an error).
- `interpreter.ts` — add `lookups` to `EvalContext`, alongside `refs`.
- **Server:** `resolveLookups(prisma, plan, answers)` next to `resolveReferences`, one batched query.
- **Client:** `useFormRules` fills the same bag from the choice items it has already fetched for the cascade. No extra request.
- Mirror every change into `frontend/src/lib/rules/` — the two are byte-for-byte and a drift here is a silent `null`.

### 3.6 Frontend

- **Field card:** an *Options source* toggle — *Type them in* / *From a list*. Choosing a list reveals the list picker, the *filtered by* question picker, and the display-field picker.
- **Runner:** `optionsSource` questions render a searchable combobox fed by the public items endpoint, keyed on the parent's current answer. Clearing the parent clears the child — a stale block under a changed district is the classic cascade bug.
- **Admin:** `/choice-lists` — list, create, CSV/JSON import with a column mapper, parent-list binding, preview, item search. Global lists render read-only with a "Provided by the platform" badge.

### 3.7 Seeding the India data

`prisma/seed-choice-lists.ts`, idempotent, run from `db:seed`:

1. `in-states` — 36 items, `value` = code, `label` = name.
2. `in-districts` — 784 items, `parentListId` = states, `parentValue` = state code, `value` = `{STATE}-{slug}`.
3. Both with `organizationId = null`.

Then, for the Nagaland customer specifically: `ng-blocks` (from LGD, parent = `in-districts`) and `ng-schools` (from UDISE+, parent = `ng-blocks`, `metadata.udise_code`). Those are data-acquisition tasks, not engineering ones.

---

## 4. Form Apps as multi-step programmes

### 4.1 Data model

```prisma
/// One step of an app: a form, and how many times it is filled.
model FormAppStep {
  id          String @id @default(uuid()) @db.Uuid
  appId       String @map("app_id") @db.Uuid
  app         FormApp @relation(fields: [appId], references: [id], onDelete: Cascade)
  formId      String @map("form_id") @db.Uuid
  form        Form   @relation(fields: [formId], references: [id])

  /// Stable handle for showWhen expressions and for analytics. Renaming the
  /// title must not break a condition that points at this step.
  key         String @db.VarChar(60)
  order       Int
  title       String @db.VarChar(200)
  description String? @db.VarChar(500)
  icon        String? @db.VarChar(16)

  mode        FormAppStepMode @default(SINGLE)
  minEntries  Int  @default(0) @map("min_entries")
  maxEntries  Int? @map("max_entries")
  isOptional  Boolean @default(false) @map("is_optional")

  /// ExprNode over EARLIER steps' answers. Same engine, same compiler, same
  /// fail-closed semantics as a SHOW rule — a step whose condition cannot be
  /// evaluated is hidden, never revealed.
  showWhen    Json? @map("show_when") @db.JsonB

  /// Question keys that must be distinct across this step's entries.
  /// ["school_name"] is the reference form's "Duplicate schools not allowed".
  uniqueBy    Json  @default("[]") @map("unique_by") @db.JsonB

  entries     FormAppSessionEntry[]

  @@unique([appId, key])
  @@unique([appId, order])
  @@index([appId])
  @@map("form_app_steps")
}

enum FormAppStepMode {
  /// Filled exactly once. Section A.
  SINGLE
  /// "+ Add …" — zero or more, bounded by min/maxEntries.
  REPEATABLE
}

/// One sitting: everything between opening the app and "Submit All Reports".
model FormAppSession {
  id             String @id @default(uuid()) @db.Uuid
  appId          String @map("app_id") @db.Uuid
  organizationId String @map("organization_id") @db.Uuid
  periodId       String? @map("period_id") @db.Uuid
  /// Resolved from the REGISTERS step on submit; null while still a draft.
  subjectId      String? @map("subject_id") @db.Uuid

  status         FormAppSessionStatus @default(DRAFT)
  respondentId   String? @map("respondent_id") @db.Uuid
  /// Anonymous respondents, matching the public form draft mechanism.
  fingerprint    String? @db.VarChar(64)

  entries        FormAppSessionEntry[]

  startedAt      DateTime @default(now()) @map("started_at")
  submittedAt    DateTime? @map("submitted_at")
  completionTimeMs Int? @map("completion_time_ms")

  @@index([appId, status])
  @@index([organizationId, submittedAt])
  @@unique([appId, fingerprint, status])
  @@map("form_app_sessions")
}

enum FormAppSessionStatus { DRAFT SUBMITTED ABANDONED }

/// One filled-in copy of one step. "School Visit #2" is index 1 here.
model FormAppSessionEntry {
  id            String @id @default(uuid()) @db.Uuid
  sessionId     String @map("session_id") @db.Uuid
  session       FormAppSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  stepId        String @map("step_id") @db.Uuid
  step          FormAppStep @relation(fields: [stepId], references: [id])

  index         Int
  /// Staged answers. Moves into FormSubmission.answers at submit.
  answers       Json @default("{}") @db.JsonB
  /// The version the respondent actually filled, pinned when the entry opens.
  formVersionId String @map("form_version_id") @db.Uuid
  /// Set once the session is submitted and the real submission exists.
  submissionId  String? @unique @map("submission_id") @db.Uuid

  @@unique([sessionId, stepId, index])
  @@map("form_app_session_entries")
}

/// A reporting window. "Feb – May 2026 · Fixed Reporting Period".
model FormAppPeriod {
  id        String @id @default(uuid()) @db.Uuid
  appId     String @map("app_id") @db.Uuid
  label     String @db.VarChar(120)
  startsAt  DateTime @map("starts_at")
  endsAt    DateTime @map("ends_at")
  isActive  Boolean @default(true) @map("is_active")

  @@index([appId, isActive])
  @@map("form_app_periods")
}
```

Plus, on `FormApp`:

```prisma
  /// Reuses FormTheme. An app is a branded surface, not a bare form list.
  themeConfig  Json    @default("{}") @map("theme_config") @db.JsonB
  /// logoUrl, coverImageUrl, headerTitle, footerHtml (sanitised).
  branding     Json    @default("{}") @db.JsonB
  /// Public URL segment: /a/{publicSlug}. Distinct from `slug`, which is the
  /// internal handle — a public identifier and an internal one should never be
  /// forced to be the same string.
  publicSlug   String? @unique @map("public_slug") @db.VarChar(60)
  requireAuth  Boolean @default(true) @map("require_auth")
  allowDrafts  Boolean @default(true) @map("allow_drafts")
```

`FormApp.config.formIds` is **superseded** by `FormAppStep`. Migrate it forward (each id becomes a `SINGLE` step in order) and then stop reading it. `dashboardCards` stays as it is.

### 4.2 Submit-all — the transaction that matters

`POST /apps/:appId/sessions/:sessionId/submit` is where correctness is won or lost. In one Prisma transaction:

1. **Re-validate every entry** server-side. The per-entry rules, the answer validator, requiredness — all of it, per entry, exactly as a lone submission would be. A session is not a trusted channel.
2. **Enforce step constraints**: `minEntries` / `maxEntries`; `uniqueBy` across the step's entries; `showWhen` re-evaluated so a hidden step's entries are dropped rather than accepted.
3. **Resolve the subject.** The `REGISTERS` step's answers create or match a `Subject`. Matching needs an explicit identity rule on the subject type (e.g. name + designation + district) — otherwise every session creates a duplicate person. Add `SubjectType.identityKeys Json` for this.
4. **Create one `FormSubmission` per entry**, all carrying `subjectId`, each bound to the `formVersionId` pinned when the entry opened.
5. Mark the session `SUBMITTED`, stamp `completionTimeMs`, write the audit entry.
6. **Enqueue** each submission on the existing pipeline — webhooks, notifications, analytics and quiz grading all keep working untouched.

Quota accounting: **N submissions consume N of the org's monthly quota**, not one. Count them up front and reject the whole session before creating anything, so a session cannot half-submit.

Failure semantics: all-or-nothing. A partially submitted report is worse than a rejected one — the respondent re-enters twenty school visits with no way to tell which landed.

### 4.3 API

```
# Authoring (EDITOR)
GET/POST/PATCH/DELETE  /organizations/:orgId/apps/:appId/steps
POST                   /organizations/:orgId/apps/:appId/steps:reorder
GET/POST/PATCH/DELETE  /organizations/:orgId/apps/:appId/periods
PATCH                  /organizations/:orgId/apps/:appId        (theme, branding, publicSlug, requireAuth)

# Filling in
POST   /apps/:appId/sessions                        → open or resume a DRAFT
GET    /apps/:appId/sessions/:id
PUT    /apps/:appId/sessions/:id/entries/:stepKey/:index    → stage answers (autosave)
DELETE /apps/:appId/sessions/:id/entries/:stepKey/:index    → remove a repeat entry
POST   /apps/:appId/sessions/:id/submit                     → the transaction above
DELETE /apps/:appId/sessions/:id                            → Reset

# Public
GET    /public-apps/:publicSlug                     → app + steps + forms + theme + active period
```

`/public-apps/:publicSlug` mirrors `getPublicForm`: cached, stripped of anything internal, and it must return **each step's form as the same flattened shape the runner already consumes**, including `compiledRules`. Reusing that contract is what lets the app runner mount `FormRunner` per entry with no changes.

### 4.4 Frontend

**App builder** — `/apps/builder?id=…`, tabbed like the form builder:

- **Steps** — ordered, drag-reorderable list. Per step: form picker, title/description/icon, `SINGLE` vs `REPEATABLE`, min/max, *Optional*, `uniqueBy` key picker, and a `showWhen` expression built with the **existing `ExpressionEditor`** over earlier steps' question keys. Reusing that editor is the point — one expression language across rules and steps.
- **Theme** — the existing `ThemeCustomizer`, writing to `FormApp.themeConfig`.
- **Branding** — logo, cover, header title, footer.
- **Periods** — the reporting windows.
- **Access** — public slug, requireAuth, drafts.
- **Dashboard** — the existing cards editor.

**App runner** — `/a/[publicSlug]` (public) and `/apps/[appId]/fill` (internal):

- Renders the accordion the reference form has: section headers with icons and *Optional* badges, per-entry cards titled `School Visit #N`, collapse and delete per entry, `+ Add …`, `Reset`, `Submit All Reports`.
- Each entry mounts **`FormRunner`** with `layoutMode="DOCUMENT"`, that step's form, and the entry's staged answers. No new question rendering, no new rules evaluation, no new accessibility work — all of that landed in Phase 1.
- Session-level error summary aggregating each entry's problems, with jump-to-entry.
- Autosave per entry against the session endpoint, reusing the `useFormAutosave` pattern.

New components under `frontend/src/components/apps/`: `AppStepList`, `AppEntryCard`, `AppRunner`, `AppSessionProvider`, `StepConditionEditor`, plus `choice-lists/ChoiceListPicker` and `ChoiceCombobox`.

### 4.5 How the reference form gets configured

| App | *Monitoring Progress Reporting System* · subject type **Respondent** · theme green · period `Feb – May 2026` |
| --- | --- |
| Step 1 | `respondent_details` — form *Respondent Details* (`REGISTERS`), `SINGLE`. Fields: Name, Designation, District (`in-districts`), Block (`ng-blocks`, filtered by District), EBRC Coordinator. |
| Step 2 | `training_attended` — form *Training Programme* (`ATTACHES`), `REPEATABLE`, min 0, optional. |
| Step 3 | `training_conducted` — same form or a sibling, `REPEATABLE`, min 0, optional. |
| Step 4 | `school_visits` — form *School Monitoring* (`ATTACHES`), `REPEATABLE`, min 1, `uniqueBy: ["school_name"]`. |

And inside *School Monitoring*, using only what exists today plus §3:

- School Name → `ng-schools`, filtered by the respondent's Block *(cross-step cascade — see §6)*.
- UDISE Code → `CALCULATE lookup('ng-schools', school_name, 'udise_code')`.
- Monitoring Checklist → one `MATRIX`, 7 rows × Yes/No/NA.
- 8.1–8.4 → four `NUMBER` questions + `VALIDATE` rules (`gt(aadhaar, enrollment)` → "cannot exceed total enrollment").
- 9.2, 9.3, SDP sub-question → `SHOW` rules on `9.1 = Yes`.
- Purpose of Visit → `LONG_TEXT`, `maxLength: 500` (the counter renders since Phase 1).
- Date of Visit → `DATE`, `defaultValue` today (works since Phase 1).

---

## 5. Phasing

| Phase | Contents | Rough size |
| --- | --- | --- |
| **A — Choice lists** | Prisma models + migration; `ChoiceListsModule` (CRUD, import, public items endpoint); `optionsSource` on the question + normalizer validation; validator membership + cascade consistency; `lookup` operator across **both** engine copies; resolver; runner combobox + cascade; admin UI; seed the India data. | Largest single piece. Independently shippable and useful on its own. |
| **B — App sessions** | `FormAppStep` / `FormAppSession` / `FormAppSessionEntry`; migrate `config.formIds` → steps; session endpoints; the submit transaction; `SubjectType.identityKeys`; app runner; steps designer. | Comparable to A. |
| **C — Comprehensive config** | Theme + branding; `FormAppPeriod`; `uniqueBy`; `showWhen` on steps; public `/a/[slug]`; Reset; session resume. | Smaller — mostly wiring existing pieces. |
| **D — Inline repeats & polish** | Make `REPEATING_SECTION` real (F1/F13 in the analysis doc — palette entry, `subQuestions` authoring, **stop stripping it in `normalizeQuestions`**, recursive validation); auto-numbering; `JUMP_TO_PAGE` decision; option picker in `ExpressionEditor` (F11). | Smallest. Deliberately last — §0 explains why the app model removes the urgency. |

**Do A before B.** B's value depends on forms that can express cascades, and A ships something usable on day one.

---

## 6. Decisions to make before building

These change the design, so they are worth settling early rather than discovering mid-implementation.

1. **Cross-step field references.** The School Name cascade needs the Block answered in *step 1* while filling *step 4*. `parentQuestionKey` as specified is same-form only. Either extend it to `{ stepKey, questionKey }`, or resolve it through the existing `ref` mechanism (same subject, `REGISTRATION`). **Recommendation: extend `parentQuestionKey` to an optional `stepKey`** — the session already holds every step's answers in memory, so it costs nothing, whereas `ref` requires the subject to already exist.

2. **Subject identity.** Without `SubjectType.identityKeys`, every session creates a new Respondent and longitudinal reporting is meaningless. Needs deciding in B, not after.

3. **Global vs org-owned lists.** Platform-global lists are the right home for India states/districts, but they need a super-admin surface to manage. Simplest v1: seed-only, no UI, org-owned lists for everything else.

4. **Quota semantics.** N submissions per session against the monthly quota (recommended), or one? This changes billing and must be stated before customers see it.

5. **`FormApp.config` migration.** Keep reading `config.formIds` for one release with a backfill, or migrate hard? Given no external consumers, **migrate hard in a single migration** and delete the field.

6. **UDISE data licensing.** Confirm redistribution terms for UDISE+ and LGD extracts before shipping them inside the product. IGOD/LGD are open directory content; UDISE+ school data should be checked.

---

## 7. What this buys beyond the one form

The Nagaland form is one instance of a general shape. Once A+B+C are in, that shape is **configuration**, and a large class of applications falls out of it with no further engineering.

### 7.1 The five primitives

Everything below is built from these, and nothing below needs a sixth:

1. **A subject** — the thing records are kept about (person, household, school, farm, vehicle, asset, case, vendor).
2. **A registration form** — fills in who/what, once. `REGISTERS`.
3. **N attachment forms** — repeated observations over time. `ATTACHES`.
4. **Choice lists with hierarchy + metadata** — pick from a managed registry; its other columns fill themselves.
5. **Rules** — derive, reveal, require, reject. Flat per form, which is what keeps them authorable.

An app is an ordered arrangement of 2 and 3, with 4 and 5 inside.

### 7.2 Free — configuration only, zero new code

| Shape | How it is configured | Real examples |
| --- | --- | --- |
| **Registry + longitudinal follow-up** | `REGISTERS` step + `REPEATABLE` `ATTACHES` step | Patient + clinic visits · Household + survey rounds · Farm + crop cycles · Asset + maintenance log · Employee + appraisals |
| **Field monitoring / inspection** | Inspector identity step + repeatable site-visit step | The reference form · Food-safety audits · Construction site inspections · Branch compliance checks |
| **Multi-entity intake** | Primary step + one repeatable step per dependent entity | Loan application + co-applicants + collateral items · Admission + guardians + prior schools · Insurance claim + damaged items |
| **Hierarchical pickers anywhere** | A parent-linked choice list chain | State→District→Block→Village · Zone→Region→Branch · Dept→Sub-dept→Designation · Category→Sub-category→SKU |
| **Auto-fill from a master registry** | `CALCULATE lookup(list, field, column)` | UDISE from school · GST/PAN from vendor · Facility type + pincode from facility · Sanctioned amount from scheme code |
| **Recurring period reporting** | `FormAppPeriod` per cycle | Monthly progress returns · Quarterly compliance filings · Termly school reports |
| **Conditional programme branching** | `showWhen` on a step | "Coordinators also complete Section C" · "Rural facilities get the water-supply module" |
| **Cross-form derivation** | `ref` node (`REGISTRATION` / `FIRST` / `LATEST`) | Weight gain since baseline · Days since last visit · Variance against sanctioned budget |
| **Eligibility gates** | `VALIDATE` to reject, `SHOW` to reveal a branch | Age/income cut-offs · "Only proceed if consent = Yes" |
| **Scored assessments & risk banding** | `points` + `CALCULATE` with `if()` | Compliance score with Red/Amber/Green band · Screening triage · Quiz with marks |
| **Multi-party collection on one subject** | Several `ATTACHES` forms, different apps, role-gated | Teacher submits A, inspector submits B, admin verifies C — all against the same school |
| **Branded public portal** | App theme + branding + `publicSlug` | A government-looking reporting portal with no custom front-end |

**Combinations are free too.** A health programme is #1 + #4 + #8 + #10. A vendor-compliance portal is #3 + #5 + #6 + #12. None of those is new work.

### 7.3 Small increments — days each, not phases

| Capability | What it takes |
| --- | --- |
| **Approve / reject workflow** | `FormSubmission.status` already exists. Add a REVIEW state, a reviewer action, an audit entry, a queue screen. |
| **"Same as last period" prefill** | Seed a new session's entries from the subject's `LATEST` submission. Uses machinery that exists. |
| **Segmented Yes/No/NA control** | An `appearance` hint on `SINGLE_CHOICE`. Pure presentation. |
| **Auto-numbered labels (8.1, 9.2)** | Derived from position at render time. Presentation only. |
| **Session/step-level export** | `excelExport` exists; widen it to sessions with one sheet per step. |
| **Per-step notifications & webhooks** | The submission pipeline already fires per submission; add app-level fan-out. |
| **Bulk import of subjects** | Registration answers from CSV instead of a form. Same validator. |

### 7.4 Still real work — be clear about these

| Not covered | Why it is genuinely separate |
| --- | --- |
| **Inline repeat groups** | Phase D. Needed only for small lists you do *not* want as queryable submissions — three phone numbers, two referees. §0 explains why this stopped being urgent, not why it stopped mattering. |
| **Nested groups / true containment** | The question list is flat. Real nesting changes the document model. |
| **Per-row rules** | Only arises if you insist on inline repeats. This is the addressing problem §0 avoids. |
| **GPS / geopoint, camera capture** | New question types with new capture, storage and export paths. |
| **Multi-language forms** | Every label, option and message becomes a translatable resource. Cuts across everything. |
| **Offline-first capture** | Server drafts exist, but true offline needs a service worker, IndexedDB and a sync/conflict story. This is what Kobo is actually for. |

### 7.5 The two things that actually constrain you

Worth naming, because neither is an engineering problem and both will feel like one:

1. **Choice-list data acquisition is the recurring cost.** The engine will be ready long before the *data* is. Blocks from LGD, schools from UDISE+, facility registries, vendor masters — each is a sourcing, cleaning and refresh task per customer. Budget for a re-import path and a data owner, not just an import button.

2. **"One repetition = one submission" is the model's single opinion.** It is the right one for anything you want to count, filter, export or analyse — which is almost everything at this scale. It is the wrong one for a throwaway list of three items. Phase D exists for exactly that gap; do not let it creep earlier.

### 7.6 Why the effort stays low

One expression language, one runner, one validator, one submission pipeline. A capability added in one place lights up everywhere: the `lookup` operator makes *every* registry auto-fill work, not just UDISE; `showWhen` reuses the compiler and the same fail-closed semantics as SHOW rules; the app runner mounts the existing `FormRunner` per entry, so the Phase 1 accessibility and rules work applies to apps without a line of new code.

That is the whole argument for doing it as configuration rather than as a second product.
