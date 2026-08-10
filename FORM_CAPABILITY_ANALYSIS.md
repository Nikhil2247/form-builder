# Form Builder — Capability & Correctness Analysis

**Date:** 2026-08-10
**Scope:** `frontend/src` (builder, runner, rules mirror) + `form-builder-backend/src` (forms, submissions, rules, form-apps)
**Question asked:** can this system build forms like the three reference links; are the builder logic and rules properly wired end-to-end; do auto/calculated rules show their value to the respondent; what else will cause trouble.

> **Status — Phase 1 applied (2026-08-10).** The findings marked ✅ below have
> been fixed and are covered by tests. The reference-form capability gaps
> (§1–§2) are untouched and remain the next piece of work.

## Fixed in this pass

| Finding | Fix |
| --- | --- |
| **F2** Rules never ran in the browser | `useFormRules` (`frontend/src/hooks/use-form-rules.ts`) evaluates the compiled plan on every keystroke. Calculated questions now render as a live read-only value; SHOW hides; REQUIRE applies; VALIDATE shows inline. Works in the builder preview too, by compiling the authored rules with the same `compileRules` the publish endpoint runs. |
| **F3** Server field errors collapsed to one string | `FormRunner` reads `err.issues`, maps them onto their questions, navigates to the offending page and focuses the field. |
| **F7** Two logic systems disagreeing across the wire | `hiddenByLegacyLogic` extracted to one mirrored module (`frontend/src/lib/legacy-logic.ts` / `backend/src/common/legacy-logic.ts`) and evaluated on **both** sides. `logicJson` added to the ingest policy. The unfixable "X is required" rejection for a legacy-hidden question is gone. Numeric answers now match string rule values, which silently never matched before. |
| **F4** `defaultValue` read by nothing | `applyDefaultValues` seeds the answer map; existing draft/URL values still win. |
| **F5** Author validation never reached the DOM | `maxLength`, `minLength`, `min`, `max`, `step`, `pattern`, `accept`, `inputMode`, `autocomplete` are all applied, with a live character counter and a client-side file-size check. `checkAnswer` mirrors the server's messages. |
| **F6** Matrix/slider/star validated against fields that do not exist | `q.rows`/`q.columns`/`q.min`/`q.max` → `matrixRows`/`matrixColumns`/`sliderMin`/`sliderMax`. Matrix cells and slider bounds are actually enforced now. |
| **F9** `SLIDER` rendered nothing | Real range control with `aria-valuenow` and a visible `<output>`. |
| **F10** Conversational mode skipped questions | Position tracked by question id, derived rather than synchronised. |
| **F12** Only the current page was validated | Submit checks every visible question on the form and jumps to the first problem. |
| **A1–A13, A15** | Label/control association, `aria-describedby`/`aria-invalid`/`role="alert"`, fieldset+legend for choice groups, proper radiogroup semantics with arrow keys for star and NPS, per-cell names and working `onChange` for the matrix, a **typed-signature alternative** to the mouse-only canvas, `role="progressbar"`, an error summary that focuses, upload status announcements, and `prefers-reduced-motion` honoured. |
| **G6** Multi-choice error survived being fixed | All answer changes clear the field's stale server issue. |
| **G8** `rules` served two incompatible shapes | The public endpoint now serves the plan as `compiledRules`; the runner still accepts `rules` so a Redis-cached older payload renders. |
| *(new)* Required calculated field = unfixable form | Requiredness is no longer applied to a question a CALCULATE rule owns, on **both** sides. The respondent can no longer be asked to fill a box they are forbidden from filling. |

**New files:** `lib/question-keys.ts`, `lib/legacy-logic.ts`, `lib/answer-checks.ts`, `hooks/use-form-rules.ts`, `components/builder/FormRunnerField.tsx`, `components/builder/FormRunnerUpload.tsx` (frontend); `common/legacy-logic.ts` (backend).
**Tests:** `legacy-logic.spec.ts` (13), `answer-validator.service.spec.ts` (13), `rules/runner-contract.spec.ts` (7). Full backend suite: 169 passing. Frontend `tsc` and `next build` clean.

