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
  async log(params: {
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
