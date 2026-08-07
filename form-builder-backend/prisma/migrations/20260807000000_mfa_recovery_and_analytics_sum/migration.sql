-- ============================================================================
-- Migration: MFA recovery codes + true analytics average
-- ============================================================================

-- ── MFA recovery codes ──────────────────────────────────────────────────────
-- Single-use codes issued at MFA enrolment. Without these a lost authenticator
-- device makes the account unrecoverable without manual support intervention.
CREATE TABLE "mfa_recovery_codes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" VARCHAR(255) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_recovery_codes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "mfa_recovery_codes_user_id_used_at_idx"
    ON "mfa_recovery_codes"("user_id", "used_at");

ALTER TABLE "mfa_recovery_codes"
    ADD CONSTRAINT "mfa_recovery_codes_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Analytics: store the SUM so the average is a real mean ──────────────────
-- The worker previously maintained avg_completion_ms as (existing + new) / 2,
-- which is an exponential recency-weighted average, not the daily mean. Adding
-- the running sum lets us compute the true average.
ALTER TABLE "form_analytics"
    ADD COLUMN "sum_completion_ms" BIGINT NOT NULL DEFAULT 0;

-- Backfill: the historical sum is unknowable, but avg * submissions is the best
-- available estimate and keeps the derived average stable going forward.
UPDATE "form_analytics"
   SET "sum_completion_ms" = "avg_completion_ms"::BIGINT * GREATEST("submissions", 1)
 WHERE "avg_completion_ms" > 0;
