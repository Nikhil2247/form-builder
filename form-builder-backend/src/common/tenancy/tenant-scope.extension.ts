import { Prisma } from '@prisma/client';
import { getTenant, isUnscoped } from './tenant-context';

/**
 * Prisma extension that refuses to run an unscoped query inside a scoped request.
 *
 * Read `tenant-context.ts` first — it states the problem. This is the part that
 * enforces it.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 * When an ambient tenant context exists (i.e. we are inside a request that has
 * already resolved and authorised an `:orgId`), any query against a model that
 * carries an `organizationId` column MUST constrain it. If it does not, the
 * query throws before reaching the database.
 *
 * ── Why it only fires when a context exists ────────────────────────────────
 * This is the design decision that makes the mechanism shippable rather than an
 * outage.
 *
 * A rule of "every query everywhere must be tenant-scoped" is wrong: the login
 * lookup has no tenant yet, the submission worker resolves the form before it
 * knows the org, health checks touch no tenant data, and seed scripts are
 * cross-tenant by definition. Enforcing globally would mean sprinkling
 * `runUnscoped` across dozens of legitimate paths, and a bypass that common
 * stops being read as a signal.
 *
 * So the assertion is narrow and has, by construction, no false positives: if
 * this request has established that it is operating on org A, then a query that
 * addresses no org at all is a bug — every single time. It cannot be "intended"
 * without saying so via `runUnscoped`.
 *
 * The tradeoff is honest: this does NOT protect code paths that never establish
 * a context. Those are covered by the route-level guards
 * (`tenant-isolation.spec.ts`) and, where it is enabled, by Postgres RLS. Three
 * imperfect layers that fail independently beat one that claims to be complete.
 *
 * ── Two more gaps, stated rather than hidden ───────────────────────────────
 *  • RAW QUERIES ARE INVISIBLE HERE. `$queryRaw` and `$executeRaw` carry no
 *    model name, so nothing below can judge them. Raw SQL touching a
 *    tenant-scoped table must carry its own predicate, and is the one place
 *    where Postgres RLS (prisma/sql/enable_row_level_security.sql) is the only
 *    layer standing.
 *  • NESTED WRITES AND `include`/`select` TRAVERSALS are checked at the top-level
 *    model only. Reading a Form scoped correctly and then following
 *    `include: { submissions: true }` is safe because the relation is already
 *    constrained by the parent row — but a nested `where` on that relation is
 *    not independently verified.
 *
 * ── What counts as "constrained" ───────────────────────────────────────────
 * A literal `organizationId` in `where` (directly, or inside `AND`/`OR`/`NOT`),
 * or a unique-by-id lookup on a model whose row cannot be reached without
 * already holding an id that a scoped query produced. The second case is
 * deliberately NOT allowed by default — see `ID_LOOKUP_IS_SUFFICIENT`.
 */

/**
 * Models with a direct `organizationId` column, derived from schema.prisma.
 *
 * Kept as an explicit list rather than reflected from `Prisma.dmmf` at runtime
 * so that adding an org-scoped model is a conscious act: the new model is
 * unprotected until someone adds it here, and the test below fails loudly to
 * make that visible rather than leaving it silently unguarded.
 */
export const ORG_SCOPED_MODELS = new Set<string>([
  'OrganizationMember',
  'OrganizationInvitation',
  'ApiKey',
  'Form',
  'FormSubmission',
  'AuditLog',
  'IntegrationConfig',
  'SubjectType',
  'Subject',
  'FormApp',
  'FormAppSession',
  'OrganizationFeatureFlag',
  'ChoiceList',
  'ExportJob',
]);

/**
 * `Organization` is scoped by its own primary key rather than by an
 * `organizationId` column, so it needs the tenant predicate checked against a
 * different field name.
 */
const SELF_SCOPED_MODELS = new Set<string>(['Organization']);

/**
 * Operations that read or write rows and therefore must be scoped.
 *
 * `create` is absent on purpose: a create supplies `data`, not `where`, and the
 * value it writes is checked separately below. `upsert` appears because it
 * carries both.
 */
const SCOPED_OPERATIONS = new Set<string>([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'updateMany',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
  'upsert',
]);

