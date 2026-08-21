-- AI assistant foundation: session/message storage, per-org quota fields, and
-- the ORG_INSIGHTS / HELP_GUIDE / IDEA_SUGGESTION / PLATFORM_INSIGHTS modes.
--
-- Entirely additive. New quota columns on `organizations` default to generous
-- values, so no existing org's behavior changes until the assistant module
-- actually starts counting usage against them.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Enums
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AssistantMode') THEN
    CREATE TYPE "AssistantMode" AS ENUM ('ORG_INSIGHTS', 'HELP_GUIDE', 'IDEA_SUGGESTION', 'PLATFORM_INSIGHTS');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AssistantMessageRole') THEN
    CREATE TYPE "AssistantMessageRole" AS ENUM ('USER', 'ASSISTANT', 'TOOL');
  END IF;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. organizations — AI quota columns
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "max_ai_queries_month"  INTEGER NOT NULL DEFAULT 500,
  ADD COLUMN IF NOT EXISTS "ai_queries_this_month" INTEGER NOT NULL DEFAULT 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. assistant_sessions
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "assistant_sessions" (
  "id"              UUID            NOT NULL,
  "organization_id" UUID,
  "user_id"         UUID            NOT NULL,
  "mode"            "AssistantMode" NOT NULL,
  "title"           VARCHAR(200),
  "created_at"      TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3)    NOT NULL,
  CONSTRAINT "assistant_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "assistant_sessions_organization_id_user_id_idx"
  ON "assistant_sessions"("organization_id", "user_id");
CREATE INDEX IF NOT EXISTS "assistant_sessions_user_id_mode_idx"
  ON "assistant_sessions"("user_id", "mode");

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. assistant_messages
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "assistant_messages" (
  "id"                UUID                    NOT NULL,
  "session_id"        UUID                    NOT NULL,
  "role"              "AssistantMessageRole"  NOT NULL,
  "content"           JSONB                   NOT NULL,
  "model_used"        VARCHAR(60),
  "input_tokens"      INTEGER,
  "output_tokens"     INTEGER,
  "cache_read_tokens" INTEGER,
  "tool_calls"        JSONB,
  "created_at"        TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "assistant_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "assistant_messages_session_id_created_at_idx"
  ON "assistant_messages"("session_id", "created_at");

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Foreign keys
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "assistant_sessions"
  DROP CONSTRAINT IF EXISTS "assistant_sessions_organization_id_fkey";
ALTER TABLE "assistant_sessions"
  ADD CONSTRAINT "assistant_sessions_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "assistant_sessions"
  DROP CONSTRAINT IF EXISTS "assistant_sessions_user_id_fkey";
ALTER TABLE "assistant_sessions"
  ADD CONSTRAINT "assistant_sessions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "assistant_messages"
  DROP CONSTRAINT IF EXISTS "assistant_messages_session_id_fkey";
ALTER TABLE "assistant_messages"
  ADD CONSTRAINT "assistant_messages_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "assistant_sessions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Feature flag
--
-- Off globally by default, same dark-launch pattern as FORM_APPS/FORM_RULES —
-- ON CONFLICT DO NOTHING so re-running this migration never resets a flag an
-- operator has already toggled.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO "feature_flags" ("key", "name", "description", "is_enabled_globally", "updated_at")
VALUES
  (
    'AI_ASSISTANT',
    'AI assistant',
    'Claude-backed insights, help/guide, and idea-suggestion chat surfaces. Does not gate the existing AI form-generation endpoint.',
    false,
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("key") DO NOTHING;