**Deliberately not done here** (they are the reference-form work, not bug fixes): F1/F13 repeat groups, F8 `JUMP_TO_PAGE`, F11 option picker in the expression editor, G1 signature storage, G3 draft rate limiting, G4 prefill by key, A14 theme contrast.

---

## 0. Method, and what I could and could not verify

| Source | Status |
| --- | --- |
| Codebase | Read directly. Every finding below cites `file:line`. |
| `formsubmission-ssebrc.kesug.com/?i=1` — *Monitoring Progress Reporting System* (Samagra Shiksha Nagaland) | **HTTP 403 to server-side fetch.** Analysed from the screenshot you supplied. This is the primary reference and it is decomposed field-by-field in §1. |
| `ee.kobotoolbox.org/x/pF1f2wHz`, `ee.kobotoolbox.org/x/nEq0roEy` | **Could not read the content.** Enketo renders the form client-side from XForm XML; the served HTML is only the Enketo shell, and `/transform/xform/:id` is POST-only (404 on GET). I could not open a browser this session. |

For the two Kobo links I therefore assess against the **XLSForm / ODK XForms capability model** that every `ee.kobotoolbox.org` form is built from (§2). That is a superset assessment: if we cover the XLSForm construct set, we cover those two forms whatever they contain. Where a conclusion rests on that model rather than on the specific form, it is marked *(model-based)*.

---

## 1. The reference form, decomposed

The Nagaland monitoring form is a **field-monitoring / longitudinal data-collection form**, not a marketing or feedback form. Its constructs:

| # | Construct in the reference form | Concrete example |
| --- | --- | --- |
| C1 | **Repeat groups, zero-or-more, empty by default** | "Training Programmes Attended by You" → `+ Add Training` |
| C2 | **Repeat groups, one-or-more, with per-row header, collapse and delete** | "School Visit #1" → `+ Add School Visit`, chevron, bin icon |
| C3 | **Nested sub-groups inside a repeat row** | Section B → School Visit #N → `9. SDP Orientation Details` → `SDP completed and submitted to EBRC?` (3 levels) |
| C4 | **Cascading selects** | District (Kohima) → Block (Chiephobozou) → School Name (GHS Botsa) |
| C5 | **Auto-filled read-only field derived from a choice's metadata** | `UDISE Code = 13,07,03,00,802` fills itself from *School Name*, greyed, not typeable |
| C6 | **Per-row conditional visibility** | `9.2 Date of Latest Orientation` and `9.3 Mode of Orientation` depend on `9.1 = Yes` **within that school-visit row** |
| C7 | **Tri-state segmented control repeated as a checklist** | Monitoring Checklist items 1–7, each `Yes / No / NA` |
| C8 | **Cross-field numeric constraints** | 8.2 Having Aadhaar ≤ 8.1 Total Enrollment; 8.3 ≤ 8.2; 8.4 ≤ 8.1 |
| C9 | **Cross-row uniqueness inside a repeat** | footer: *"Duplicate schools not allowed"* |
| C10 | **Default values** | Date of Visit pre-filled `10/08/2026` (today); numerics pre-filled `0` |
| C11 | **Length caps surfaced in the UI** | *"Purpose of Visit (max 500 chars)"*, *"Remarks (optional, max 1000)"* |
| C12 | **Hierarchical question numbering** | `8.1`, `9.3` — numbering is part of the form's meaning |
| C13 | **Section metadata** | per-section icon, `Optional` badge, explanatory line ("You can add multiple training records.") |
| C14 | **Fixed reporting period** | `Feb – May 2026`, *"Fixed Reporting Period"* |
| C15 | **Bulk submit + reset** | `Submit All Reports`, `Reset` |
| C16 | **Org branding** | logo in header, government footer |

---

## 2. Verdict: can we build this today?

**No.** Roughly **40%** of the reference form is reproducible with what exists; the load-bearing 60% is not.

