import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * AuditService — creates audit log entries for significant actions.
 *
 * This service is injected into other services/interceptors to log
 * mutations (create, update, delete, invite, role changes, etc.).
 *
 * Audit logs are write-only from this service. Reading is done via
 * AdminService (SuperAdmin access only).
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Log an audit event.
   *
   * @param params.organizationId - The org where the action occurred
   * @param params.userId - The user who performed the action (null for system events)
   * @param params.action - Dot-notation action name (e.g., "form.created", "member.invited")
   * @param params.resource - Resource type ("form", "member", "org", "submission")
   * @param params.resourceId - ID of the affected resource
   * @param params.metadata - Additional context (old/new values, etc.)
   * @param params.ipAddress - Actor's IP address
   */
  /**
   * Record an audit entry. Returns `void`, deliberately.
   *
   * ── Why this is not `async` ────────────────────────────────────────────────
   * It used to be, and it awaited nothing: the body starts the insert, attaches
   * its own `.catch()`, and returns. The `async` keyword therefore did nothing
   * except wrap an already-resolved value in a promise — but that promise was
   * enough to make every one of the 46 call sites a
   * `@typescript-eslint/no-floating-promises` error, which is most of the rule's
   * hits in this codebase. Forty-odd `void` operators would have been noise
   * papering over a signature that was lying.
   *
   * Returning `void` states the real contract: this is fire-and-forget, the
   * write happens in the background, and awaiting it would NOT have given you
   * durability — it would have resolved before the row was written either way.
   * A caller that needs the entry persisted before continuing needs a different
   * method, not an `await` on this one.
   *
   * The tradeoff is accepted knowingly: an audit write that fails is logged and
   * dropped rather than failing the business operation that triggered it. That
   * is the existing behaviour and the comment on the `.catch()` below explains
   * why; this change only stops the signature from implying otherwise.
   */
  log(params: {
    /**
     * The tenant this happened in, or `null`/omitted for a PLATFORM action that
     * belongs to no tenant — a super admin editing the global choice-list
     * dictionary, say. Those entries are visible on /platform/audit-logs, which
     * does not filter by organization unless asked to.
     */
    organizationId?: string | null;
    userId?: string;
    action: string;
    resource: string;
    resourceId?: string;
    metadata?: Record<string, any>;
    ipAddress?: string;
  }) {
    // Fire-and-forget — don't block the main operation
    this.prisma.writer.auditLog
      .create({
        data: {
          organizationId: params.organizationId ?? null,
          userId: params.userId ?? null,
          action: params.action,
          resource: params.resource,
          resourceId: params.resourceId ?? null,
          // Prisma distinguishes "SQL NULL" from "JSON null" for Json columns;
          // a bare `null` is not a valid input. Omitting the key leaves the
          // column NULL, which is what we want for "no metadata".
          ...(params.metadata ? { metadata: params.metadata } : {}),
          ipAddress: params.ipAddress ?? null,
        },
      })
      .catch((err: any) => {
        // Log but don't throw — audit logging should never break business logic
        console.error('Failed to write audit log:', err);
      });
  }
}
