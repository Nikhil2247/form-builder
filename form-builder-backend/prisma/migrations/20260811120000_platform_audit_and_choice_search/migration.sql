-- ═══════════════════════════════════════════════════════════════════════════
-- Platform-scoped audit entries, and a label index that survives a real list.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Audit entries that belong to no organization ─────────────────────────
--
-- A super admin curating the global choice-list dictionary acts on data every
-- tenant reads but no tenant owns. With `organization_id` NOT NULL the only
-- ways to record that were to attribute it to an unrelated organization or to
-- drop the entry — and dropping it left the platform's most widely-shared
-- reference data with no record of who changed it.
--
-- Widening a column to nullable rewrites no rows and takes only a brief
-- ACCESS EXCLUSIVE lock on the catalog entry, so this is safe on a live table.
ALTER TABLE "audit_logs" ALTER COLUMN "organization_id" DROP NOT NULL;

-- ── 2. Type-ahead search on choice items ────────────────────────────────────
--
-- `choice_items_list_id_label_idx` is a plain B-tree, which serves ordering and
-- prefix matching. The search this feature actually runs is
-- `label ILIKE '%term%'` (Prisma's `contains` + `mode: 'insensitive'`), and a
-- B-tree cannot answer a leading wildcard — so every keystroke against a list
-- of any size degraded to a sequential scan of that list's items. On a district
-- list that is invisible; on the school registry this dictionary exists to
-- hold, it is a full scan of hundreds of thousands of rows per keystroke.
--
-- A GIN trigram index answers the infix match directly. The B-tree stays: it
-- still serves `ORDER BY sort_order, id` and exact lookups, which trigrams do
-- not.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "choice_items_label_trgm_idx"
  ON "choice_items" USING GIN ("label" gin_trgm_ops);

-- The value column is searched the same way by the dictionary's item browser.
CREATE INDEX IF NOT EXISTS "choice_items_value_trgm_idx"
  ON "choice_items" USING GIN ("value" gin_trgm_ops);
