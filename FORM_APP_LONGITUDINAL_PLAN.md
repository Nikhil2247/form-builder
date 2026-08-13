# Longitudinal recording — repeat visits, monthly cycles, follow-ups

**Status:** P1 and P2 implemented (migration `20260813140000_longitudinal_recording`). P3 and P4 not started.

Delivered in P1/P2: step scope, occurrence keys + the partial unique index, `occurredAt`,
follow-up sessions, `stepsAvailableForSubject`, the record page's "Add entry" menu, and the
runner's follow-up mode. `occurredAt` shipped early with P2 because the submit path had to
stamp it anyway; the recurring periods and backdating that complete P3 did not.
**Question this answers:** *"What is a form session, and how do I record a second visit / next month's progress against a record that already exists?"*

---

## 1. What a session is today

`FormAppSession` (`prisma/schema.prisma:1503`) is **one sitting** — everything between opening the app and pressing "Submit All Reports". It is a *staging envelope*, not a visit:

- Answers are written to `FormAppSessionEntry` rows (`schema.prisma:1543`) as the worker types.
- Nothing becomes a real `FormSubmission` until submit, which happens in **one transaction** (`form-app-sessions.service.ts:submitSession`). Either the whole report lands or none of it does.
- At submit, the `REGISTERS` step's answers are run through `resolveOrCreateSubject` (`form-app-sessions.service.ts:924`), which derives a stable `externalId` from the identity keys and either finds the existing `Subject` or creates one.

So: **a session is a transaction boundary, not a time period.** It is a good design and should be kept. It is simply not the concept that models "Month 3 progress check".

---

## 2. Why the ALAMB app cannot record a second visit

Seven concrete gaps, all verifiable in the current code:

| # | Gap | Where |
|---|-----|-------|
| 1 | **A session is bound to a respondent, never to a subject.** `openSession` resumes a draft with `where: { appId, status:'DRAFT', respondentId }`. A field worker gets *one* draft across all students. | `form-app-sessions.service.ts:290` |
| 2 | **The subject is only resolved at submit.** To record month 2 the worker must re-fill the whole registration step (it is `SINGLE, minEntries:1`). The identity hash makes it land on the same student, so it "works" — but every visit means re-typing a registration, and one typo in a name mints a **duplicate student**. | `form-app-sessions.service.ts:760-768, 924` |
| 3 | **Cardinality is counted per session, not per subject.** `minEntries` / `maxEntries` / `uniqueBy` are evaluated over `liveEntries` of the current sitting. `maxEntries: 6` on `progress_checks` means *6 per sitting*, not 6 per student. `uniqueBy: ['month_number']` will not stop Month 3 being entered twice in two different sessions. | `form-app-sessions.service.ts:622-748` |
| 4 | **Periods are hard windows over the whole app.** Outside a period the app throws `403` for everyone. They are hand-created rows, have no recurrence, and are not per-subject. A monthly programme would need 12 hand-made rows and would lock out on the 1st of every month. | `form-app-sessions.service.ts:279-284`, seed `periods:` at `seed-scenario-apps.ts:5314` |
| 5 | **There is no "add entry" anywhere in the UI.** The record page is a read-only timeline; the app dashboard search only links *to* that page. | `records/[subjectId]/page.tsx`, `apps/[appId]/page.tsx:248` |
| 6 | **No real-world date.** The timeline sorts by `submittedAt`. A February visit entered in March sorts as March. | `subjects.service.ts:247` |
| 7 | **No concept of "due" or "missing".** Nothing can say "Ravi has no February progress check". For a monitoring programme that is the single most valuable output. | — |

**Verdict: this is not a session problem.** Sessions are correct. What is missing is a **subject-scoped occurrence** — a step that repeats *against a record*, keyed and dated by something real.

---

## 3. The three concepts to add

1. **Step scope** — *where* a step's cardinality is counted: within a sitting, across the subject's lifetime, or per reporting period.
2. **Occurrence** — what makes two entries of the same step distinct (`month_number`, `assessment_type`, `followup_number`) and *when* it actually happened (`occurredAt`).
3. **Follow-up session** — a session opened **against an existing subject**, which skips registration and offers only the steps that are still open for that subject.

---

## 4. Schema

### 4.1 Step scope and occurrence