| Construct | Today | Why |
| --- | --- | --- |
| C1/C2 Repeat groups | ❌ **Dead feature** | `REPEATING_SECTION` exists in the enum, the type and the runner — but it cannot be created and cannot survive a save. See F1. |
| C3 Nested groups | ❌ | Question list is flat. `SECTION_HEADER` (`FormRunner.tsx:498`) is a visual divider only — no containment, no nesting. |
| C4 Cascading selects | ❌ | Options are a static array on the question (`form-structure.ts:186`). There is no choice-list entity and no filter-by-parent-answer. `modules/lookup` is a Redis cache service, not a choice lookup. |
| C5 Auto-filled read-only field | ⚠️ **Engine yes, UI no** | A `CALCULATE` rule can derive it, but **the respondent never sees a calculated value** — see F2, the single biggest finding. And options carry no metadata to derive it *from*. |
| C6 Per-row conditionals | ❌ **Architectural** | Rules address a flat `key → value` map (`form-adapter.ts:101`). There is no row index in the addressing scheme, so a rule inside a repeat cannot mean "this row". |
| C7 Yes/No/NA checklist | ⚠️ Approximate | `MATRIX` (rows = the 7 items, columns = Yes/No/NA) is the closest fit and renders. But matrix cells are **not validated server-side** (F6) and no rule can target an individual row. |
| C8 Cross-field constraints | ⚠️ Engine yes, UX no | `VALIDATE` + `lte` does it — but the message only appears **after** submit, as one generic red string at the page bottom (F3). |
| C9 Cross-row uniqueness | ❌ | No operator over repeat rows for distinctness. |
| C10 Default values | ❌ **Dead feature** | `defaultValue` is typed, normalised and stored — and read by nothing. See F4. |
| C11 Length caps in UI | ❌ | `validation.maxLength/min/max/pattern` are never applied to any input (F5). |
| C12 Numbering | ❌ | Author must type `8.1` into every label by hand. |
| C13 Section metadata | ⚠️ Partial | Label + description only; no icon, no optional badge. |
| C14 Reporting period | ⚠️ Partial | `expiresAt` closes a form; there is no open-from/period concept. |
| C15 Reset | ❌ | Not present in the runner. |
| C16 Branding | ✅ | `FormRunnerClient.tsx:259` renders cover image + logo. |

### The two Kobo links *(model-based)*

Every `ee.kobotoolbox.org` form is an XLSForm. The constructs that make XLSForm what it is are: `begin repeat` / `end repeat`, `begin group` (nestable), `calculate` bindings, `relevant`, `constraint` + `constraint_message`, `required` + `dynamic required`, `choice_filter` (cascading selects), external choice lists, `default`, `appearance` (likert / minimal / horizontal / table-list), `read_only`, geopoint / geoshape, `audio`/`image`/`video` capture, `note`, `hint`, multi-language labels, and offline capture with a submission queue.

Against that list we currently have: `calculate` (engine only), `relevant` (engine only, no repeat scoping), `constraint` (engine only), `required`, `note` (as `SECTION_HEADER`), `hint` (as `description`), image/file upload. **We do not have:** repeats, nested groups, `choice_filter`, external choice lists, `default`, `read_only`, geopoint, audio/video capture, `appearance` variants, multi-language, or offline capture. So the answer for those two links is the same: **not today**.

---

## 3. Findings — the wiring you asked about

### F1 — `REPEATING_SECTION` is dead in three independent places · **P0**

1. **Not creatable.** Absent from the field palette (`LeftTreePanel.tsx:60-99`) and from the command palette (`forms/builder/page.tsx:81-100`). Every other question type is in both.
2. **No authoring UI.** `EnterpriseFieldCard.tsx` has no `REPEATING_SECTION` case (`:459-589`), so there is no way to define its `subQuestions`.
3. **Stripped on save.** `normalizeQuestions` (`form-structure.ts:302-379`) builds a fresh question object with an explicit allow-list of properties. `subQuestions` is not among them, so it is **silently discarded on every save**.

The runner *can* render one (`FormRunner.tsx:672-736`), and the validator *can* accept the array shape (`answer-validator.service.ts:360`) — but nothing can ever reach them. A grep for `subQuestions` across the whole repo returns exactly two hits, both in the frontend, neither reachable.

