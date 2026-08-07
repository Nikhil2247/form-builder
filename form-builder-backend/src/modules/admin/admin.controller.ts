import {
  Controller, Get, Post, Patch, Param, Query,
  UseGuards, Body,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';
import { AuditLogQueryDto } from '../../common/pagination/audit-query.dto';
import { parsePagination } from '../../common/pagination/pagination';

/**
 * Platform administration endpoints — accessible only by SUPER_ADMIN users.
 *
 * Routes:
 *   /admin/dashboard             — Platform-wide statistics
 *   /admin/organizations         — List/manage all organizations
 *   /admin/users                 — List/manage all users
 *   /admin/audit-logs            — View audit logs (per-org filterable)
 */
@Controller('admin')
@UseGuards(JwtAuthGuard, SuperAdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // ════════════════════════════════════════════════════════════════════════════
  // DASHBOARD
  // ════════════════════════════════════════════════════════════════════════════

  @Get('dashboard')
  async getDashboard() {
    return this.adminService.getDashboard();
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ORGANIZATION MANAGEMENT
  // ════════════════════════════════════════════════════════════════════════════

  @Get('organizations')
  async listOrganizations(@Query() query: PaginationQueryDto) {
    return this.adminService.listOrganizations(parsePagination(query), query.search);
  }

  @Get('organizations/:orgId')
  async getOrganizationDetail(@Param('orgId') orgId: string) {
    return this.adminService.getOrganizationDetail(orgId);
  }

  @Post('organizations/:orgId/suspend')
  async suspendOrganization(
    @Param('orgId') orgId: string,
    @Body('reason') reason: string,
  ) {
    return this.adminService.suspendOrganization(orgId, reason ?? 'Suspended by administrator');
  }

  @Post('organizations/:orgId/activate')
  async activateOrganization(@Param('orgId') orgId: string) {
    return this.adminService.activateOrganization(orgId);
  }

  @Patch('organizations/:orgId/quotas')
  async updateOrgQuotas(
    @Param('orgId') orgId: string,
    @Body() quotas: {
      maxForms?: number;
      maxSubmissionsMonth?: number;
      maxMembers?: number;
      storageQuotaBytes?: string; // BigInt passed as string from JSON
    },
  ) {
    const parsed: any = { ...quotas };
    if (quotas.storageQuotaBytes) {
      parsed.storageQuotaBytes = BigInt(quotas.storageQuotaBytes);
    }
    return this.adminService.updateOrgQuotas(orgId, parsed);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // USER MANAGEMENT
  // ════════════════════════════════════════════════════════════════════════════

  @Get('users')
  async listUsers(@Query() query: PaginationQueryDto) {
    return this.adminService.listUsers(parsePagination(query), query.search);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // AUDIT LOGS
  // ════════════════════════════════════════════════════════════════════════════

  @Get('audit-logs')
  async getAuditLogs(@Query() query: AuditLogQueryDto) {
    return this.adminService.getAuditLogs(parsePagination(query), query.orgId, query.action);
  }
}