/**
 * Operations addressed by a unique key.
 *
 * These are the interesting case. `form.findUnique({ where: { id } })` names a
 * single row by a server-generated uuid, so it cannot be used to enumerate
 * another tenant's data — an attacker must already know the id. But "must
 * already know the id" is exactly the assumption behind every IDOR
 * vulnerability ever written: ids leak through logs, referrers, exports and
 * support tickets, and a bare id lookup is how a tenant reads a neighbour's row
 * when one is handed to them.
 *
 * So these are checked too. Where a genuine id-only lookup is correct — resolving
 * a row you are about to tenant-check yourself — say so with `runUnscoped`.
 */
const UNIQUE_OPERATIONS = new Set<string>([
  'findUnique',
  'findUniqueOrThrow',
  'update',
  'delete',
]);

/**
 * When true, a lookup by primary key alone satisfies the check.
 *
 * Defaults to false (strict). Exposed as an env var because turning it on is the
 * pressure valve if this lands in a large codebase and produces more work than
 * a team can absorb at once — but it materially weakens the guarantee, so it is
 * opt-in and named honestly rather than hidden behind a "compat mode" flag.
 */
const ID_LOOKUP_IS_SUFFICIENT =
  process.env.TENANT_SCOPE_ALLOW_ID_LOOKUP === 'true';

/**
 * What to do on a violation.
 *
 *  throw — reject the query. The correct end state, and the default in test so
 *          CI catches regressions.
 *  warn  — log and allow. The rollout setting: a mis-derived model list should
 *          surface as a log line to triage, not as a production 500 on a path
 *          that was working fine yesterday.
 *
 * Default is `warn` outside test. Flip to `throw` once the logs are clean —
 * that is a deliberate two-step, because the failure mode of getting this wrong
 * is breaking working queries.
 */
type ViolationMode = 'throw' | 'warn';

function violationMode(): ViolationMode {
  const raw = process.env.TENANT_SCOPE_MODE;
  if (raw === 'throw' || raw === 'warn') return raw;
  return process.env.NODE_ENV === 'test' ? 'throw' : 'warn';
}

export class TenantScopeViolationError extends Error {
  constructor(model: string, operation: string, organizationId: string) {
    super(
      `Tenant scope violation: ${model}.${operation}() ran inside a request scoped to ` +
        `organization ${organizationId} without constraining organizationId. ` +
        `Add the tenant predicate, or wrap the call in runUnscoped('<reason>') if it is ` +
        `deliberately cross-tenant.`,
    );
    this.name = 'TenantScopeViolationError';
  }
}

/**
 * Does this `where` clause constrain `field`?
 *
 * Recurses through `AND` / `OR` / `NOT` because a predicate is just as binding
 * when it is nested. `OR` is treated as satisfied if ANY branch mentions the
 * field, which is deliberately lenient: `OR: [{ organizationId: a }, { id: b }]`
 * is not in fact scoped. Catching that properly needs real boolean analysis, and
 * a check that is 95% right and understood beats one that is 99% right and
 * trusted absolutely. The limitation is called out here so nobody assumes
 * otherwise.
 */
export function constrains(where: unknown, field: string): boolean {
  if (!where || typeof where !== 'object') return false;

  const w = where as Record<string, unknown>;

  if (field in w && w[field] !== undefined) return true;

  for (const key of ['AND', 'OR', 'NOT'] as const) {
    const branch = w[key];
    if (!branch) continue;
    const branches = Array.isArray(branch) ? branch : [branch];
    if (branches.some((b) => constrains(b, field))) return true;
  }

  return false;
}

/** The field carrying the tenant on this model, or null if it is not scoped. */
function tenantFieldFor(model: string): string | null {
  if (ORG_SCOPED_MODELS.has(model)) return 'organizationId';
  if (SELF_SCOPED_MODELS.has(model)) return 'id';
  return null;
}

/**
 * The offending value if `data` writes an organizationId other than `expected`,
 * otherwise null.
 *
 * Handles `createMany`'s array form as well as the single-object form. Only
 * literal string values are considered: anything else (a nested `connect`, an
 * undefined, a Prisma expression) is not something this can judge, and guessing
 * would produce exactly the false positives that get a safety check disabled.
 */