Consequence: **the reference form's three repeat groups cannot be expressed at all.** This is the largest single gap.

### F2 — The rules engine never runs in the browser · **P0**

> *"if auto rule is configured then that form input has to show the auto value"* — it does not.

The plumbing is 90% built and the last link is missing:

- The backend **does** ship the compiled plan to the browser: `forms.service.ts:1030` sets `rules: activeVersion.compiledRules`, with a comment saying *"the runner interprets it to show calculated values live and hide irrelevant questions."*
- The frontend **does** carry a byte-identical copy of the engine at `frontend/src/lib/rules/` with `runFormRules()` ready to call (`form-adapter.ts:129`).
- **`FormRunner.tsx` imports nothing from `@/lib/rules`.** Verified: zero matches for `lib/rules` in that file. It only walks the legacy `form.logic` array (`:254-292`).
- `FormRunnerClient.tsx:142-148` rebuilds `parsedForm` from `questions/pages/logic/theme` and **drops `rules` on the floor** — the compiled plan arrives and is never read.
- The **builder preview** has the same hole: `PreviewPanel` (`forms/builder/page.tsx:702`) renders the same `FormRunner`. So an author writing a `CALCULATE` rule cannot see it work anywhere, ever.

What a respondent actually experiences today:

| Rule kind | Intended | Actual |
| --- | --- | --- |
| `CALCULATE` | Field shows the derived value, read-only | **Empty editable input.** Whatever they type is silently thrown away at `form-adapter.ts:141-145` and recomputed server-side. |
| `SHOW` | Question hidden until relevant | **Always visible.** Their answers to it are then discarded server-side (`answer-validator.service.ts:181`). |
| `REQUIRE` | Becomes mandatory live | **Not enforced client-side.** Discovered only as a submit rejection. |
| `VALIDATE` | Inline message next to the field | **Only at submit**, as one generic banner (see F3). |

There is a genuinely nasty compound case: a **required `CALCULATE` field whose expression yields `null`**. The runner shows an empty box; the server strips the client value, recomputes `null`, and `isEmpty(null)` is true (`answer-validator.service.ts:167`) → `"X is required."` The respondent is told to fill in a field that they are structurally forbidden from filling. There is no way out of that form.

### F3 — Server-side field errors are collapsed into one string · **P0**

`FormRunnerClient.tsx:229-233` carefully extracts the server's per-field `issues` array and attaches it to the thrown error. `FormRunner.tsx:412-414` then does:

```ts
catch (err: any) { setSubmitError(err.message || 'Failed to submit form...'); }
```

`err.issues` is never read. So every `VALIDATE` rule message the author wrote, and every server-side `REQUIRED` / `PATTERN` / `OPTION` error, is flattened into `"Some answers are invalid."` in one red span at the bottom of the page — with no indication of *which* field, and no scroll-to-field. On a form the length of the reference form this is unusable.

### F4 — `defaultValue` is stored and read by nothing · **P1**

Typed (`types/form.ts:58`), normalised and persisted (`form-structure.ts:375-377`) — and a repo-wide grep finds **no consumer**. There is no authoring control for it either. The reference form's pre-filled *Date of Visit = today* and pre-filled `0` numerics (C10) are not expressible.

### F5 — Author-configured validation is never applied in the browser · **P1**

`FormRunner.tsx` contains no `maxLength`, no `pattern`, no `min`/`max`, no `accept`, no `inputMode`, no `required` attribute — verified by grep. Client-side validation is *only* the emptiness check at `:311-323`. Everything else is server-only, arriving as F3's generic banner.

Specifically missing versus the reference form: the `max 500 chars` / `max 1000` counters (C11), numeric `min`/`max` on the enrollment fields, `accept=` on file upload derived from `validation.allowedTypes`, and a client-side file-size check before the S3 round-trip.

### F6 — `MATRIX` answers are effectively unvalidated · **P1**

`answer-validator.service.ts:315-316` reads `q.rows` and `q.columns`:

```ts
const rowKeys = labelSet(q.rows);
const colKeys = labelSet(q.columns);
```

