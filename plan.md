# Form Builder — Rules, Linked Forms & Data-Entry Apps

**Status:** Proposal · **Date:** 2026-08-08
**Framing:** This is a **form builder**. Everything below extends forms. Nothing here asks an author to learn a new modelling vocabulary before they can build a form.

---

## 0. What we are adding

Three features, each opt-in, each useless-to-ignore if you don't need it:

| # | Feature | One-line description |
|---|---|---|
| 1 | **Rules** | Fields that calculate themselves (date of birth → age), multi-condition show/hide, cross-field validation, conditional required. |
| 2 | **Subjects** | A form can register a *person/household/asset*; other forms attach to it. One record accumulates submissions over time. |
| 3 | **Form Apps** | Bundle forms into a data-entry app: search a subject, see their history, record a new entry, view a dashboard. |
| 4 | **Feature flags** | A super-admin switches each capability on per-platform or per-organization. Both new features ship **off**. |

### 0.1 Rollout

Everything above is gated behind two flags, `FORM_APPS` and `FORM_RULES`, resolved as *organization override, else global default* and delivered with the session at `GET /auth/me`. Both seed to **off**, so an existing deployment sees no change until someone turns them on — and a pilot organization can be enabled without touching anyone else.

Flags gate **UI only, never authorization**. Every endpoint keeps its own guards, so flipping a flag in devtools reveals menus, not data.

Data Apps is a second **navigation mode** rather than extra sidebar entries: a data-entry user and a form author want different things on screen, and one merged menu leaves both mostly looking at the other's tools. A switcher at the foot of the sidebar moves between them, and it disappears entirely when `FORM_APPS` is off. The URL wins over the stored choice, so arriving by deep link or the back button never leaves the chrome disagreeing with the page.

**Everything existing keeps working untouched.** A form with no rules, no subject type, and no app behaves exactly as it does today. These are additive columns and optional JSON, not a migration of how forms work.

---

## 1. Design principles

These are the constraints that keep this a form builder rather than a platform.

1. **No new modelling layer.** Authors build forms. They do not first define a data dictionary, then a subject type, then a program, then map forms to it. Avni requires that; it is why Avni needs trained implementers.
2. **Everything is opt-in and defaults off.** Subject binding is a nullable column. Rules are an empty array.
3. **No code execution.** Rules are data (a JSON expression tree) interpreted by us — never JavaScript, never `eval`, never a sandbox to escape.
4. **One implementation, two call sites.** The same interpreter runs in the browser (for instant feedback) and on the server (for truth).
5. **Point at things directly.** When a rule needs a value from another form, the author picks that form and that question from a dropdown. No indirection through a shared dictionary.

### 1.1 Explicitly rejected

| Avni idea | Why not |
|---|---|
| **Concepts / data dictionary** | Requires defining every field twice — once in the dictionary, once in the form. It is Avni's most powerful idea *and* the single biggest reason it isn't a self-serve form builder. **Cut entirely.** §3.4 gets the useful part without it. |
| **Programs & Encounter Types** | An enrolment state machine for multi-year service delivery. Not a form-builder concern. |
| **JavaScript rules** | Avni's `rules-server` runs `const ruleFunc = eval(code)` with no sandbox. Fine when each org gets its own deployment; unacceptable on our shared instance. |
| **19 rule types** | We ship 4. |
| **Offline-first sync** | A separate product. |
| **Separate rules-server** | An extra deployable and a second place for logic to disagree. |

### 1.2 What we take from Avni

Only two things, both ideas rather than mechanisms:

- **The longitudinal record** — one subject accumulating many submissions over time is what turns a form tool into a system of record. This is the feature you actually want.
- **Scope on a value reference** — when a rule reads a past value, *which* past value ("last visit", "first ever", "registration") is an explicit dropdown, not a query the author writes. This keeps historical references safe and authorable. It is Avni's cleverest idea and it costs us almost nothing.

