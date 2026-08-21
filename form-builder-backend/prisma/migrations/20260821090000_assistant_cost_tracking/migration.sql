-- Assistant cost tracking: adds the two usage columns needed to see prompt-
-- cache writes and per-message cost, neither of which the original
-- assistant_foundation migration captured (cache_read_tokens was recorded,
-- but nothing distinguished "no cache writes happened" from "writes
-- happened, reads just haven't landed yet" — see
-- AI_ASSISTANT_IMPROVEMENT_PLAN.md §2.1 C2 / §3.8).
--
-- Entirely additive, both columns nullable — no backfill needed since no
-- historical row ever had this data to backfill from.

ALTER TABLE "assistant_messages"
  ADD COLUMN IF NOT EXISTS "cache_creation_tokens" INTEGER,
  ADD COLUMN IF NOT EXISTS "cost_usd" DECIMAL(10, 6);
