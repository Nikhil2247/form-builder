-- Subjects (the longitudinal record) and Form Apps (the data-entry surface).
--
-- Entirely additive. Two new tables, one new enum, and nullable columns on
-- `forms` and `form_submissions`. Every existing form is subject_role = 'NONE'
-- and behaves exactly as before.
--
-- The one column that needs care is form_submissions.organization_id: the table
-- is the largest in the schema, so it is added nullable (no rewrite) and
-- backfilled in batches rather than in one statement that would hold a lock
-- across the whole table.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Enum
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FormSubjectRole') THEN
    CREATE TYPE "FormSubjectRole" AS ENUM ('NONE', 'REGISTERS', 'ATTACHES');
  END IF;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. subject_types
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "subject_types" (
  "id"                   UUID         NOT NULL,
  "organization_id"      UUID         NOT NULL,
  "name"                 VARCHAR(100) NOT NULL,
  "slug"                 VARCHAR(60)  NOT NULL,
  "icon"                 VARCHAR(16),
  "registration_form_id" UUID,
  "identity_config"      JSONB        NOT NULL DEFAULT '{}'::jsonb,
  "deleted_at"           TIMESTAMP(3),
  "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           TIMESTAMP(3) NOT NULL,
  CONSTRAINT "subject_types_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "subject_types_organization_id_slug_key"
  ON "subject_types"("organization_id", "slug");
CREATE INDEX IF NOT EXISTS "subject_types_organization_id_idx"
  ON "subject_types"("organization_id");

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. subjects
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "subjects" (
  "id"                         UUID         NOT NULL,
  "organization_id"            UUID         NOT NULL,
  "subject_type_id"            UUID         NOT NULL,
  "display_name"               VARCHAR(200) NOT NULL,
  "attributes"                 JSONB        NOT NULL DEFAULT '{}'::jsonb,
  "external_id"                VARCHAR(100),
  "registration_submission_id" UUID,
  "deleted_at"                 TIMESTAMP(3),
  "created_at"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"                 TIMESTAMP(3) NOT NULL,
  CONSTRAINT "subjects_pkey" PRIMARY KEY ("id")
);

-- NULLs do not collide in a Postgres unique index, so subjects without an
-- external id are unconstrained — which is the intent. external_id is the hard
-- de-duplication guarantee only for callers that supply one.
CREATE UNIQUE INDEX IF NOT EXISTS "subjects_subject_type_id_external_id_key"
  ON "subjects"("subject_type_id", "external_id");
CREATE UNIQUE INDEX IF NOT EXISTS "subjects_registration_submission_id_key"
  ON "subjects"("registration_submission_id");
-- Backs subject search within a workspace.
CREATE INDEX IF NOT EXISTS "subjects_organization_id_subject_type_id_display_name_idx"
  ON "subjects"("organization_id", "subject_type_id", "display_name");
-- Backs the "registered recently" dashboard cards.
CREATE INDEX IF NOT EXISTS "subjects_organization_id_created_at_idx"
  ON "subjects"("organization_id", "created_at");

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. form_apps
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "form_apps" (
  "id"              UUID         NOT NULL,
  "organization_id" UUID         NOT NULL,
  "subject_type_id" UUID         NOT NULL,
  "name"            VARCHAR(120) NOT NULL,
  "slug"            VARCHAR(60)  NOT NULL,
  "description"     TEXT,
  "icon"            VARCHAR(16),
  "config"          JSONB        NOT NULL DEFAULT '{}'::jsonb,
  "is_published"    BOOLEAN      NOT NULL DEFAULT false,
  "deleted_at"      TIMESTAMP(3),
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "form_apps_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "form_apps_organization_id_slug_key"
  ON "form_apps"("organization_id", "slug");
CREATE INDEX IF NOT EXISTS "form_apps_organization_id_idx"
  ON "form_apps"("organization_id");

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. forms — optional subject binding
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "forms"
  ADD COLUMN IF NOT EXISTS "subject_type_id" UUID;

-- A defaulted enum column: metadata-only on Postgres 11+, no table rewrite.
ALTER TABLE "forms"
  ADD COLUMN IF NOT EXISTS "subject_role" "FormSubjectRole" NOT NULL DEFAULT 'NONE';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. form_submissions — denormalised tenant + subject link
--
-- Both nullable, so neither triggers a rewrite of the largest table here.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "form_submissions"
  ADD COLUMN IF NOT EXISTS "organization_id" UUID;

ALTER TABLE "form_submissions"
  ADD COLUMN IF NOT EXISTS "subject_id" UUID;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Backfill organization_id in batches.
--
-- A single UPDATE over every submission would hold row locks for the whole
-- table and produce one enormous WAL record. This loops in 10k-row batches,
-- committing between each, so the table stays writable throughout — ingest
-- continues while this runs.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  touched INTEGER;
BEGIN
  LOOP
    UPDATE "form_submissions" s
    SET "organization_id" = f."organization_id"
    FROM "forms" f
    WHERE f."id" = s."form_id"
      AND s."organization_id" IS NULL
      AND s."id" IN (
        SELECT "id" FROM "form_submissions"
        WHERE "organization_id" IS NULL
        LIMIT 10000
      );

    GET DIAGNOSTICS touched = ROW_COUNT;
    EXIT WHEN touched = 0;
    COMMIT;
  END LOOP;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Indexes
--
-- Created after the backfill so each is built once over final data rather than
-- being maintained through every batch above.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "form_submissions_subject_id_submitted_at_idx"
  ON "form_submissions"("subject_id", "submitted_at" DESC);
CREATE INDEX IF NOT EXISTS "form_submissions_organization_id_submitted_at_idx"
  ON "form_submissions"("organization_id", "submitted_at" DESC);
-- Resolving a cross-form rule reference: this subject's latest answer to form X.
CREATE INDEX IF NOT EXISTS "form_submissions_subject_id_form_id_submitted_at_idx"
  ON "form_submissions"("subject_id", "form_id", "submitted_at" DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Foreign keys
--
-- ON DELETE semantics, deliberately chosen:
--   subject_types → organizations   CASCADE    tenant deletion removes config
--   subjects      → subject_types   RESTRICT   never orphan records silently
--   forms         → subject_types   SET NULL   unbinding a type leaves the form
--   submissions   → subjects        SET NULL   deleting a subject must never
--                                              destroy the responses collected
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "subject_types"
  DROP CONSTRAINT IF EXISTS "subject_types_organization_id_fkey";
ALTER TABLE "subject_types"
  ADD CONSTRAINT "subject_types_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "subjects"
  DROP CONSTRAINT IF EXISTS "subjects_organization_id_fkey";
ALTER TABLE "subjects"
  ADD CONSTRAINT "subjects_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "subjects"
  DROP CONSTRAINT IF EXISTS "subjects_subject_type_id_fkey";
ALTER TABLE "subjects"
  ADD CONSTRAINT "subjects_subject_type_id_fkey"
  FOREIGN KEY ("subject_type_id") REFERENCES "subject_types"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "form_apps"
  DROP CONSTRAINT IF EXISTS "form_apps_organization_id_fkey";
ALTER TABLE "form_apps"
  ADD CONSTRAINT "form_apps_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "form_apps"
  DROP CONSTRAINT IF EXISTS "form_apps_subject_type_id_fkey";
ALTER TABLE "form_apps"
  ADD CONSTRAINT "form_apps_subject_type_id_fkey"
  FOREIGN KEY ("subject_type_id") REFERENCES "subject_types"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "forms"
  DROP CONSTRAINT IF EXISTS "forms_subject_type_id_fkey";
ALTER TABLE "forms"
  ADD CONSTRAINT "forms_subject_type_id_fkey"
  FOREIGN KEY ("subject_type_id") REFERENCES "subject_types"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "form_submissions"
  DROP CONSTRAINT IF EXISTS "form_submissions_subject_id_fkey";
ALTER TABLE "form_submissions"
  ADD CONSTRAINT "form_submissions_subject_id_fkey"
  FOREIGN KEY ("subject_id") REFERENCES "subjects"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
