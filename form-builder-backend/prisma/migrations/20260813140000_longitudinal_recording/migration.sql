-- Longitudinal recording — P1: scoped cardinality and occurrences.
--
-- WHAT CHANGES CONCEPTUALLY
--
-- A step's cardinality used to be counted within one SITTING. For anything
-- that repeats over time that is the wrong window, and it made the existing
-- configuration quietly dishonest: `max_entries = 6` on a monthly progress
-- check meant six per sitting rather than six per student, and
-- `unique_by = ["month_number"]` could not stop month 3 being entered twice in
-- two different sessions — it only ever compared entries staged side by side.
--
-- `scope` names the window explicitly. SESSION is the default and reproduces
-- the old behaviour exactly, so no existing app changes shape when this runs.
--
-- The submissions table gains the provenance columns that make counting across
-- sessions a single indexed scan instead of a walk through session entries, and
-- an occurrence key whose UNIQUE index is what actually prevents a duplicate
-- month. An application-level count cannot: two coordinators submitting March
-- for the same student at the same instant both read zero and both pass.
--
-- Written to be safe against a live database: every added column is nullable or
-- defaulted, the one NOT NULL column is backfilled before its constraint lands,
-- and the backfill of historical provenance is derived from links that already
-- exist rather than guessed.

-- ── Enums ───────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "FormAppStepScope" AS ENUM ('SESSION', 'SUBJECT', 'SUBJECT_PERIOD');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "FormAppSessionMode" AS ENUM ('REGISTER', 'FOLLOW_UP');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Steps: scope and the real-world date ────────────────────────────────────

ALTER TABLE "form_app_steps"
  ADD COLUMN IF NOT EXISTS "scope" "FormAppStepScope" NOT NULL DEFAULT 'SESSION',
  ADD COLUMN IF NOT EXISTS "occurred_at_key" VARCHAR(60);

-- ── Sessions: mode and step narrowing ───────────────────────────────────────

ALTER TABLE "form_app_sessions"
  ADD COLUMN IF NOT EXISTS "mode" "FormAppSessionMode" NOT NULL DEFAULT 'REGISTER',
  ADD COLUMN IF NOT EXISTS "step_keys" JSONB NOT NULL DEFAULT '[]';

-- The open-draft key gains the subject.
--
-- A field worker mid-round has one unfinished visit per STUDENT, not one in
-- total. Keyed on the respondent alone, opening student B's form silently
-- resumes student A's half-written one — which, with staged answers prefilled,
-- is a data-corruption bug rather than a UX annoyance.
--
-- The original pair of indexes is kept as a pair for the reason the previous
-- migration gives: NULLs are distinct in a unique index, so one combined index
-- over (fingerprint, respondent_id) would constrain neither identity. Only the
-- subject dimension is added.
--
-- COALESCE on subject_id, because that same NULL-distinctness would otherwise
-- exempt every REGISTER draft (subject_id IS NULL until submit) from the
-- constraint, letting one respondent accumulate unlimited blank drafts.
DROP INDEX IF EXISTS "form_app_sessions_open_draft_by_fingerprint";
DROP INDEX IF EXISTS "form_app_sessions_open_draft_by_user";

