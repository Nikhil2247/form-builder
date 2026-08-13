-- Postgres Row-Level Security — the tenant-isolation backstop.
--
-- Apply with:
--   bunx prisma db execute --file prisma/sql/enable_row_level_security.sql --schema prisma/schema.prisma
--
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  READ THIS BEFORE APPLYING. This script is deliberately NOT part of the  ║
-- ║  migration chain, and it is INERT until step 2 below is also done.       ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- ── What this buys you ─────────────────────────────────────────────────────
-- Three independent layers now guard tenant isolation, and they fail for
-- different reasons, which is the entire point of having three:
--
--   1. Route level  — every `:orgId` route is behind OrgMemberGuard, asserted
--                     structurally by src/common/guards/tenant-isolation.spec.ts.
--                     Fails if someone forgets a guard.
--   2. Query level  — src/common/tenancy/tenant-scope.extension.ts refuses an
--                     unscoped query inside a scoped request.
--                     Fails if someone forgets a where clause.
--   3. THIS FILE    — the database itself refuses to return another tenant's
--                     rows, whatever the application asked for.
--                     Fails only if the DB is compromised or the session
--                     variable is set wrongly — i.e. it survives an application
--                     bug that defeats layers 1 and 2, including SQL injection
--                     through a raw query.
--
-- ── Why it is inert on its own, and what step 2 is ─────────────────────────
-- Every policy below is written as:
--
--     organization_id = current_setting('app.current_organization_id', true)::uuid
--     OR current_setting('app.current_organization_id', true) IS NULL
--     OR current_setting('app.current_organization_id', true) = ''
--
-- The "IS NULL" arm is what keeps this safe to apply to a running system:
-- migrations, seed scripts, the submission worker and the super-admin routes all
-- run with the variable unset, and they keep working untouched.
--
-- It is ALSO what makes the policy do nothing by default, because the
-- application never sets the variable. Applying this file alone gives you the
-- DDL and zero protection. Do not mistake it for a control that is in force.
--
-- STEP 2 — make it real: the application must issue
--     SET LOCAL app.current_organization_id = '<uuid>';
-- on the same connection, inside the same transaction, as every tenant-scoped
-- query. With Prisma that means running those queries inside
-- `$transaction(async (tx) => { await tx.$executeRaw`SET LOCAL ...`; ... })`,
-- because a pooled connection carries no state between queries and `SET` without
-- `LOCAL` would leak one tenant's id onto the next request that borrows the
-- connection — which would be far worse than no RLS at all.
--
-- ── The cost, stated plainly ───────────────────────────────────────────────
-- Step 2 puts every tenant-scoped read inside an interactive transaction. That
-- is a real latency and connection-holding cost on the hot path, and it is why
-- this is a deliberate, measured decision rather than something switched on
-- because it sounds good. Benchmark it against your traffic before committing.
-- If you use PgBouncer, note that interactive transactions require session or
-- transaction pooling mode — statement mode will break.
--
-- ── Ownership caveat ───────────────────────────────────────────────────────
-- A table's owner bypasses RLS unless FORCE is set. This project's Prisma user
-- is typically also the owner, so every table below gets FORCE ROW LEVEL
-- SECURITY. Without it the policies would be silently ignored for the exact
-- role the application connects as.

-- ────────────────────────────────────────────────────────────────────────────
-- Helper: the current tenant, or NULL when unset.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_current_organization_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_organization_id', true), '')::uuid;
$$;

COMMENT ON FUNCTION app_current_organization_id() IS
  'Tenant for the current transaction, from SET LOCAL app.current_organization_id. NULL when unset, which every policy treats as "unscoped work, allow".';

