-- Multi-organization membership.
--
-- Until now a user could belong to exactly one organization, enforced by a
-- unique index on organization_members(user_id) alone. That blocked agencies,
-- consultants, contractors, and anyone spanning two departments — and it got
-- more expensive to remove with every service that assumed it.
--
-- This migration is additive and reversible in effect: dropping a uniqueness
-- constraint never invalidates existing rows, because every current user has at
-- most one membership and therefore already satisfies the weaker rule.
--
-- Ordering matters here. The replacement index is created BEFORE the unique one
-- is dropped, so the lookup "all memberships for this user" — which the org
-- switcher and every login now perform — is never left without index support,
-- not even for the duration of this transaction.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Non-unique index on user_id.
--
-- The dropped constraint was doing double duty: enforcing single-org AND
-- serving lookups by user_id. Only the second job is still wanted.
--
-- CREATE INDEX (not CONCURRENTLY) is correct inside a migration transaction.
-- organization_members is small — one row per user per org — so the brief
-- write lock is not worth the complexity of a concurrent build.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "organization_members_user_id_idx"
  ON "organization_members"("user_id");

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Drop the single-org constraint.
--
-- organization_members_organization_id_user_id_key is deliberately left in
-- place: one membership per user per org is still the rule, and it is what
-- makes the upsert-by-(org,user) paths safe.
-- ─────────────────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS "organization_members_user_id_key";

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Track which workspace a session should open in.
--
-- Nullable with no default and no foreign key, all three intentional:
--   • NULL means "no preference yet" — resolution falls back to the earliest
--     membership, so existing sessions behave exactly as before.
--   • No FK, so deleting an organization does not cascade into user rows or
--     require an ON DELETE rule. A pointer to a departed org is harmless: it
--     is always re-verified against live membership before use.
--
-- Adding a nullable column with no default does not rewrite the table.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "last_active_organization_id" UUID;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Backfill from existing memberships.
--
-- Every current user has at most one membership, so this is unambiguous: it
-- simply records the org they were already in. Without it, the first request
-- after deploy would resolve via the fallback path and produce the same answer
-- — this just makes the stored state match reality immediately rather than
-- lazily, which keeps the column meaningful for support and debugging.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE "users" u
SET "last_active_organization_id" = m."organization_id"
FROM "organization_members" m
WHERE m."user_id" = u."id"
  AND u."last_active_organization_id" IS NULL;
