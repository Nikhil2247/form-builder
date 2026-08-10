-- Form apps become programmes: ordered steps, and sessions that submit as one.
--
-- WHAT CHANGES CONCEPTUALLY
--
-- An app used to be `config.formIds` — a bare list. A list cannot say how many
-- times a form is filled, in what order, or under what condition, which is the
-- entire substance of a multi-part report. FormAppStep says all three.
--
-- FormAppSession then stages a respondent's answers across those steps and
-- turns them into FormSubmissions in ONE transaction. That is what makes a
-- single "Submit All" button honest: a half-submitted report, where some
-- entries landed and others did not, is worse than a rejected one — the
-- respondent cannot tell which is which and has no safe way to retry.

-- ── Enums ───────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "FormAppStepMode" AS ENUM ('SINGLE', 'REPEATABLE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "FormAppSessionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'ABANDONED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── FormApp: public surface, theme, access ──────────────────────────────────

ALTER TABLE "form_apps"
  ADD COLUMN IF NOT EXISTS "public_slug"  VARCHAR(60),
  ADD COLUMN IF NOT EXISTS "theme_config" JSONB   NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "branding"     JSONB   NOT NULL DEFAULT '{}',
  -- TRUE by default: an app writes to a registry, which is a heavier act than
  -- answering a survey, and the safe default for that is closed.
  ADD COLUMN IF NOT EXISTS "require_auth" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "allow_drafts" BOOLEAN NOT NULL DEFAULT true;

CREATE UNIQUE INDEX IF NOT EXISTS "form_apps_public_slug_key"
  ON "form_apps"("public_slug");

-- ── Steps ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "form_app_steps" (
  "id"          UUID              NOT NULL,
  "app_id"      UUID              NOT NULL,
  "form_id"     UUID              NOT NULL,
  "key"         VARCHAR(60)       NOT NULL,
  "order"       INTEGER           NOT NULL,
  "title"       VARCHAR(200)      NOT NULL,
  "description" VARCHAR(500),
  "icon"        VARCHAR(16),
  "mode"        "FormAppStepMode" NOT NULL DEFAULT 'SINGLE',
  "min_entries" INTEGER           NOT NULL DEFAULT 0,
  "max_entries" INTEGER,
  "is_optional" BOOLEAN           NOT NULL DEFAULT false,
  "show_when"   JSONB,
  "unique_by"   JSONB             NOT NULL DEFAULT '[]',
  "created_at"  TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3)      NOT NULL,
  CONSTRAINT "form_app_steps_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "form_app_steps_app_id_key_key"
  ON "form_app_steps"("app_id", "key");
CREATE INDEX IF NOT EXISTS "form_app_steps_app_id_order_idx"
  ON "form_app_steps"("app_id", "order");
CREATE INDEX IF NOT EXISTS "form_app_steps_form_id_idx"
  ON "form_app_steps"("form_id");

-- ── Periods ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "form_app_periods" (
  "id"         UUID         NOT NULL,
  "app_id"     UUID         NOT NULL,
  "label"      VARCHAR(120) NOT NULL,
  "starts_at"  TIMESTAMP(3) NOT NULL,
  "ends_at"    TIMESTAMP(3) NOT NULL,
  "is_active"  BOOLEAN      NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "form_app_periods_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "form_app_periods_app_id_is_active_idx"
  ON "form_app_periods"("app_id", "is_active");

-- ── Sessions ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "form_app_sessions" (
  "id"                 UUID                   NOT NULL,
  "app_id"             UUID                   NOT NULL,
  "organization_id"    UUID                   NOT NULL,
  "period_id"          UUID,
  "subject_id"         UUID,
  "status"             "FormAppSessionStatus" NOT NULL DEFAULT 'DRAFT',
  "respondent_id"      UUID,
  "fingerprint"        VARCHAR(64),
  "started_at"         TIMESTAMP(3)           NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submitted_at"       TIMESTAMP(3),
  "completion_time_ms" INTEGER,
  CONSTRAINT "form_app_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "form_app_sessions_app_id_status_idx"
  ON "form_app_sessions"("app_id", "status");
CREATE INDEX IF NOT EXISTS "form_app_sessions_organization_id_submitted_at_idx"
  ON "form_app_sessions"("organization_id", "submitted_at");
CREATE INDEX IF NOT EXISTS "form_app_sessions_subject_id_idx"
  ON "form_app_sessions"("subject_id");

-- At most one OPEN draft per respondent per app, so "resume where you left
-- off" has exactly one answer. Partial, because a respondent files many
-- reports over time and those SUBMITTED rows must not collide with each other.
-- Two indexes rather than one: an anonymous respondent is identified by
-- fingerprint, a signed-in one by user id, and NULLs are distinct in a unique
-- index so a single combined index would not constrain either.
CREATE UNIQUE INDEX IF NOT EXISTS "form_app_sessions_open_draft_by_fingerprint"
  ON "form_app_sessions"("app_id", "fingerprint")
  WHERE "status" = 'DRAFT' AND "fingerprint" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "form_app_sessions_open_draft_by_user"
  ON "form_app_sessions"("app_id", "respondent_id")
  WHERE "status" = 'DRAFT' AND "respondent_id" IS NOT NULL;

-- ── Session entries ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "form_app_session_entries" (
  "id"              UUID         NOT NULL,
  "session_id"      UUID         NOT NULL,
  "step_id"         UUID         NOT NULL,
  "index"           INTEGER      NOT NULL,
  "answers"         JSONB        NOT NULL DEFAULT '{}',
  "form_version_id" UUID         NOT NULL,
  "submission_id"   UUID,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "form_app_session_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "form_app_session_entries_session_id_step_id_index_key"
  ON "form_app_session_entries"("session_id", "step_id", "index");
CREATE UNIQUE INDEX IF NOT EXISTS "form_app_session_entries_submission_id_key"
  ON "form_app_session_entries"("submission_id");
CREATE INDEX IF NOT EXISTS "form_app_session_entries_session_id_idx"
  ON "form_app_session_entries"("session_id");

-- ── Foreign keys ────────────────────────────────────────────────────────────

ALTER TABLE "form_app_steps" DROP CONSTRAINT IF EXISTS "form_app_steps_app_id_fkey";
ALTER TABLE "form_app_steps" ADD CONSTRAINT "form_app_steps_app_id_fkey"
  FOREIGN KEY ("app_id") REFERENCES "form_apps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RESTRICT, not CASCADE: deleting a form that an app step depends on must fail
-- loudly rather than silently removing a step from a live programme.
ALTER TABLE "form_app_steps" DROP CONSTRAINT IF EXISTS "form_app_steps_form_id_fkey";
ALTER TABLE "form_app_steps" ADD CONSTRAINT "form_app_steps_form_id_fkey"
  FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "form_app_periods" DROP CONSTRAINT IF EXISTS "form_app_periods_app_id_fkey";
ALTER TABLE "form_app_periods" ADD CONSTRAINT "form_app_periods_app_id_fkey"
  FOREIGN KEY ("app_id") REFERENCES "form_apps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "form_app_sessions" DROP CONSTRAINT IF EXISTS "form_app_sessions_app_id_fkey";
ALTER TABLE "form_app_sessions" ADD CONSTRAINT "form_app_sessions_app_id_fkey"
  FOREIGN KEY ("app_id") REFERENCES "form_apps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "form_app_sessions" DROP CONSTRAINT IF EXISTS "form_app_sessions_period_id_fkey";
ALTER TABLE "form_app_sessions" ADD CONSTRAINT "form_app_sessions_period_id_fkey"
  FOREIGN KEY ("period_id") REFERENCES "form_app_periods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "form_app_sessions" DROP CONSTRAINT IF EXISTS "form_app_sessions_subject_id_fkey";
ALTER TABLE "form_app_sessions" ADD CONSTRAINT "form_app_sessions_subject_id_fkey"
  FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "form_app_session_entries" DROP CONSTRAINT IF EXISTS "form_app_session_entries_session_id_fkey";
ALTER TABLE "form_app_session_entries" ADD CONSTRAINT "form_app_session_entries_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "form_app_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "form_app_session_entries" DROP CONSTRAINT IF EXISTS "form_app_session_entries_step_id_fkey";
ALTER TABLE "form_app_session_entries" ADD CONSTRAINT "form_app_session_entries_step_id_fkey"
  FOREIGN KEY ("step_id") REFERENCES "form_app_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Backfill: config.formIds → steps ────────────────────────────────────────
--
-- Each previously-listed form becomes a SINGLE step, in its original order,
-- titled after the form. That preserves every existing app's behaviour exactly
-- while moving it onto the new model; an author can then change any step's mode
-- to REPEATABLE. `config.formIds` is removed afterwards so nothing can read a
-- stale copy — the steps table is now the only answer to "what is in this app".

INSERT INTO "form_app_steps" (
  "id", "app_id", "form_id", "key", "order", "title", "mode", "min_entries",
  "is_optional", "unique_by", "created_at", "updated_at"
)
SELECT
  gen_random_uuid(),
  a."id",
  f."id",
  -- Unique within the app, and stable: derived from position, not from a title
  -- that the author may well change tomorrow.
  'step_' || (ordinality::text),
  (ordinality - 1)::int,
  LEFT(f."title", 200),
  'SINGLE'::"FormAppStepMode",
  1,
  false,
  '[]'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "form_apps" a
CROSS JOIN LATERAL jsonb_array_elements_text(
  CASE
    WHEN jsonb_typeof(a."config" -> 'formIds') = 'array' THEN a."config" -> 'formIds'
    ELSE '[]'::jsonb
  END
) WITH ORDINALITY AS elem(form_id, ordinality)
JOIN "forms" f
  ON f."id" = elem.form_id::uuid
 AND f."organization_id" = a."organization_id"
 AND f."deleted_at" IS NULL
WHERE a."deleted_at" IS NULL
ON CONFLICT DO NOTHING;

UPDATE "form_apps" SET "config" = "config" - 'formIds'
WHERE "config" ? 'formIds';
