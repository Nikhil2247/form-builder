-- Phase A/B/C schema changes.
--
-- Covers four independent pieces of work that all needed DDL, applied together
-- so the codebase only takes one migration boundary:
--   B1  refresh-token families + revoke reasons
--   B5  API key soft-revoke
--   C1  submission review annotation + soft delete
--   C4  asynchronous export jobs
--
-- Written to be safe to run against a live database: every added column is
-- nullable or defaulted, and the one NOT NULL column is backfilled before the
-- constraint is applied.

-- ────────────────────────────────────────────────────────────────────────────
-- B1 — Refresh token families
-- ────────────────────────────────────────────────────────────────────────────

CREATE TYPE "RefreshTokenRevokeReason" AS ENUM (
  'ROTATED',
  'LOGOUT',
  'PASSWORD_RESET',
  'ADMIN_REVOKED',
  'REUSE_DETECTED'
);

-- Added nullable first. Existing tokens predate families, so each one becomes
-- the root of its own single-member family — which is exactly the invariant a
-- fresh login produces, and means no existing session is invalidated by this
-- migration.
ALTER TABLE "refresh_tokens" ADD COLUMN "family_id" UUID;
UPDATE "refresh_tokens" SET "family_id" = "id" WHERE "family_id" IS NULL;
ALTER TABLE "refresh_tokens" ALTER COLUMN "family_id" SET NOT NULL;

ALTER TABLE "refresh_tokens" ADD COLUMN "revoked_reason" "RefreshTokenRevokeReason";

-- Rows revoked before this migration were revoked by rotation or logout and we
-- cannot now tell which. ROTATED is the safe label: it is the non-security
-- reading, so this backfill can never manufacture a false compromise signal.
UPDATE "refresh_tokens"
   SET "revoked_reason" = 'ROTATED'
 WHERE "revoked_at" IS NOT NULL
   AND "revoked_reason" IS NULL;

CREATE INDEX "refresh_tokens_family_id_revoked_at_idx"
    ON "refresh_tokens" ("family_id", "revoked_at");

-- ────────────────────────────────────────────────────────────────────────────
-- B5 — API key soft revoke
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE "api_keys" ADD COLUMN "revoked_at" TIMESTAMP(3);

-- ────────────────────────────────────────────────────────────────────────────
-- C1 — Submission review + soft delete
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE "form_submissions" ADD COLUMN "review_note"     TEXT;
ALTER TABLE "form_submissions" ADD COLUMN "reviewed_by_id"  UUID;
ALTER TABLE "form_submissions" ADD COLUMN "reviewed_at"     TIMESTAMP(3);
ALTER TABLE "form_submissions" ADD COLUMN "deleted_at"      TIMESTAMP(3);
ALTER TABLE "form_submissions" ADD COLUMN "deleted_by_id"   UUID;

-- The enum already carried DELETED, and rows may already be sitting in that
-- state from the admin panel. Give them a deleted_at so the new read filters
-- (which key off deleted_at, not status) do not resurrect them.
UPDATE "form_submissions"
   SET "deleted_at" = COALESCE("processed_at", "submitted_at")
 WHERE "status" = 'DELETED'
   AND "deleted_at" IS NULL;

ALTER TABLE "form_submissions"
  ADD CONSTRAINT "form_submissions_reviewed_by_id_fkey"
  FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "form_submissions"
  ADD CONSTRAINT "form_submissions_deleted_by_id_fkey"
  FOREIGN KEY ("deleted_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "form_submissions_form_id_deleted_at_submitted_at_idx"
    ON "form_submissions" ("form_id", "deleted_at", "submitted_at" DESC);

-- ────────────────────────────────────────────────────────────────────────────
-- C4 — Asynchronous export jobs
-- ────────────────────────────────────────────────────────────────────────────

CREATE TYPE "ExportJobStatus" AS ENUM (
  'QUEUED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'EXPIRED'
);

CREATE TYPE "ExportJobFormat" AS ENUM ('CSV', 'JSON');

CREATE TABLE "export_jobs" (
  "id"                UUID              NOT NULL,
  "organization_id"   UUID              NOT NULL,
  "form_id"           UUID,
  "requested_by_id"   UUID              NOT NULL,
  "status"            "ExportJobStatus" NOT NULL DEFAULT 'QUEUED',
  "format"            "ExportJobFormat" NOT NULL DEFAULT 'CSV',
  "filters"           JSONB             NOT NULL DEFAULT '{}',
  "rows_written"      INTEGER           NOT NULL DEFAULT 0,
  "rows_total"        INTEGER,
  "object_key"        VARCHAR(500),
  "bytes"             BIGINT,
  "provider"          "StorageProvider" NOT NULL DEFAULT 'MINIO',
  "error"             TEXT,
  "expires_at"        TIMESTAMP(3),
  "started_at"        TIMESTAMP(3),
  "completed_at"      TIMESTAMP(3),
  "created_at"        TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3)      NOT NULL,

  CONSTRAINT "export_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "export_jobs_organization_id_created_at_idx"
    ON "export_jobs" ("organization_id", "created_at" DESC);
CREATE INDEX "export_jobs_status_expires_at_idx"
    ON "export_jobs" ("status", "expires_at");
CREATE INDEX "export_jobs_form_id_idx"          ON "export_jobs" ("form_id");
CREATE INDEX "export_jobs_requested_by_id_idx"  ON "export_jobs" ("requested_by_id");

ALTER TABLE "export_jobs"
  ADD CONSTRAINT "export_jobs_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "export_jobs"
  ADD CONSTRAINT "export_jobs_form_id_fkey"
  FOREIGN KEY ("form_id") REFERENCES "forms"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "export_jobs"
  ADD CONSTRAINT "export_jobs_requested_by_id_fkey"
  FOREIGN KEY ("requested_by_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