The question schema uses **`matrixRows` / `matrixColumns`** — that is what the builder writes and what `form-structure.ts:349-356` normalises. `q.rows` is always `undefined`, so both sets are empty, and both guards are written as `if (rowKeys.size > 0 && ...)`. **Every row key and every column value is accepted.** A client can POST arbitrary row/column strings into a matrix answer.

This matters directly: the Monitoring Checklist (C7) is the natural `MATRIX` use, and it would be the least-protected part of the form.

Related, same file: `STAR_RATING` reads `q.max` (`:262`) and `SLIDER` reads `q.min`/`q.max` (`:253-254`), but the builder writes `sliderMin`/`sliderMax` and `validation.max`. Slider bounds are therefore not enforced either.

### F7 — Two conditional-logic systems that do not know about each other · **P1**

`LogicRule` (legacy, `form.logic`) and `FormRule` (the compiled engine, `form.rules`) both do SHOW/HIDE, both are authored on the same **Logic** tab (`forms/builder/page.tsx:500-509`), and neither is reconciled with the other.

The dangerous asymmetry:

- The **browser** honours only `form.logic` (`FormRunner.tsx:254`).
- The **server** honours only the compiled plan — `visibleQuestionIds` is derived exclusively from `evaluated.hiddenQuestionIds` (`submissions.service.ts:190-199`).

So a question hidden by a **legacy** `HIDE` rule is invisible to the respondent, but the server still believes it is visible. If it is also required, the submission is rejected with `"X is required."` for a field the respondent was never shown. **This is a live, reachable dead-end on any form that combines a legacy HIDE rule with a required target.**

### F8 — `JUMP_TO_PAGE` is a phantom · **P2**

The action is in the Prisma enum (`schema.prisma:132`), in the TS union (`types/form.ts:90`), and is validated and persisted by `normalizeLogic` (`form-structure.ts:429-432`). But `LogicBuilder.tsx:49-52` offers only `Show`/`Hide`, and `FormRunner` has no branch for it — grep for `JUMP_TO_PAGE` in `frontend/src` returns two hits, neither in the runner. It cannot be authored and would not execute.

### F9 — `SLIDER` renders nothing on the public form · **P1**

`SLIDER` is offered in both palettes, has an authoring preview (`EnterpriseFieldCard.tsx:520`), is normalised with min/max/step (`form-structure.ts:335-344`) and is validated server-side. `FormRunner.tsx:538-772` has **no `SLIDER` branch** — the question card renders its label, its description, its required asterisk, and then an empty div. A respondent cannot answer it; if it is required, the form cannot be submitted.

### F10 — Conversational mode can skip or repeat questions · **P2**

`FormRunner.tsx:461` picks the current question as `getVisibleQuestions()[currentPage - 1]`. That array is recomputed from live answers on every render, so any SHOW/HIDE that fires re-indexes the list underneath a fixed page counter. Answering a question that reveals an earlier one shifts every subsequent index by one — the respondent silently skips a question or sees one twice. Page position must be tracked by question id, not by ordinal.

### F11 — Rule literals cannot be matched to choice options · **P2**

`FormRunner.tsx:566,582,600` submits `opt.label` as the answer for choice questions. The rules `ExpressionEditor` offers only a free-text literal box (`ExpressionEditor.tsx:388-393`) — there is no option picker. The author must know to type the exact **label** (not the `value`, which the builder also maintains and which the option list also carries). Typing the `value` produces a rule that compiles cleanly, publishes cleanly, and silently never fires.

### F12 — Only the current page is validated before submit · **P2**

`validatePage()` (`:298`) checks the current page only, and `handleSubmit` calls it once. A question on page 1 that a later answer made required or revealed is never re-checked client-side; it surfaces only as F3's generic banner on the final page, with no way to navigate back to it.

### F13 — Repeat rows bypass all validation *(will matter once F1 is fixed)* · **P2**

`answer-validator.service.ts:360-370` checks only that a `REPEATING_SECTION` answer is an array of ≤100 plain objects. Sub-question types, required flags and option membership inside a row are **not checked at all**. And `FormRunner.tsx:696-717` renders every sub-question as a text input regardless of its declared type.

---