CREATE UNIQUE INDEX IF NOT EXISTS "form_app_sessions_open_draft_by_fingerprint"
  ON "form_app_sessions" (
    "app_id",
    "fingerprint",
    COALESCE("subject_id", '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE "status" = 'DRAFT' AND "fingerprint" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "form_app_sessions_open_draft_by_user"
  ON "form_app_sessions" (
    "app_id",
    "respondent_id",
    COALESCE("subject_id", '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE "status" = 'DRAFT' AND "respondent_id" IS NOT NULL;

-- ── Submissions: provenance, occurrence date, occurrence identity ───────────

ALTER TABLE "form_submissions"
  ADD COLUMN IF NOT EXISTS "app_session_id"    UUID,
  ADD COLUMN IF NOT EXISTS "form_app_step_id"  UUID,
  ADD COLUMN IF NOT EXISTS "period_id"         UUID,
  ADD COLUMN IF NOT EXISTS "occurrence_key"    VARCHAR(80);

-- occurred_at is added nullable, backfilled, and only then made NOT NULL.
-- NOT NULL rather than nullable-with-a-read-time-fallback because
-- `ORDER BY COALESCE(occurred_at, submitted_at)` cannot use a btree index —
-- the timeline would sort its entire result set on every page load.
ALTER TABLE "form_submissions" ADD COLUMN IF NOT EXISTS "occurred_at" TIMESTAMP(3);

-- Two cases, and the second is why this is not simply `WHERE occurred_at IS NULL`.
--
--  1. The column was just created here, so every row is NULL.
--  2. The column already existed because a `prisma db push` created it FROM THE
--     SCHEMA, where it carries `@default(now())`. Postgres then stamped every
--     pre-existing row with the moment of that push — so a response collected
--     last March claims to have occurred the day somebody synced the schema,
--     and the timeline orders the entire history by that one instant.
--
-- `form_app_step_id IS NULL` identifies case 2 precisely: only the new submit
-- path writes a meaningful `occurred_at`, and it always writes
-- `form_app_step_id` in the same statement. A row without one cannot have a
-- deliberate occurrence date to protect. Standalone submissions match too and
-- are unaffected — theirs already equals the submission time.
--
-- This MUST run before the provenance backfill below, which is about to give
-- those same rows a `form_app_step_id` and would otherwise exclude them.
UPDATE "form_submissions"
   SET "occurred_at" = "submitted_at"
 WHERE "occurred_at" IS NULL
    OR "form_app_step_id" IS NULL;

ALTER TABLE "form_submissions" ALTER COLUMN "occurred_at" SET NOT NULL;
ALTER TABLE "form_submissions" ALTER COLUMN "occurred_at" SET DEFAULT CURRENT_TIMESTAMP;

-- Historical provenance, derived rather than guessed: FormAppSessionEntry
-- already records which submission each staged entry became, so the step and
-- session are recoverable exactly for every submission an app ever produced.
-- Anything not reachable this way was a standalone form submission and
-- correctly keeps NULLs.
UPDATE "form_submissions" s
   SET "app_session_id"   = e."session_id",
       "form_app_step_id" = e."step_id"
  FROM "form_app_session_entries" e
 WHERE e."submission_id" = s."id"
   AND s."app_session_id" IS NULL;

UPDATE "form_submissions" s
   SET "period_id" = sess."period_id"
  FROM "form_app_sessions" sess
 WHERE sess."id" = s."app_session_id"
   AND s."period_id" IS NULL
   AND sess."period_id" IS NOT NULL;

-- occurrence_key is deliberately NOT backfilled. It is a hash of a step's
-- unique_by answers under the CURRENT schema, and inventing values for history
-- would either fabricate collisions or mask real ones. Historical rows stay
-- NULL, the partial unique index ignores them, and the first new entry for a
-- step establishes the series.

-- Guarded, because Postgres has no `ADD CONSTRAINT IF NOT EXISTS`.
--
-- Every other statement in this file is idempotent, and these three were not —
-- so re-running the migration against a database where a `prisma db push` had
-- already created the foreign keys aborted the whole thing at this point with
-- 42710, leaving the partial unique index below and both backfills unapplied.
-- A migration that cannot be re-run is a migration that cannot be recovered.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'form_submissions_app_session_id_fkey') THEN
    ALTER TABLE "form_submissions"
      ADD CONSTRAINT "form_submissions_app_session_id_fkey"
      FOREIGN KEY ("app_session_id") REFERENCES "form_app_sessions"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'form_submissions_form_app_step_id_fkey') THEN
    ALTER TABLE "form_submissions"
      ADD CONSTRAINT "form_submissions_form_app_step_id_fkey"
      FOREIGN KEY ("form_app_step_id") REFERENCES "form_app_steps"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'form_submissions_period_id_fkey') THEN
    ALTER TABLE "form_submissions"
      ADD CONSTRAINT "form_submissions_period_id_fkey"
      FOREIGN KEY ("period_id") REFERENCES "form_app_periods"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ── Indexes ─────────────────────────────────────────────────────────────────

-- The timeline now orders by occurred_at, which leaves the submitted_at variant
-- with no reader. Swapped rather than accumulated: form_submissions is the
-- hottest write table in the system and already carries eight indexes, each of
-- which every INSERT must maintain.
CREATE INDEX IF NOT EXISTS "form_submissions_subject_id_occurred_at_idx"
  ON "form_submissions" ("subject_id", "occurred_at" DESC);
DROP INDEX IF EXISTS "form_submissions_subject_id_submitted_at_idx";

-- Step availability for one subject in a single grouped scan:
--   SELECT form_app_step_id, period_id, count(*) … GROUP BY 1, 2
CREATE INDEX IF NOT EXISTS "form_submissions_subject_id_form_app_step_id_period_id_idx"
  ON "form_submissions" ("subject_id", "form_app_step_id", "period_id");

-- The guarantee. Not an application check: two coordinators submitting March
-- for the same student concurrently both read a count of zero and both pass.
-- Partial, so the overwhelming majority of rows — standalone submissions, and
-- steps that declare no unique_by — are absent from it entirely.
CREATE UNIQUE INDEX IF NOT EXISTS "form_submissions_occurrence_uniq"
  ON "form_submissions" ("subject_id", "form_app_step_id", "occurrence_key")
  WHERE "subject_id" IS NOT NULL
    AND "form_app_step_id" IS NOT NULL
    AND "occurrence_key" IS NOT NULL
    AND "deleted_at" IS NULL;

-- ── Optional, NOT applied here ──────────────────────────────────────────────
--
-- "form_submissions_form_id_submitted_at_idx" is believed to be superseded by
-- "form_submissions_form_id_deleted_at_submitted_at_idx", since every read path
-- now carries `deletedAt: null`. Dropping it would take this migration's net
-- index cost on the hot table from +2 to +1.
--
-- It is left in place because that belief comes from reading the code, not from
-- measuring the database. Confirm against real traffic first:
--
--   SELECT indexrelname, idx_scan
--     FROM pg_stat_user_indexes
--    WHERE relname = 'form_submissions'
--    ORDER BY idx_scan;
--
-- and only if idx_scan is ~0 after a representative window:
--
--   DROP INDEX CONCURRENTLY "form_submissions_form_id_submitted_at_idx";