```prisma
enum FormAppStepScope {
  /// Today's meaning: cardinality within one sitting. Default, so every
  /// existing app behaves exactly as it does now.
  SESSION
  /// Counted across the subject's whole history. "Registered once, ever."
  SUBJECT
  /// Counted per subject per reporting period. "One progress check a month."
  SUBJECT_PERIOD
}

model FormAppStep {
  scope FormAppStepScope @default(SESSION)

  /// Question key whose answer is the REAL-WORLD date of this entry, promoted
  /// onto the submission as `occurredAt`. Without it a backdated visit sorts
  /// by when it was typed rather than when it happened.
  occurredAtKey String? @map("occurred_at_key") @db.VarChar(60)

  /// When this step becomes due, relative to an anchor. Drives "overdue" and
  /// the missing-visit view; never blocks entry.
  ///   { anchor: "registration", offsets: [{months:1},{months:3},{months:6}] }
  schedule Json? @db.JsonB
}
```

`uniqueBy` is **reused, not replaced** — but for `SUBJECT` / `SUBJECT_PERIOD` scopes it is compared against every prior submission for that subject, not just the current session's entries.

### 4.2 Session mode

```prisma
enum FormAppSessionMode {
  /// Starts from the REGISTERS step; the subject is resolved at submit.
  REGISTER
  /// Bound to an existing subject at OPEN. Registration is skipped.
  FOLLOW_UP
}

model FormAppSession {
  mode FormAppSessionMode @default(REGISTER)
  // subjectId already exists — it just becomes settable at open time.
}
```

The partial unique index behind "one open draft per respondent per app" must widen to **one open draft per respondent per app per subject**, so a worker can have March's draft open for two different students.

### 4.3 Submissions gain the columns that make cross-session counting cheap

```prisma
model FormSubmission {
  appSessionId  String?   @map("app_session_id")  @db.Uuid
  formAppStepId String?   @map("form_app_step_id") @db.Uuid
  periodId      String?   @map("period_id")        @db.Uuid

  /// The date the thing happened, from the step's occurredAtKey.
  ///
  /// NOT NULL, defaulted and backfilled from submittedAt — deliberately not
  /// nullable-with-a-read-time-fallback. `ORDER BY COALESCE(occurred_at,
  /// submitted_at)` cannot use a plain btree index; Postgres would need an
  /// expression index or would sort the whole result set on every timeline
  /// page. Making the column always-present keeps ordering index-only.
  occurredAt    DateTime  @default(now()) @map("occurred_at")

  /// Hash of the step's uniqueBy answers. The identity of a repeat.
  occurrenceKey String?   @map("occurrence_key") @db.VarChar(80)

  /// REPLACES @@index([subjectId, submittedAt desc]) rather than joining it —
  /// the timeline now orders by occurredAt, so the old one has no reader left.
  @@index([subjectId, occurredAt(sort: Desc)])
  @@index([subjectId, formAppStepId, periodId])
}
```

### 4.4 Index budget

`form_submissions` already carries **eight** indexes (`schema.prisma:877-891`) and is the hottest write table in the system. The additions above are deliberately budgeted, not accumulated:

| change | net |
|--------|-----|
| `+ [subjectId, occurredAt desc]`, `− [subjectId, submittedAt desc]` | 0 |
| `+ [subjectId, formAppStepId, periodId]` (the availability query) | +1 |
| `+ partial unique on (subjectId, formAppStepId, occurrenceKey)` | +1 |
| `− [formId, submittedAt desc]` — superseded by `[formId, deletedAt, submittedAt desc]` (see the comment at `schema.prisma:888`: every read path now carries `deletedAt: null`) | −1 |

**Net +1 index on the hot table.** Verify the drop against `pg_stat_user_indexes.idx_scan` in production before removing it, not from reading the code.

Plus a **partial unique index** (raw SQL in the migration, Prisma cannot express it):

```sql
CREATE UNIQUE INDEX form_submissions_occurrence_uniq
  ON form_submissions (subject_id, form_app_step_id, occurrence_key)
  WHERE subject_id IS NOT NULL
    AND form_app_step_id IS NOT NULL
    AND occurrence_key IS NOT NULL
    AND deleted_at IS NULL;
```

This is the real guarantee. Two coordinators submitting Month 3 for the same student at the same moment is otherwise a race that application-level checks lose.

### 4.4 Recurring periods

```prisma
enum FormAppPeriodMode {
  NONE       // no periods (today's behaviour when the list is empty)
  FIXED      // today's behaviour: hand-made windows, app closed outside them
  RECURRING  // materialised on demand from a cadence
}

