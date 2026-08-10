-- Choice lists.
--
-- A managed set of options a question draws from, replacing the static array
-- that used to live on the question itself. Three things this makes possible
-- that a per-question array cannot:
--
--   1. Reuse — one District list referenced by every form, corrected in one
--      place when a district is renamed or split.
--   2. Cascading selects — District -> Block -> School, via parent_value.
--   3. Auto-fill — extra columns in `metadata` that a CALCULATE rule reads
--      with lookup(), which is how a UDISE code fills itself from a school.
--
-- organization_id NULL means the list is provided by the platform and is
-- visible to every tenant, read-only. India's states and districts ship that
-- way. Anything a customer creates is org-owned and invisible to other orgs.

CREATE TABLE IF NOT EXISTS "choice_lists" (
  "id"              UUID         NOT NULL,
  "organization_id" UUID,
  "name"            VARCHAR(120) NOT NULL,
  "slug"            VARCHAR(60)  NOT NULL,
  "description"     VARCHAR(500),
  "parent_list_id"  UUID,
  "metadata_schema" JSONB        NOT NULL DEFAULT '[]',
  "version"         INTEGER      NOT NULL DEFAULT 1,
  "item_count"      INTEGER      NOT NULL DEFAULT 0,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL,
  "deleted_at"      TIMESTAMP(3),
  CONSTRAINT "choice_lists_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "choice_items" (
  "id"           UUID         NOT NULL,
  "list_id"      UUID         NOT NULL,
  "value"        VARCHAR(120) NOT NULL,
  "label"        VARCHAR(300) NOT NULL,
  "parent_value" VARCHAR(120),
  "metadata"     JSONB        NOT NULL DEFAULT '{}',
  "sort_order"   INTEGER      NOT NULL DEFAULT 0,
  "is_active"    BOOLEAN      NOT NULL DEFAULT true,
  CONSTRAINT "choice_items_pkey" PRIMARY KEY ("id")
);

-- ── Uniqueness ──────────────────────────────────────────────────────────────

-- One slug per org. Postgres treats NULLs as distinct in a unique index, so
-- this constraint does NOT stop two global lists sharing a slug — the partial
-- index below is what does.
CREATE UNIQUE INDEX IF NOT EXISTS "choice_lists_organization_id_slug_key"
  ON "choice_lists"("organization_id", "slug");

-- Global slugs must be unique among themselves. Without this, two seeds could
-- both create `in-districts` and every question bound to it would resolve to
-- whichever row the query happened to return first.
CREATE UNIQUE INDEX IF NOT EXISTS "choice_lists_global_slug_key"
  ON "choice_lists"("slug")
  WHERE "organization_id" IS NULL;

-- The value is the join key between a list and every answer that references it.
CREATE UNIQUE INDEX IF NOT EXISTS "choice_items_list_id_value_key"
  ON "choice_items"("list_id", "value");

-- ── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS "choice_lists_organization_id_deleted_at_idx"
  ON "choice_lists"("organization_id", "deleted_at");

CREATE INDEX IF NOT EXISTS "choice_lists_parent_list_id_idx"
  ON "choice_lists"("parent_list_id");

-- The cascade query: active items of this list under this parent. This is the
-- hot path — it runs every time a respondent picks a district and the block
-- dropdown repopulates.
CREATE INDEX IF NOT EXISTS "choice_items_list_id_parent_value_is_active_idx"
  ON "choice_items"("list_id", "parent_value", "is_active");

-- Type-ahead search. A school registry is too large for a plain <select>, so
-- the runner queries by label prefix instead of downloading the list.
CREATE INDEX IF NOT EXISTS "choice_items_list_id_label_idx"
  ON "choice_items"("list_id", "label");

-- ── Foreign keys ────────────────────────────────────────────────────────────

ALTER TABLE "choice_lists"
  DROP CONSTRAINT IF EXISTS "choice_lists_organization_id_fkey";
ALTER TABLE "choice_lists"
  ADD CONSTRAINT "choice_lists_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL, not CASCADE: deleting a parent list must break the cascade, not
-- silently delete the child list and every question binding that depends on it.
ALTER TABLE "choice_lists"
  DROP CONSTRAINT IF EXISTS "choice_lists_parent_list_id_fkey";
ALTER TABLE "choice_lists"
  ADD CONSTRAINT "choice_lists_parent_list_id_fkey"
  FOREIGN KEY ("parent_list_id") REFERENCES "choice_lists"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "choice_items"
  DROP CONSTRAINT IF EXISTS "choice_items_list_id_fkey";
ALTER TABLE "choice_items"
  ADD CONSTRAINT "choice_items_list_id_fkey"
  FOREIGN KEY ("list_id") REFERENCES "choice_lists"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
