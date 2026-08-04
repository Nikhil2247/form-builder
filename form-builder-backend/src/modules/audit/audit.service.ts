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
    organizationId: string;
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
          organizationId: params.organizationId,
          userId: params.userId ?? null,
          action: params.action,
          resource: params.resource,
          resourceId: params.resourceId ?? null,
          metadata: params.metadata ?? null,
          ipAddress: params.ipAddress ?? null,
        },
      })
      .catch((err: any) => {
        // Log but don't throw — audit logging should never break business logic
        console.error('Failed to write audit log:', err);
      });
  }
}
