-- AlterEnum
-- Backs the new unified `POST .../assistant/messages` route
-- (AI_ASSISTANT_IMPROVEMENT_PLAN.md §3.1/§5 Phase B) — sessions started from
-- it are labeled AUTO rather than reusing one of the three existing modes,
-- even though the tool registry and system prompt are identical.
ALTER TYPE "AssistantMode" ADD VALUE 'AUTO';