export function findTenantMismatch(
  data: unknown,
  expected: string,
): string | null {
  if (!data) return null;

  const rows = Array.isArray(data) ? data : [data];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const value = (row as Record<string, unknown>).organizationId;
    if (typeof value === 'string' && value !== expected) return value;
  }

  return null;
}

/**
 * Apply the configured response to a violation.
 *
 * Centralised so `throw` and `warn` cannot drift apart between the read path
 * and the write path — a check that throws in one place and warns in another
 * for the same class of bug is worse than either, because its behaviour stops
 * being predictable from the config.
 */
function reportViolation<T>(
  mode: ViolationMode,
  log: (message: string) => void,
  error: TenantScopeViolationError,
  warning: string,
  proceed: () => T,
): T {
  if (mode === 'throw') throw error;
  log(`${warning} (allowed, TENANT_SCOPE_MODE=warn)`);
  return proceed();
}

/**
 * Build the extension.
 *
 * Takes a logger callback rather than importing AppLogger, so this file stays
 * free of Nest DI and can be unit-tested as a pure function.
 */
export function tenantScopeExtension(log: (message: string) => void) {
  return Prisma.defineExtension({
    name: 'tenant-scope',
    query: {
      $allModels: {
        // `async` with no `await` is deliberate and must stay. Every path here
        // either returns `query(args)` (already a promise) or throws — and the
        // `async` is what turns that throw into a REJECTED PROMISE rather than a
        // synchronous exception. Prisma calls this inside its own promise chain;
        // a synchronous throw would escape that chain and surface at an
        // unrelated point in the caller's stack, which for a safety check is the
        // difference between "this query was refused" and an unattributable
        // crash.
        // eslint-disable-next-line @typescript-eslint/require-await
        async $allOperations({ model, operation, args, query }: any) {
          const tenant = getTenant();

          // No ambient tenant: worker, seed, login, health check. Nothing to
          // check against — see the rationale at the top of this file.
          if (!tenant || !tenant.organizationId) return query(args);

          // Deliberate, reasoned bypass.
          if (isUnscoped()) return query(args);

          const field = model ? tenantFieldFor(model) : null;
          if (!field) return query(args);

          const isScopedOp = SCOPED_OPERATIONS.has(operation);
          const isUniqueOp = UNIQUE_OPERATIONS.has(operation);

          if (!isScopedOp && !isUniqueOp) {
            // `create` / `createMany`: the tenant lives in `data`, not `where`.
            //
            // The foreign key guarantees the value names a REAL organization —
            // it says nothing about it being the RIGHT one. So the check here is
            // a different question from the read case: not "is it scoped?" but
            // "does it match the tenant this request is already operating in?".
            //
            // Only an explicit mismatch is a violation. An absent organizationId
            // is left alone: plenty of creates legitimately set it via a nested
            // relation connect, and inferring intent from an absent field would
            // manufacture false positives — the one thing this mechanism cannot
            // afford if it is to stay switched on.
            const mismatch = findTenantMismatch(
              args?.data,
              tenant.organizationId,
            );
            if (mismatch) {
              return reportViolation(
                violationMode(),
                log,
                new TenantScopeViolationError(
                  model,
                  operation,
                  tenant.organizationId,
                ),
                `Tenant scope violation: ${model}.${operation}() is writing organizationId=${mismatch} ` +
                  `inside a request scoped to organization ${tenant.organizationId}.`,
                () => query(args),
              );
            }
            return query(args);
          }

          if (isUniqueOp && ID_LOOKUP_IS_SUFFICIENT) return query(args);

          if (constrains(args?.where, field)) return query(args);

          return reportViolation(
            violationMode(),
            log,
            new TenantScopeViolationError(
              model,
              operation,
              tenant.organizationId,
            ),
            `Tenant scope violation: ${model}.${operation}() in a request scoped to ` +
              `organization ${tenant.organizationId} did not constrain ${field}.`,
            () => query(args),
          );
        },
      },
    },
  });
}
