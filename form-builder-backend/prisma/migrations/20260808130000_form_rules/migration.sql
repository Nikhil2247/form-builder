-- Form rules: calculated fields, multi-condition visibility, cross-field
-- validation, conditional requirement.
--
-- Purely additive. Three JSONB columns with defaults; no existing column is
-- touched and no row is rewritten, so this is a metadata-only change on
-- Postgres 11+ (a non-volatile DEFAULT no longer forces a table rewrite).
--
-- Existing forms get an empty rule set and behave exactly as before.

-- ─────────────────────────────────────────────────────────────────────────────
-- Draft rules on the form itself.
--
-- Nullable rather than defaulted: NULL distinguishes "never authored rules"
-- from "authored an empty set", which the builder uses to decide whether to
-- show the rules tab as untouched.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "forms"
  ADD COLUMN IF NOT EXISTS "rules_json" JSONB;

-- ─────────────────────────────────────────────────────────────────────────────
-- Published rules, frozen onto the immutable version.
--
-- NOT NULL with a default, because every version must be answerable about its
-- rules — a NULL here would force every read path to special-case it.
--
--   rules_json      the rules as authored, kept for round-trip editing
--   compiled_rules  the CompiledPlan: calculations in dependency order, the
--                   visibility/require/validate buckets, and the cross-form
--                   references to batch-resolve
--
-- compiled_rules is derived data stored on purpose. Compilation validates
-- operators, resolves field references and topologically sorts calculations;
-- caching the result means the submit path only ever interprets. It also
-- records exactly what was verified at publish time, which recompiling under a
-- later code version would not reproduce.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "form_versions"
  ADD COLUMN IF NOT EXISTS "rules_json" JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "form_versions"
  ADD COLUMN IF NOT EXISTS "compiled_rules" JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Versions published before this migration carry '{}', which readPlan() treats
-- as "no rules" — so historical versions keep validating exactly as they did.
