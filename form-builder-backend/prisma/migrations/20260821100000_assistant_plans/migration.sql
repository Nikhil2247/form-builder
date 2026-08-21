-- AssistantPlan: the "plan, then confirm" split for AI-generated forms/Form
-- Apps — see AI_ASSISTANT_IMPROVEMENT_PLAN.md §3.3(c). `plan_form` /
-- `plan_form_app` write a row here with the full generated content in
-- `payload` and only a short outline shown to the model; `create_from_plan`
-- is the sole path that turns it into real Form/SubjectType/FormApp rows.
--
-- Entirely additive.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AssistantPlanKind') THEN
    CREATE TYPE "AssistantPlanKind" AS ENUM ('FORM', 'FORM_APP');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "assistant_plans" (
  "id"              UUID                 NOT NULL,
  "organization_id" UUID                 NOT NULL,
  "user_id"         UUID                 NOT NULL,
  "kind"            "AssistantPlanKind"  NOT NULL,
  "payload"         JSONB                NOT NULL,
  "outline"         JSONB                NOT NULL,
  "consumed_at"     TIMESTAMP(3),
  "expires_at"      TIMESTAMP(3)         NOT NULL,
  "created_at"      TIMESTAMP(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "assistant_plans_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "assistant_plans_organization_id_user_id_idx"
  ON "assistant_plans"("organization_id", "user_id");

ALTER TABLE "assistant_plans"
  DROP CONSTRAINT IF EXISTS "assistant_plans_organization_id_fkey";
ALTER TABLE "assistant_plans"
  ADD CONSTRAINT "assistant_plans_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "assistant_plans"
  DROP CONSTRAINT IF EXISTS "assistant_plans_user_id_fkey";
ALTER TABLE "assistant_plans"
  ADD CONSTRAINT "assistant_plans_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
