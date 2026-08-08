-- Feature flags.
--
-- Two levels, resolved as: organization override, else global default. That
-- lets a super-admin dark-launch a capability (global OFF), enable it for one
-- pilot organization, and later flip the global default without touching any
-- per-org rows.
--
-- Keyed by a stable string rather than a uuid, because flags are referenced by
-- name in application code (`FORM_APPS`) — a generated id would force a lookup
-- just to answer "is this on?".

CREATE TABLE IF NOT EXISTS "feature_flags" (
  "key"                 VARCHAR(60)  NOT NULL,
  "name"                VARCHAR(120) NOT NULL,
  "description"         TEXT,
  "is_enabled_globally" BOOLEAN      NOT NULL DEFAULT false,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("key")
);

CREATE TABLE IF NOT EXISTS "organization_feature_flags" (
  "organization_id" UUID         NOT NULL,
  "flag_key"        VARCHAR(60)  NOT NULL,
  "is_enabled"      BOOLEAN      NOT NULL,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "organization_feature_flags_pkey" PRIMARY KEY ("organization_id", "flag_key")
);

CREATE INDEX IF NOT EXISTS "organization_feature_flags_organization_id_idx"
  ON "organization_feature_flags"("organization_id");

ALTER TABLE "organization_feature_flags"
  DROP CONSTRAINT IF EXISTS "organization_feature_flags_organization_id_fkey";
ALTER TABLE "organization_feature_flags"
  ADD CONSTRAINT "organization_feature_flags_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Deleting a flag definition removes its overrides too: an override for a flag
-- that no longer exists is unreadable state, not history worth keeping.
ALTER TABLE "organization_feature_flags"
  DROP CONSTRAINT IF EXISTS "organization_feature_flags_flag_key_fkey";
ALTER TABLE "organization_feature_flags"
  ADD CONSTRAINT "organization_feature_flags_flag_key_fkey"
  FOREIGN KEY ("flag_key") REFERENCES "feature_flags"("key")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed the flags the application knows about.
--
-- Both default to OFF. Data Apps in particular is a whole new navigation mode,
-- so every existing organization keeps exactly the UI it has today until a
-- super-admin turns it on.
--
-- ON CONFLICT DO NOTHING makes this migration safe to re-run and, importantly,
-- means it never resets a flag an operator has already toggled in production.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO "feature_flags" ("key", "name", "description", "is_enabled_globally", "updated_at")
VALUES
  (
    'FORM_APPS',
    'Data Apps',
    'Subject records, linked forms, and the data-entry app surface. Adds a second navigation mode alongside Forms.',
    false,
    CURRENT_TIMESTAMP
  ),
  (
    'FORM_RULES',
    'Form rules',
    'Calculated fields, multi-condition show/hide, cross-field validation, and conditional requirement in the form builder.',
    false,
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("key") DO NOTHING;