-- ────────────────────────────────────────────────────────────────────────────
-- Tables with a direct organization_id column.
--
-- This list must stay in sync with ORG_SCOPED_MODELS in
-- src/common/tenancy/tenant-scope.extension.ts. That list is itself checked
-- against the Prisma schema by tenant-scope.spec.ts, so the chain is:
--   schema.prisma -> ORG_SCOPED_MODELS (test-enforced) -> this file (manual).
-- The last hop is the weak one. Re-read it whenever you add an org-scoped table.
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
  org_scoped_tables text[] := ARRAY[
    'organization_members',
    'organization_invitations',
    'api_keys',
    'forms',
    'form_submissions',
    'audit_logs',
    'integration_configs',
    'subject_types',
    'subjects',
    'form_apps',
    'form_app_sessions',
    'organization_feature_flags',
    'choice_lists',
    'export_jobs'
  ];
BEGIN
  FOREACH t IN ARRAY org_scoped_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);

    -- Nullable organization_id (form_submissions during backfill, audit_logs for
    -- platform-level events, choice_lists for global reference lists) must stay
    -- readable, or the backfill and the platform surfaces break. A NULL tenant
    -- on the ROW means "belongs to no tenant", which is not the same question as
    -- a NULL tenant in the SESSION.
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING (
          app_current_organization_id() IS NULL
          OR organization_id IS NULL
          OR organization_id = app_current_organization_id()
        )
        WITH CHECK (
          app_current_organization_id() IS NULL
          OR organization_id IS NULL
          OR organization_id = app_current_organization_id()
        )
    $p$, t);
  END LOOP;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- organizations — scoped by its own primary key rather than by a column.
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON organizations;
CREATE POLICY tenant_isolation ON organizations
  USING (
    app_current_organization_id() IS NULL
    OR id = app_current_organization_id()
  )
  WITH CHECK (
    app_current_organization_id() IS NULL
    OR id = app_current_organization_id()
  );

-- ────────────────────────────────────────────────────────────────────────────
-- Tables reachable only through a parent that is itself scoped.
--
-- These have no organization_id of their own, so the policy joins to the owner.
-- A subquery per row is not free; it is accepted here because these tables are
-- not on the highest-volume read paths, and because a child table left
-- unprotected is exactly how a "we have RLS" claim becomes false — reading
-- form_versions directly would otherwise expose every tenant's question text.
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  spec record;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('form_versions',           'form_id',       'forms',            'id'),
      ('form_analytics',          'form_id',       'forms',            'id'),
      ('form_webhooks',           'form_id',       'forms',            'id'),
      ('form_comments',           'form_id',       'forms',            'id'),
      ('form_drafts',             'form_id',       'forms',            'id'),
      ('form_app_steps',          'app_id',        'form_apps',        'id'),
      ('form_app_periods',        'app_id',        'form_apps',        'id'),
      ('choice_items',            'list_id',       'choice_lists',     'id')
    ) AS s(child, fk, parent, parent_key)
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', spec.child);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', spec.child);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', spec.child);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING (
          app_current_organization_id() IS NULL
          OR EXISTS (
            SELECT 1 FROM %I p
             WHERE p.%I = %I.%I
               AND (p.organization_id IS NULL
                    OR p.organization_id = app_current_organization_id())
          )
        )
    $p$, spec.child, spec.parent, spec.parent_key, spec.child, spec.fk);
  END LOOP;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- Verification. Run after applying:
--
--   SELECT relname, relrowsecurity, relforcerowsecurity
--     FROM pg_class
--    WHERE relname IN ('forms','form_submissions','organizations')
--      AND relkind = 'r';
--
-- Then prove it actually bites, which is the only check that means anything:
--
--   BEGIN;
--   SET LOCAL app.current_organization_id = '<org A uuid>';
--   SELECT count(*) FROM forms;                  -- only org A's forms
--   SELECT count(*) FROM forms WHERE organization_id = '<org B uuid>';  -- must be 0
--   ROLLBACK;
--
-- If the second count is non-zero, FORCE did not take effect and you are almost
-- certainly connected as a superuser — superusers bypass RLS unconditionally.
-- Connect as the application role instead.
-- ────────────────────────────────────────────────────────────────────────────