model FormApp {
  periodMode   FormAppPeriodMode @default(NONE)
  /// { cadence: "MONTHLY"|"QUARTERLY"|"WEEKLY"|"YEARLY",
  ///   anchorDay: 1, graceDays: 10, backfillPeriods: 2 }
  periodConfig Json @default("{}")
}

model FormAppPeriod {
  isGenerated Boolean @default(false)
  sequence    Int?
  @@unique([appId, startsAt])
}
```

Behaviour under `RECURRING`:
- Period boundaries are a **pure function** of cadence + anchor + now — computed in code, **zero queries**. The row is INSERTed only when a session actually *submits* into that period, so opening an app never writes. (An earlier draft of this plan upserted the period on session open; that puts a write on the hottest read path in the app for no benefit. Don't.) Cache the resolved period id in Redis — `common/redis/redis.service.ts` already exists — for the cadence duration.
- No cron job, no 12 hand-made rows.
- Being outside a period **does not close the app** — that stays a `FIXED`-only rule.
- Within `graceDays` of a period ending, the worker may explicitly file into the previous period ("Recording for: February 2026"), bounded by `backfillPeriods`. Late data entry is the normal case in field work; blocking it is what makes people enter the wrong month.

---

## 5. Backend

### 5.1 `stepsAvailableForSubject(appId, subjectId)` — the new core query

For each step, return what a UI needs to render a menu:

```ts
{
  stepKey, title, icon,
  available: boolean,
  reason: 'OPEN' | 'ALREADY_COMPLETED' | 'PERIOD_SATISFIED'
        | 'MAX_REACHED' | 'HIDDEN_BY_CONDITION' | 'NOT_YET_DUE',
  remaining: number | null,      // maxEntries minus existing, in scope
  nextOccurrence: string | null, // "March 2026", "Final assessment", "3-month follow-up"
  dueAt: string | null,
  isOverdue: boolean
}
```

Counting is scope-driven — but it is **one query for all steps**, never one per step:

```sql
SELECT form_app_step_id, period_id, count(*) AS n, max(occurred_at) AS last_at
FROM form_submissions
WHERE subject_id = $1 AND deleted_at IS NULL AND status <> 'DELETED'
GROUP BY form_app_step_id, period_id
```

Served by `[subjectId, formAppStepId, periodId]`, returning ~6–20 rows for a real subject. `SESSION`-scoped steps are counted from the in-memory session as they are today and cost nothing extra. Due/overdue is then evaluated **in application code** from `last_at` — never as SQL date arithmetic per step.

**One real change is needed here:** `showWhen` currently reads only the current session's answers (`visibleSteps`, `form-app-sessions.service.ts:189`). In a follow-up session there is no registration entry in the session — the answers live on prior submissions. So `showWhen` for `FOLLOW_UP` must be evaluated against an **accumulated answer context** built from the subject's most recent submission per step key. Same interpreter, same fail-closed direction (a condition that cannot be evaluated hides its step).

Cost-controlled as follows, because `answers` is JSONB and can be large:

```sql
SELECT DISTINCT ON (form_app_step_id) form_app_step_id, answers
FROM form_submissions
WHERE subject_id = $1 AND form_app_step_id = ANY($2) AND deleted_at IS NULL
ORDER BY form_app_step_id, occurred_at DESC
```

`$2` is **only** the steps some `showWhen` actually references — a statically-known set, computed once when the app's steps are loaded. Most apps reference one or two; an app with no conditions issues **zero** queries here.

So a follow-up session open costs **two extra queries** over today's path, both index-backed and both bounded by the number of steps, not by history size.

### 5.2 `openSession(appId, actor, { subjectId?, stepKeys?, periodId? })`

- `subjectId` present ⇒ `mode: FOLLOW_UP`. Verify the subject is in the app's org **and** `subjectType`, and is not soft-deleted.
- Resume an existing draft matched on `(appId, identity, subjectId)`.
- `stepKeys` narrows the session to one step ("just add March's progress check") — validated against `stepsAvailableForSubject`, never trusted from the client.
- `periodId` allows an explicit backdated filing, bounded by `graceDays` / `backfillPeriods`.

> **Security gate — do not skip this.** A `FOLLOW_UP` session exposes the subject's context (name, attributes, prior answers). Accepting an arbitrary `subjectId` from an unauthenticated caller on a public app (`requireAuth: false`, which the ALAMB seed sets at `seed-scenario-apps.ts:3680`) is a record-enumeration hole. Rule: **`FOLLOW_UP` requires either an authenticated org member, or a short-lived signed subject token** minted by an authenticated user and put in the link the worker opens. `REGISTER` mode stays open to anonymous respondents as it is now.

### 5.3 `getSession` in FOLLOW_UP mode

Returns, in addition to the steps:

```ts
context: {
  subject: { id, displayName, externalId, attributes },
  period:  { id, label } | null,
  recent:  [{ stepTitle, occurredAt, summary }]   // last 3–5, read-only
}
```

The worker must see *who they are recording against* before they type anything. This is the difference between a follow-up form and a blank form.

### 5.4 `submitSession`

- `FOLLOW_UP` ⇒ skip `resolveOrCreateSubject` entirely; use the bound `subjectId`.
- Enforce scoped cardinality **and** `occurrenceKey` uniqueness **inside** the transaction, re-reading counts there — the pre-flight check is for a good error message, the DB index is the guarantee. Catch `P2002` on the occurrence index and turn it into a `422` naming the clash: *"A progress check for March 2026 already exists for this student."*
- Stamp each created submission with `appSessionId`, `formAppStepId`, `periodId`, `occurredAt` (from `occurredAtKey`, falling back to `submittedAt`), `occurrenceKey`.

### 5.5 `getSubjectTimeline`

- Order by `occurred_at DESC` — a plain indexed sort, no `COALESCE` (see 4.3).
- Include `stepTitle` and `period.label` per entry.
- Group by period, and emit **gap rows** from the step schedules: `{ period: 'February 2026', missing: ['Monthly Progress Check'] }`. A timeline that shows only what exists cannot show what was skipped, which is the whole job of a monitoring app.

Grouping and gap detection happen **in memory over the page already fetched** — one query plus the existing count, exactly as today. A query per period would turn one page load into a dozen round-trips.

---

## 6. Frontend

**Record page** (`records/[subjectId]/page.tsx`) — the page the complaint is actually about:
- **"Add entry"** button in the header → menu from `stepsAvailableForSubject`. Unavailable steps are shown greyed with their reason ("Registration — completed", "Progress check — already recorded for March"), never hidden. Choosing one opens a follow-up session scoped to that step.
- Timeline grouped by period, with `occurredAt` as the primary date and a muted "entered on …" when the two differ.
- Gap rows rendered as dashed placeholders with a direct "Record now" action.

**App dashboard** (`apps/[appId]/page.tsx`):
- Inline "Add entry" on each record row, so a worker with 30 students does not open 30 pages.
- A "Due this period" card: subjects with an open `SUBJECT_PERIOD` step in the active period. This becomes the daily work queue.

**Runner** (`components/apps/AppRunner.tsx`, `app/a/[slug]`):
- Follow-up mode: masthead reads *"Recording for: Sunita Devi · March 2026"*; a collapsed read-only context card of registration/enrollment answers; only the requested step(s) in the wizard.
- The single-step case should be a plain form, not a 6-step wizard with 5 steps skipped.

**Builder** (`components/apps/AppStepsDesigner.tsx`, `AppSettingsPanel.tsx`):
- Per step: scope selector with plain-language help — *"Filled once per record"* / *"Once per record, per reporting period"* / *"Once per sitting"*; occurrence-date question picker; schedule editor.
- App settings: period mode (None / Fixed / Recurring), cadence, grace days, backfill count. The existing `PeriodsSection` becomes the `FIXED` branch.

---

## 7. Back-compatibility

Every default preserves current behaviour: `scope = SESSION`, `mode = REGISTER`, `periodMode = NONE`, all new submission columns nullable. No existing app changes shape.

Backfill migration: derive `formAppStepId` and `appSessionId` for historical submissions from `FormAppSessionEntry.submissionId` (that link already exists, `schema.prisma:1558`). `occurredAt` / `occurrenceKey` stay null for historical rows and fall back at read time — the partial unique index ignores nulls, so no old data blocks the migration.

For ALAMB specifically, the seed changes to:

| step | scope | occurredAtKey | uniqueBy |
|------|-------|---------------|----------|
| `registration` | `SUBJECT` | — | — |
| `enrollment` | `SUBJECT` | — | — |
| `progress_checks` | `SUBJECT_PERIOD` | `visit_date` | `['month_number']` |
| `assessments` | `SUBJECT` (max 2) | `assessment_date` | `['assessment_type']` |
| `exit` | `SUBJECT` | `exit_date` | — |
| `followups` | `SUBJECT` (max 3, schedule +1/+3/+6 months from `exit`) | `followup_date` | `['followup_number']` |

…and the app moves to `periodMode: RECURRING, cadence: MONTHLY, graceDays: 10, backfillPeriods: 2`.

---

## 8. Phasing

**P1 — Honest cardinality (backend only, no UI).**
Step scope, submission denormalisation columns + partial unique index, cross-session counting in `submitSession`, backfill migration.
*Ships:* `maxEntries: 6` starts meaning six per student. No visible change, but the data model stops lying.

**P2 — The visible fix.** ← *this alone resolves the reported problem*
`FOLLOW_UP` sessions + subject binding at open + accumulated-answer `showWhen` + the auth gate + `stepsAvailableForSubject` + "Add entry" on the record page + runner follow-up mode.
*Ships:* open a student → "Add entry" → "Monthly Progress Check" → fill → submit. No re-typing registration, no duplicate students.

**P3 — Time.**
`occurredAt`, recurring periods, backdated filing within grace, period-grouped timeline.
*Ships:* "February visit, entered in March" is recorded and sorted correctly, and the app never locks out on the 1st.

**P4 — Due and missing.** ← *the only phase with a real performance cost; ship it last*
Step schedules, overdue computation, gap rows, "Due this period" work queue.
*Ships:* the programme can see who was missed, which is the reason the data is being collected.

Per-subject due/overdue is cheap (application code over the grouped counts already fetched). **Org-wide** "who is missing this period's entry" is not — it is an anti-join across every subject in the org, and it must never be an on-page-load query. Build it as a maintained counter updated on submit, or a scheduled job writing a small summary table. If that is too much, cut the card and keep the per-record view; it carries most of the value.

---

## 9. Performance summary

| Path | Change | Why |
|------|--------|-----|
| Recording a follow-up | **~2–3× cheaper** | Today month 2 re-submits the whole registration — re-validating every question through `prepareAnswers`, re-running choice-list lookups, writing a second registration row. Follow-up mode writes one submission instead of two-plus. Less validation, fewer rows, less quota. |
| "How many progress checks?" | **Faster** | `formAppStepId` removes the `FormAppSessionEntry → session → step` walk, and disambiguates a form used by two apps. |
| Follow-up session open | **+2 queries** | Both index-backed, both bounded by step count, not history size. Zero for the `showWhen` query in apps without conditions. |
| Subject timeline | **Unchanged** | Same one-query-plus-count shape; `occurredAt` keeps the sort index-only. |
| Submission insert | **~12% more index maintenance** | Net +1 index on the hot table after the drop in 4.4. Inserts are dominated by JSON validation and choice-list lookups; this is not the bottleneck, but it is not free. |
| Submit transaction | **+1 index probe** | The occurrence unique check. It *replaces* application-level pre-flight counting that would be a query anyway. |
| App open under `RECURRING` | **Unchanged** | Period boundaries are computed, not queried; the row is written only on submit. |

**Robustness improves rather than degrades.** The partial unique index makes a duplicate month entry impossible at the database level — a guarantee unobtainable today at any price — and follow-up mode removes the duplicate-student-by-typo failure mode entirely. Both are *fewer* paths that can produce wrong data, not more.

---

## 10. Risks

- **`showWhen` over accumulated answers** is the subtlest piece. A condition written against a registration answer must resolve identically in a REGISTER session (answer in the session) and a FOLLOW_UP one (answer on a prior submission). One resolver, used by both paths, fail-closed. Needs dedicated tests.
- **Concurrent workers on one subject.** Handled by the DB index, not by the pre-flight check. Verify the `P2002` path returns a readable `422`, not a 500.
- **Anonymous follow-up** is the one genuine security hole in this design. Gate it as described in 5.2 before shipping P2, not after.
- **Quota** semantics are unchanged — charged per submission on receipt. A follow-up session of one entry costs one, which is correct.
- **Period drift** across time zones: materialise period boundaries in the org's configured zone, not UTC, or a monthly cadence will straddle month ends for half the users.
