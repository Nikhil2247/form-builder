-- Longitudinal recording — P3 (recurring windows) and P4 (schedules).
--
-- WHAT CHANGES CONCEPTUALLY
--
-- Reporting windows used to be hand-made rows, and being outside them CLOSED
-- the app for everybody. That is right for a survey which runs February to May
-- and then stops. It is wrong for anything that repeats: a monthly programme
-- needs twelve rows a year, and locks every field worker out on the 1st.
--
-- `period_mode` names which of the two an app is. RECURRING derives the current
-- window from a cadence — computed in application code, not stored — and treats
-- being between windows as ordinary rather than as closed. Late entry is the
-- normal case in field work; refusing it is what makes people file under the
-- wrong month.
--
-- `schedule` on a step says when it becomes DUE. It is advisory and never a
-- gate: a step past its date stays fillable and one not yet due can be filled
-- early. What it buys is the ability to say "this record has no February
-- check", which is the output a monitoring programme exists to produce and the
-- one thing a timeline of what DID happen can never show.
--
-- Safe against a live database: every column is nullable or defaulted, and the
-- one behavioural change — apps with existing periods becoming FIXED — is a
-- backfill that PRESERVES how those apps already behave.

-- ── Enum ────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "FormAppPeriodMode" AS ENUM ('NONE', 'FIXED', 'RECURRING');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── App: how its windows come into being ────────────────────────────────────

ALTER TABLE "form_apps"
  ADD COLUMN IF NOT EXISTS "period_mode"   "FormAppPeriodMode" NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS "period_config" JSONB               NOT NULL DEFAULT '{}';

-- An app that already has periods behaved as FIXED — closed outside them — and
-- must keep doing so. Defaulting it to NONE would silently throw its windows
-- away and start accepting reports year-round, which is a data-integrity change
-- nobody asked for. Apps with no periods are genuinely NONE and stay there.
UPDATE "form_apps" a
   SET "period_mode" = 'FIXED'
 WHERE a."period_mode" = 'NONE'
   AND EXISTS (SELECT 1 FROM "form_app_periods" p WHERE p."app_id" = a."id");

-- ── Periods: generated windows ──────────────────────────────────────────────

ALTER TABLE "form_app_periods"
  ADD COLUMN IF NOT EXISTS "is_generated" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "sequence"     INTEGER;

-- Two concurrent submits into a window that has not been materialised yet must
-- converge on ONE row. Without this they would each insert their own, the same
-- month would exist twice, and SUBJECT_PERIOD counting would split across them
-- and quietly allow two entries where the author asked for one.
--
-- Hand-made periods are included in the constraint deliberately: two windows
-- for one app starting at the same instant are a configuration error whichever
-- way they were created. If this index fails to build, that is a real duplicate
-- in the data and it needs resolving rather than the constraint relaxing.
CREATE UNIQUE INDEX IF NOT EXISTS "form_app_periods_app_id_starts_at_key"
  ON "form_app_periods" ("app_id", "starts_at");

-- ── Steps: when a step becomes due ──────────────────────────────────────────

ALTER TABLE "form_app_steps"
  ADD COLUMN IF NOT EXISTS "schedule" JSONB;

-- ── The work queue's anti-join ──────────────────────────────────────────────
--
-- "Which records are missing this window's entry" is
--   subjects LEFT JOIN form_submissions … WHERE fs.id IS NULL
-- and the probe side is already served by
-- form_submissions_subject_id_form_app_step_id_period_id_idx (added in the
-- previous migration). What was missing is an ordered scan of the DRIVING side,
-- so the query can stop as soon as it has filled a page instead of sorting
-- every subject in the organization.
--
-- The queue is deliberately offered as a paginated LIST and never as a total:
-- a LIMITed anti-join stops early, whereas COUNT(*) over the same shape has to
-- probe every subject that exists. The number is the expensive part, not the
-- rows.
CREATE INDEX IF NOT EXISTS "subjects_subject_type_id_created_at_idx"
  ON "subjects" ("subject_type_id", "created_at" DESC)
  WHERE "deleted_at" IS NULL;