## 4. Accessibility

The public runner (`FormRunner.tsx`) is the page real respondents use. It currently fails several WCAG 2.1 AA criteria. The builder chrome is markedly better (`EnterpriseFieldCard` uses `aria-label`, `aria-pressed`) — the gap is specifically in the runner.

| # | Issue | Criterion | Where |
| --- | --- | --- | --- |
| A1 | Labels are `<Label>` with no `htmlFor`, and inputs have no `id` — for text, number, textarea, date, select, file, signature. The accessible name comes from proximity only. | 1.3.1, 4.1.2 | `:523-546`, `:548`, `:591`, `:615` |
| A2 | Error messages are a plain `<div>`; no `role="alert"`, no `aria-live`, no `aria-describedby` linking them to the input, no `aria-invalid`. A screen-reader user is never told the field failed. | 3.3.1, 3.3.3 | `:775-780` |
| A3 | No error summary and no focus movement on failed validation. On a long form the user is left at the submit button with no route to the problem. | 2.4.3, 3.3.1 | `:333` |
| A4 | Radio and checkbox groups are `<div>`s, not `<fieldset>` + `<legend>` (or `role="radiogroup"` + `aria-labelledby`). The question text is not announced with the options. | 1.3.1 | `:558-589` |
| A5 | Star rating is 5 unlabelled `<button>`s. No `aria-label`, no `aria-pressed`, no group semantics, no arrow-key navigation. Announced as five identical empty buttons. | 4.1.2, 2.1.1 | `:624-641` |
| A6 | NPS is 11 buttons announced as bare digits `0`…`10`, with no group name and no selection state. | 4.1.2 | `:643-663` |
| A7 | Matrix radios have **no accessible name at all** — the row/column context is visual only. Selection is driven by `onClick` on the `<td>` with `onChange={() => {}}`, so the input is effectively inert to keyboard and AT. Headers lack `scope`. | 1.3.1, 2.1.1, 4.1.2 | `:738-772` |
| A8 | Signature canvas is mouse/touch only. No keyboard path, no type-your-name fallback, no `aria-label`. **Keyboard-only users cannot complete a form containing one.** | 2.1.1 | `:142-177` |
| A9 | Required state is a red `*` glyph only (`:525`). No `required`, no `aria-required`, and the asterisk carries no text alternative. | 1.3.1, 3.3.2 | `:522-526` |
| A10 | Progress bar is a styled `<div>`; no `role="progressbar"`, no `aria-valuenow`. Page transitions move no focus and announce nothing. | 4.1.2, 2.4.3 | `:467-480` |
| A11 | No `autocomplete` on name/email/phone/address-shaped inputs. | 1.3.5 | `:538-546` |
| A12 | Colour is the sole error indicator (red border + red text). | 1.4.1 | `:519` |
| A13 | Upload state changes ("Uploading…", success, failure) are not announced. | 4.1.3 | `:104-138` |
| A14 | **Theme contrast is unvalidated.** `normalizeTheme` (`form-structure.ts:454`) accepts any colour string for `primaryColor` / `backgroundColor` / `textColor`. An author can publish a form that is unreadable, with no warning. | 1.4.3 | — |
| A15 | Confetti on submit ignores `prefers-reduced-motion`. | 2.3.3 | `:410` |

**A8 and A7 are the two that block completion outright**, not merely degrade the experience.

---

## 5. Other things that will bite

