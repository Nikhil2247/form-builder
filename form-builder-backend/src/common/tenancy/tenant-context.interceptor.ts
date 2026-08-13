import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { runWithTenant, type TenantContext } from './tenant-context';

/**
 * Populates the ambient tenant context for the lifetime of one HTTP request.
 *
 * ── Ordering matters, and this is the subtle part ───────────────────────────
 * Nest runs guards BEFORE interceptors. That ordering is what makes this safe:
 * by the time this interceptor runs, `OrgMemberGuard` has already resolved
 * `:orgId`, proven the caller is a member, and written `request.orgId`. So the
 * value read here is one that has been authorised — this interceptor never
 * makes an access decision, it only records a decision already made.
 *
 * Reading `request.params.orgId` directly instead would invert that: the raw URL
 * segment, unverified, becoming the scope every query is checked against. That
 * would turn the tenant guard into something an attacker supplies. Read
 * `request.orgId` (guard output), never `request.params.orgId` (user input).
 *
 * Routes with no `:orgId` — login, public form runner, health — establish no
 * context, and the Prisma extension correspondingly asserts nothing on them.
 * See `tenant-scope.extension.ts` for why that is the intended behaviour rather
 * than a gap.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const request = context.switchToHttp().getRequest<any>();

    // Written by OrgMemberGuard after it has verified membership. Absent on
    // routes that are not org-scoped, and absent on org-scoped routes only if
    // the guard did not run — which `tenant-isolation.spec.ts` makes impossible
    // to ship.
    const organizationId: string | undefined = request?.orgId;
    if (!organizationId) return next.handle();

    const userId: string | undefined = request?.user?.sub;
    const tenant: TenantContext = { organizationId, userId };

    // ── Why this is not simply `runWithTenant(tenant, () => next.handle())` ──
    //
    // That reads correctly and is wrong. `next.handle()` returns a COLD
    // observable: calling it builds a pipeline, it does not execute the route
    // handler. Nest subscribes to the returned observable after every
    // interceptor has returned — by which time the AsyncLocalStorage.run() call
    // above has long since exited and its store has been popped. The handler
    // would then execute with no ambient tenant, the Prisma extension would
    // assert nothing, and the whole mechanism would silently no-op while
    // appearing to work. That is the worst possible failure for a safety check.
    //
    // Wrapping the SUBSCRIPTION is what actually matters: the store must be
    // entered at the moment the handler runs, so every async operation it starts
    // inherits the context.
    return new Observable((subscriber) =>
      runWithTenant(tenant, () => next.handle().subscribe(subscriber)),
    );
  }
}
