import { AsyncLocalStorage } from 'async_hooks';

/**
 * Ambient tenant context for the duration of one request (or one queue job).
 *
 * ── The problem this exists for ─────────────────────────────────────────────
 * Every org-scoped service in this codebase hand-writes its own tenant
 * predicate:
 *
 *   this.prisma.reader.form.findMany({ where: { organizationId: orgId, ... } })
 *
 * That is correct everywhere it appears, and it is correct only because a human
 * remembered. There are hundreds of such call sites and the number grows with
 * every feature. A single omission — one `findMany` that filters on `status`
 * but not on `organizationId` — is a cross-tenant data leak that no type checker
 * catches, no code reviewer reliably spots, and no unit test of the service
 * would fail on, because the service returns exactly what it was asked for.
 *
 * `tenant-isolation.spec.ts` already covers the *route* half of this: every
 * `:orgId` route proves membership. This covers the *query* half: once a request
 * has established which tenant it belongs to, no query issued underneath it may
 * quietly address a different one.
 *
 * ── Why AsyncLocalStorage ───────────────────────────────────────────────────
 * The alternative is threading an org id through every service method signature
 * down to the Prisma call. That is the same "remember to pass it" problem in a
 * different costume, and it cannot cover code reached indirectly (an event
 * handler, a lazily-evaluated generator, a cache warmer). ALS propagates through
 * every await in the async call tree without being passed, which is precisely
 * the property needed: the enforcement cannot be forgotten because nothing has
 * to remember it.
 *
 * ── What this is NOT ────────────────────────────────────────────────────────
 * It is NOT authorization. The org id lands here from the URL after
 * `OrgMemberGuard` has already proven membership. Reading it grants nothing;
 * it is a consistency check on queries, not a decision about access. Authorization
 * remains where it is: JwtAuthGuard + OrgMemberGuard + RoleGuard.
 *
 * See `tenant-scope.extension.ts` for the Prisma extension that consumes this.
 */

export interface TenantContext {
  /** The organization this unit of work is scoped to. */
  organizationId: string;
  /**
   * The authenticated user, when there is one. Present for requests, absent for
   * queue jobs that act on a tenant's data without a user behind them.
   */
  userId?: string;
  /**
   * Set by `runUnscoped`. While true the Prisma extension stops asserting, so a
   * deliberate cross-tenant read (super-admin, platform reporting) is possible
   * without disabling the mechanism globally.
   */
  unscoped?: boolean;
  /** Why the scope was lifted. Required by `runUnscoped`, logged on use. */
  unscopedReason?: string;
}

const storage = new AsyncLocalStorage<TenantContext>();

/**
 * Run `fn` with `context` as the ambient tenant for everything it awaits.
 *
 * Nesting is allowed and the innermost context wins — that is what makes
 * `runUnscoped` work as a narrow, lexically-obvious hole rather than a flag
 * someone sets and forgets to unset.
 */
export function runWithTenant<T>(context: TenantContext, fn: () => T): T {
  return storage.run(context, fn);
}

/** The ambient tenant, or undefined outside any request (workers, seeds, CLI). */
export function getTenant(): TenantContext | undefined {
  return storage.getStore();
}

/**
 * The ambient organization id, or undefined.
 *
 * Deliberately returns undefined rather than throwing. Plenty of legitimate work
 * runs with no tenant at all — the login route, the health check, a seed script,
 * a queue job that has not resolved its form yet — and a getter that throws
 * would force every one of them to care.
 */
export function getTenantId(): string | undefined {
  return storage.getStore()?.organizationId;
}

/**
 * Deliberately step outside tenant scoping for one narrow operation.
 *
 * The `reason` is mandatory and is not decoration: it is what a reviewer reads
 * when deciding whether this particular hole is justified, and what shows up in
 * logs when someone asks why a cross-tenant query ran. Grep for `runUnscoped`
 * to enumerate every place tenant scoping is bypassed — that list should stay
 * short enough to read in one sitting.
 *
 * Legitimate uses: super-admin platform routes, cross-tenant reporting,
 * migrations and backfills. Not a way to silence an assertion you did not
 * understand.
 */
export function runUnscoped<T>(reason: string, fn: () => T): T {
  const current = storage.getStore();
  return storage.run(
    {
      // Preserve the surrounding identity so audit logging still knows who did
      // this. Only the enforcement is lifted, never the attribution.
      organizationId: current?.organizationId ?? '',
      userId: current?.userId,
      unscoped: true,
      unscopedReason: reason,
    },
    fn,
  );
}

/** True when the current context has deliberately opted out of scope checks. */
export function isUnscoped(): boolean {
  return storage.getStore()?.unscoped === true;
}