| # | Issue | Where |
| --- | --- | --- |
| G1 | `SIGNATURE` is stored as a base64 data-URL **inside the answers JSONB** — up to 500 KB per signature, per row, in a column also budgeted at 256 KB total payload (`LIMITS.MAX_PAYLOAD_BYTES`). Two signatures on one form is an instant rejection. Signatures belong in object storage alongside file uploads. | `answer-validator.service.ts:70,338` |
| G2 | `SignaturePadWrapper` is uncontrolled — it takes `value` and ignores it (`:145-146`). A restored draft or a page-back loses the drawn signature while the answer value persists. | `FormRunner.tsx:142` |
| G3 | Draft autosave PUTs the full answer set every 2 s keyed only on an unauthenticated `localStorage` fingerprint, with no rate limit on `PUT /public-forms/:slug/draft` (the `@Throttle` decorator is on `/track` only). Anyone can enumerate slugs and write drafts. | `FormRunnerClient.tsx:121`, `public-forms.controller.ts:36,43` |
| G4 | URL prefill matches on `q.label.toLowerCase() === key` (`FormRunnerClient.tsx:83-84`). Two questions sharing a label — normal in a monitoring form — silently prefill the wrong one. Questions already carry a stable unique `key`; use it. | `FormRunnerClient.tsx:81` |
| G5 | The public form is cached in Redis for 300 s **and** served with `stale-while-revalidate=600` (`public-forms.controller.ts:26`). Worst case a respondent fills a version up to 15 minutes stale. `formVersionId` binding makes this safe for grading, but the author is not told that unpublishing takes that long to take effect. | `forms.service.ts:1038` |
| G6 | `handleMultiChoiceChange` does not clear the field's error, unlike `handleInputChange`. A multi-choice error stays on screen after it is fixed. | `FormRunner.tsx:243` |
| G7 | Quiz scoring compares against `opt.label` (`:366`) while `correctAnswer` on the question stores a separate string — two answer-key mechanisms, only one of which the runner reads. | `FormRunner.tsx:354-379` |
| G8 | The `rules` field is polymorphic across the API surface: `FormConfig.rules` is typed `FormRule[]` (authored) but the public endpoint puts a `CompiledPlan` object in the same slot (`forms.service.ts:1030`). Nothing currently reads it, so nothing breaks — but this is a trap set for whoever implements F2. **Give the compiled plan its own field name (`compiledRules`) before wiring the runner.** | `types/form.ts:180` vs `forms.service.ts:1030` |
| G9 | `form-apps` dashboard cards support only `createdWithinDays` and `formId` filters (`form-apps.service.ts:27-32`). Reasonable and deliberately safe, but far from the reference form's fixed-reporting-period model (C14). | `form-apps.service.ts:213` |

**What is genuinely good and should not be touched:** the rules engine itself. Rules-as-data with a closed operator set and no `eval`; publish-time compilation with cycle detection; fail-closed semantics per rule kind (`engine.ts:68-75`); server-side recomputation of calculated fields with client values stripped first (`form-adapter.ts:124-128`); version-pinned submission binding; `0` treated as truthy (`operators.ts:49`). That design is better than what it is modelled against. **The problem is not the engine — it is that only half of the system is plugged into it.**

---

## 6. What to do

### Phase 1 — Connect what already exists (days, not weeks)

These are the highest value-per-line changes in the entire list. Nothing new needs designing.

1. **Run the compiled plan in `FormRunner`.** Import `runFormRules` / `readPlan` from `@/lib/rules`, memoise on `(plan, answers)`, and use its output to:
   - render `CALCULATE` targets as read-only fields showing the computed value, with a "calculated" affordance and an `aria-readonly`/`aria-live` announcement — **this is the "auto rule must show its value" requirement**;
   - drive visibility from `hiddenQuestionIds` (union with the legacy `logic` result during transition);
   - add `requiredQuestionIds` to the required check in `validatePage`;
   - surface `violations` inline against `questionId`.
   Stop dropping `rules` in `FormRunnerClient.tsx:142`. Rename the transport field to `compiledRules` first (G8).
   → fixes **F2**, most of **F7**, and makes the builder preview honest.