Two of their behaviours we deliberately invert: rules **fail open** in Avni (a rule that throws is treated as `true` — an erroring visibility rule reveals a field), and computed values are **non-transitive** (a calculated value doesn't re-trigger rules depending on it; stale values persist unless explicitly reset). We fail closed and recompute everything (§3.5, §6.2).

---

## 2. Feature 1 — Rules

### 2.1 What an author sees

In the builder, a question gets a **Rules** tab. Four things they can add:

| Rule | Author phrasing |
|---|---|
| **Calculate** | "Set this field to `yearsBetween(Date of birth, today)`" |
| **Show / hide** | "Show this only when *Sex* is Female **and** *Age* ≥ 15" |
| **Validate** | "Reject when *End date* is before *Start date*, with message …" |
| **Require** | "Make this required when *Has insurance* is Yes" |

A calculated field renders read-only in the form runner and updates live as its inputs change.

This is a superset of today's `LogicBuilder`, which supports a **single** condition and only SHOW/HIDE/JUMP.

### 2.2 Field names

Formulas today would have to read `q_7f3a91 - q_2b8e04`. So a question gets an optional **key** — a short author-chosen name, unique within the form:

```
Question: "Date of birth"   key: dob
Question: "Age"             key: age    (calculated)
```

Formulas then read `yearsBetween(dob, today())`.

This is **naming, not a dictionary**. The key is scoped to one form, has no shared registry, no reuse requirement, and no separate management screen. It exists so formulas are readable — the same reason spreadsheet columns have names. Auto-generated from the label, editable, and entirely ignorable.

### 2.3 The expression format

Authored via UI, stored as a JSON tree. Four node kinds:

```jsonc
{ "lit": 18 }                                  // literal
{ "field": "dob" }                             // a question on this form, by key
{ "ref":  { … } }                              // a value from another form (§3.4)
{ "op": "yearsBetween", "args": [ … ] }        // built-in operator
```

Age from date of birth:

```jsonc
{
  "kind": "CALCULATE",
  "target": "age",
  "expr": { "op": "yearsBetween", "args": [ { "field": "dob" }, { "op": "today", "args": [] } ] }
}
```

Multi-condition visibility, replacing today's single-condition rule:

```jsonc
{
  "kind": "SHOW",
  "target": "pregnancy_details",
  "expr": {
    "op": "and",
    "args": [
      { "op": "eq",  "args": [ { "field": "sex" }, { "lit": "female" } ] },
      { "op": "gte", "args": [ { "field": "age" }, { "lit": 15 } ] }
    ]
  }
}
```

Note `age` is itself calculated — rules compose, which is why we need dependency ordering (§2.5).

### 2.4 Operators — a closed set

Fixed registry in our code. Authors pick from a list; they cannot add one.

| Group | Operators |
|---|---|
| Arithmetic | `add` `sub` `mul` `div` `mod` `abs` `round` `floor` `ceil` `min` `max` |
| Comparison | `eq` `neq` `gt` `gte` `lt` `lte` `between` |
| Logic | `and` `or` `not` `if` `coalesce` |
| Presence | `isBlank` `isFilled` |
| Date | `today` `yearsBetween` `monthsBetween` `daysBetween` `addDays` `addMonths` `formatDate` |
| Text | `concat` `upper` `lower` `trim` `length` `contains` `startsWith` |
| Choice / repeat | `count` `includes` `sumOf` `anyOf` `allOf` |

Every operator is **total** — it returns a value or `null`, never throws. `div` by zero is `null`. `null` propagates. A rule cannot crash a submission.

Deliberately excluded: regex. It invites ReDoS and the existing per-question `pattern` validation already covers the real need.

### 2.5 Compiled at publish, not at submit

`publishForm` already runs in a Serializable transaction producing an immutable, Redis-cached `FormVersion`. The compile step slots in there. At publish we:

1. **Validate** every expression — known operators, correct arity, no unknown node kinds.
2. **Resolve** every `field` key to a real question in this version. Unknown key → publish fails, pointing at the rule.
3. **Enforce budgets** (§6.3).
4. **Order the calculations** — build the dependency graph over calculated fields and topologically sort it. A cycle (`age → band → age`) **fails the publish** with the cycle shown.
5. **Store the compiled plan** on the `FormVersion`.

Because rules are data rather than code, all of this is possible *before* anyone fills the form. Avni cannot detect a dependency cycle until runtime, and then silently doesn't recompute.

At submit time there is no compilation — just interpretation of a cached plan.

### 2.6 Where it runs

One implementation in `packages/rules-core` — plain TypeScript, no dependencies, no I/O — imported by both apps.

| Call site | Purpose | Trusted |
|---|---|---|
| Form runner (browser) | Live UX: age appears as soon as DOB is typed | **No** |
| `AnswerValidatorService` (API) | Authoritative recomputation | **Yes** |

`evalTime` is an input, not `Date.now()` inside the interpreter, so the server's `today` matches what the respondent saw.

---

## 3. Feature 2 — Subjects

### 3.1 The idea, in form-builder terms

Today every submission is an island. A subject is just: **a form that creates a record, and other forms that add to that record.**

```
"Patient Registration"  →  creates a Subject
"Monthly Checkup"       →  attaches to a Subject   (submitted many times)
"Discharge"             →  attaches to a Subject
```

That's the whole model. No programs, no enrolments, no encounter types.

### 3.2 Model

```prisma
model SubjectType {
  id                 String  @id @default(uuid()) @db.Uuid
  organizationId     String  @map("organization_id") @db.Uuid
  name               String  @db.VarChar(100)      // "Patient", "Household"
  slug               String  @db.VarChar(60)
  /// The form whose submission creates a subject of this type.
  registrationFormId String? @map("registration_form_id") @db.Uuid
  /// Which question keys become displayName / searchable attributes.
  identityConfig     Json    @map("identity_config")

  @@unique([organizationId, slug])
}

model Subject {
  id             String    @id @default(uuid()) @db.Uuid
  organizationId String    @map("organization_id") @db.Uuid
  subjectTypeId  String    @map("subject_type_id") @db.Uuid
  /// Derived from identityConfig — what shows in search results.
  displayName    String    @db.VarChar(200)
  /// Small promoted subset of registration answers, for search and prefill.
  attributes     Json
  /// Optional caller-supplied key (patient number). Unique per subject type.
  externalId     String?   @map("external_id") @db.VarChar(100)
  deletedAt      DateTime? @map("deleted_at")

  @@unique([subjectTypeId, externalId])
  @@index([organizationId, subjectTypeId, displayName])
}
```

Additions to existing models — all nullable, all defaulted:

- `FormSubmission.subjectId String?`
- `FormSubmission.organizationId` — **denormalise now.** Already recommended in the platform audit for partitioning and index-only org queries; subject timelines make it unavoidable.
- `Form.subjectTypeId String?` and `Form.subjectRole` (`REGISTERS` | `ATTACHES` | `NONE`, default `NONE`).

Existing forms are `NONE` and completely unaffected.

### 3.3 Why `attributes` holds only a subset

Full answers already live on the submission. `Subject.attributes` holds only what the subject type marks as identity — name, phone, village, id. That keeps the row small and indexable, and gives one clear answer to "what is this subject's name" when twelve submissions each contain a name field. Promotion happens in the submission worker after validation.

### 3.4 Reading values from other forms — without a dictionary

This is where a concept layer would normally be required. Instead: **the author points directly at a form and a question.**

In the rule builder, a "value from another form" picker asks three things:

```
Form:      [ Monthly Checkup      ▾ ]
Question:  [ Weight               ▾ ]
When:      [ Most recent          ▾ ]     ← Most recent · First ever · Registration
```

which compiles to:

```jsonc
{ "ref": { "form": "<formId>", "question": "weight", "when": "LATEST" } }
```

`when` is a closed enum: `LATEST`, `FIRST`, `REGISTRATION`.

This is Avni's scope idea with the dictionary removed. It works because the author is choosing a *specific question on a specific form* — which is exactly how someone thinks in a form builder, and it needs no shared vocabulary to be unambiguous.

Resolution happens **server-side, before interpretation**: the compiled plan already lists every `(form, question, when)` triple a rule references, so we issue one batched query, build a value bag, and hand the interpreter a plain object. The interpreter never touches the database. Consequences:

- Evaluation stays pure and identical on client and server.
- The reachable data set is fixed at publish time — a rule cannot widen its own reach at runtime.
- Cost is one indexed query per referenced form, not per rule.

References only work on forms bound to the same subject type. On a `NONE` form, a `ref` node fails compilation.

### 3.5 Prefill

The other half of "interlinked forms": a question can declare a default pulled from the subject or a prior submission — same picker as §3.4, resolved when the form is opened, and freely overwritable by the person entering data. Prefill is a **starting value, not a rule**; it is not recomputed at submit.

---

## 4. Feature 3 — Form Apps

```prisma
model FormApp {
  id             String  @id @default(uuid()) @db.Uuid
  organizationId String  @map("organization_id") @db.Uuid
  subjectTypeId  String  @map("subject_type_id") @db.Uuid
  name           String  @db.VarChar(120)
  slug           String  @db.VarChar(60)
  /// Which forms appear, in what order, plus dashboard card definitions.
  config         Json
  isPublished    Boolean @default(false) @map("is_published")

  @@unique([organizationId, slug])
}
```

A distinct surface from the public form runner, for staff doing repeat data entry:

- **Search / register** — find a subject or create one via the registration form.
- **Timeline** — every submission for that subject, newest first.
- **Record** — open any attached form for that subject, with prefill applied.
- **Dashboard** — counts and lists over the app's subjects.

Dashboard cards are **declarative filters**, not rules:

```jsonc
{ "title": "Registered this month", "source": "subjects", "filter": { "createdWithinDays": 30 } }
```

Avni's dashboard cards are arbitrary JavaScript, and their docs concede that filters are not even auto-applied — each card must re-implement them. A filter object covers the real cases and can never become a security or performance incident.

Existing `FormAnalytics` (views/starts/submissions per day) stays as-is — it answers a different question and is unaffected.

---

## 5. What this does *not* become

Stated plainly so scope creep is visible when it starts:

- No data dictionary, concept registry, or shared question library.
- No programs, enrolments, encounter types, or checklists.
- No offline sync.
- No JavaScript rules, ever — not behind a flag, not for "advanced" tenants.
- No cross-subject queries or aggregation inside expressions. If that is ever needed, it becomes a **named, server-implemented operator** with its own authorization check — never a general query facility.

---

## 6. Security

### 6.1 Calculated values are recomputed server-side

The rule with no exceptions. The browser computes `age` for display; the server **discards whatever the client sent** for any calculated field and recomputes it. Otherwise a respondent posts `{"age": 4}` to pass an eligibility gate.

Order inside `AnswerValidatorService`:

1. Validate raw answers as today (types, ranges, option membership).
2. **Strip** every key that is a calculation target.
3. Resolve `ref` values into the value bag (one batched query).
4. Evaluate calculations in topological order.
5. Evaluate SHOW/HIDE — a value for a question the rules say is hidden is dropped.
6. Evaluate REQUIRE and VALIDATE against the post-calculation answers.

Step 5 also closes a live gap: visibility is currently evaluated **only in the browser** (`FormRunner.tsx:255`), and the server drops values for hidden questions without being able to verify the claim (`answer-validator.service.ts:174`). After this, required-field enforcement no longer depends on the client behaving.

### 6.2 Fail closed

Avni treats a rule that throws as `true`. We invert it:

| Rule | On error |
|---|---|
| SHOW/HIDE | Hidden |
| REQUIRE | Not required (a broken rule must not make a form unsubmittable) |
| VALIDATE | **Submission rejected** |
| CALCULATE | Target set to `null` — never left stale |

Because every calculated field is recomputed from scratch and written unconditionally, Avni's stale-value problem (`resetValueIfNull`) is not representable here.

### 6.3 Budgets

Static, at publish: ≤256 nodes per expression, ≤24 depth, ≤200 rules per form version, correct operator arity.

Dynamic, at evaluation: ≤10,000 evaluation steps per submission, ≤1,000 collection elements, ≤10,000-char string results. Exceeding a budget aborts, fails the submission with a generic error, and logs the form version. It cannot hang a worker.

No loops, no recursion, no user-defined functions, no I/O.

### 6.4 Tenant isolation

Rules reach only the current submission, the current subject, and prior submissions **of that same subject** — all org-scoped before the interpreter is called. Every new route is `/organizations/:orgId/...` and therefore covered by the `OrgMemberGuard` invariant `tenant-isolation.spec.ts` enforces. `Subject` carries a denormalised `organizationId` so subject queries are index-only and RLS-ready.

Rule authoring is EDITOR+; publishing already writes an audit entry and the compiled plan is part of the immutable version, so "who changed this calculation and when" is answerable from existing infrastructure.

---

## 7. Performance

- **Compile once per publish**, cached on the immutable `FormVersion` (already Redis-cached 24h). Submit-time cost is interpretation only — microseconds for realistic forms.
- **`ref` resolution** is one indexed query per referenced form, batched, and only on subject-bound forms. Forms without subjects add zero queries.
- **Prefill** resolves when the form is opened, not on the submit path.
- Subject search is indexed on `(organizationId, subjectTypeId, displayName)`; timelines need `FormSubmission(subjectId, submittedAt DESC)`.
- The public ingest hot path gains no database work.

---

## 8. Phases

Each is independently shippable and leaves the product working.

**Phase A — Expression engine.** AST, operators, interpreter, budgets, compiler, cycle detection. Same-form references only.

*Placement:* lands at `form-builder-backend/src/common/rules/` rather than a `packages/` workspace. The repo has no monorepo tooling — two independent apps with their own lockfiles — and introducing npm workspaces would restructure installs and CI for both before a single rule runs. The engine is written as **pure, dependency-free TypeScript importing nothing from Nest or Prisma**, so lifting it into a shared package in Phase B is a file move, not a rewrite. Server-side evaluation is the security-critical half and is worth having first regardless.
*Exit:* DOB → age evaluates identically in Node and browser; a cyclic rule set is rejected at publish; a runaway rule fails closed instead of hanging.

**Phase B — Rules in the builder.** Compiler into `publishForm`; interpreter into `AnswerValidatorService` (§6.1 order) and the form runner. Add question keys. Migrate existing `LogicRule` rows to SHOW/HIDE expressions — mechanical, since today's single condition is a one-node tree. Extend `LogicBuilder.tsx` into a condition builder; add a formula builder.
*Exit:* an author builds "age from DOB" in the UI, publishes, and the value is computed server-side with the client's value ignored.

**Phase C — Subjects.** `SubjectType`, `Subject`, `FormSubmission.subjectId` + `organizationId`, promotion in the worker, the `ref` picker and resolver, prefill, subject search and timeline endpoints.
*Exit:* a registration form creates a subject, a second form attaches to it, the timeline shows both, and a rule reads "weight at last visit" without the author writing a query.

**Phase D — Form Apps.** `FormApp`, the app shell (search / register / timeline / record), declarative dashboard cards.
*Exit:* an org configures an app and a data-entry user completes a register-then-record cycle without opening the form builder.

**Phase E — Only if asked.** Export a subject's full record; app config export/import between environments; scheduled/due-visit tracking.

---

## 9. Decisions on the open questions

1. **Subject de-duplication — `externalId` plus a soft warning. No fuzzy matching.**
   `externalId` is the hard uniqueness guarantee (enforced by a DB constraint). On top of that, registration runs one exact-match lookup on the identity attributes (typically name + phone) and, on a hit, shows *"A Patient with this name and phone already exists — open it, or continue creating a new one?"* The operator decides.
   Fuzzy/probabilistic matching is a genuine rabbit hole (thresholds, transliteration, merge tooling, false-merge recovery) and it is impossible to tune before seeing real data. A soft exact-match warning catches the common double-entry case for a day's work. Revisit only if real duplicates show up that this misses.

2. **Submissions are immutable; a correction creates a new version.**
   Consistent with `FormVersion` and the audit trail already in the product, and it means rules never need to "re-run over history" — the one thing that makes rule engines genuinely hard to reason about. The subject timeline shows the latest version of each entry with prior versions available.

3. **Reuse the existing role ladder. No new role.**
   Recording an entry through a published Form App is a `VIEWER`-level action — it is not editing a form. Configuring an app or its forms stays `EDITOR`+. This deliberately avoids a fourth role; per-form permissions remain a separate, already-identified gap and should not be solved here.

4. **Calculated values are stored as answers.** Confirmed — they must appear in exports, analytics, and submission views, and recomputing on read would require every reader to carry the rules engine. §6.1's server-side recomputation is what makes stored values trustworthy.

---

## 10. Sources

Avni was researched from its docs and source (`avniproject/{avni-server, avni-client, avni-webapp, rules-config, rules-server}`) to decide what to borrow and what to avoid:

- [Domain model](https://avni.readme.io/docs/avnis-domain-model-of-field-based-work) · [Concepts](https://avni.readme.io/docs/concepts) · [Writing rules](https://avni.readme.io/docs/writing-rules)
- [Component architecture](https://avni.readme.io/docs/component-architecture) — the client/rules-server split
- [Offline reports](https://avni.readme.io/docs/offline-reports) · [Access control](https://avni.readme.io/docs/access-control)

Not independently verifiable: whether Avni's `eval` has deploy-time process isolation (the code path has none, but hosting-level containment can't be checked from outside).