2. **Render `err.issues` per field.** Map `issue.questionId` into the `errors` state, scroll to and focus the first one. → fixes **F3**.
3. **Add the `SLIDER` branch to the runner.** → fixes **F9**.
4. **Fix `q.rows`/`q.columns` → `matrixRows`/`matrixColumns`; slider and star bounds likewise.** → fixes **F6**.
5. **Seed `answers` from `defaultValue`** in the runner's initial state, and add a default-value control to the field card. → fixes **F4**.
6. **Apply `validation` to the inputs** — `maxLength` with a live counter, `min`/`max`/`step`, `pattern`, `accept` from `allowedTypes`, client-side size check. → fixes **F5**.
7. **Accessibility sweep of the runner:** `id`/`htmlFor` pairs, `aria-describedby` + `aria-invalid` + `role="alert"` on errors, `<fieldset>`/`<legend>` for choice groups, labelled radiogroup semantics for star/NPS, per-cell `aria-label` and real `onChange` for matrix, a typed-name fallback for signature, `role="progressbar"`, `autocomplete`, focus management on page change and on error. → fixes **A1–A13**.
8. **Decide the fate of `JUMP_TO_PAGE`**: implement it in the runner and expose it in `LogicBuilder`, or remove it from the enum, the type and `normalizeLogic`. Leaving it half-present is how F8 happened. → fixes **F8**.
9. **Track conversational position by question id.** → fixes **F10**.
10. **Option picker in `ExpressionEditor`** when the compared field is a choice type; emit the same string the runner submits. → fixes **F11**.

After Phase 1 the rules feature is genuinely usable and the runner is accessible — but the reference form is still not buildable.

### Phase 2 — Repeat groups and nesting (the real work)

This is where C1/C2/C3/C6/C9 live, and it is not a UI task — it is a change to the **addressing model**.

11. **Make `REPEATING_SECTION` real.** Add it to both palettes; build a `subQuestions` authoring UI in `EnterpriseFieldCard`; **add `subQuestions` to the allow-list in `normalizeQuestions`** (with recursion, a depth cap of 1–2, and its own id/key uniqueness scope); render sub-questions by type in the runner; validate rows properly in `answer-validator` by recursing `validateOne` over each row. → fixes **F1**, **F13**.
12. **Extend rule addressing to repeat scope.** Today a rule target is a flat `key`. Decide and implement one of:
    - *(recommended)* **row-scoped rules** — a rule declared inside a repeat evaluates once per row against that row's answers, addressed `repeatKey[i].childKey`. `runFormRules` gains a per-row evaluation loop; `applyRules` stays untouched. This is what makes C6 work.
    - aggregate-only rules across rows (`sumOf`, `count` already exist) for the parent scope.
    Add a `distinct(repeatKey, childKey)` operator for C9.
13. **Nested groups as a first-class container** (`GROUP` type with children), which subsumes `SECTION_HEADER` and gives C3 and C12 (auto-numbering falls out of the tree).

### Phase 3 — Choice lists

14. **Choice-list entity per organisation**, versioned with the form, with rows carrying arbitrary metadata columns (`district`, `block`, `udise_code`).
15. **`choice_filter`** — filter a question's options by an earlier answer. → C4.
16. **`lookup(choiceList, matchValue, column)` operator** so a `CALCULATE` rule can pull `udise_code` off the selected school. Combined with Phase 1 item 1, that is C5 working end to end.

### Phase 4 — Field-data-collection parity (only if the Kobo forms are the target)

Geopoint capture, audio/image/video capture, offline queue with background sync, multi-language labels, `read_only` questions, XLSForm import.

### Regression tests worth adding first

- `form-structure.spec.ts`: a `REPEATING_SECTION` with `subQuestions` **survives** `normalizeFormStructure` (currently fails).
- Runner test: a form with a `CALCULATE` rule displays the computed value without any user input.
- Runner test: a `SHOW` rule with a falsy expression hides its target in the browser.
- Runner test: a question hidden by a **legacy** `HIDE` rule and marked required does not produce an unfixable server rejection (F7).
- Validator test: a matrix answer with a fabricated row key is rejected (currently accepted).
- Runner test: every member of `QuestionType` renders a focusable control (would have caught F9).
- Axe/a11y snapshot of the public runner covering each question type.

---

## 7. One-line answer

The rules engine is well built and is the strongest part of this codebase — but **it only ever runs on the server**, so the respondent never sees a calculated value, never has a question hidden, and gets every rule violation as one anonymous red string after submitting. Fixing that is a small, contained change (Phase 1). What the reference form actually needs beyond it — **repeat groups, nested groups, and cascading choice lists** — does not exist in any form and is Phase 2/3 work; `REPEATING_SECTION` in particular looks implemented but is silently deleted on every save.
