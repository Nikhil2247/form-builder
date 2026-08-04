import {
  Controller, Get, Post, Patch, Param, Query,
  UseGuards, Body,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';

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
  async listOrganizations(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.adminService.listOrganizations(
      parseInt(page ?? '1', 10),
      parseInt(limit ?? '20', 10),
      search,
    );
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
  async listUsers(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.adminService.listUsers(
      parseInt(page ?? '1', 10),
      parseInt(limit ?? '20', 10),
      search,
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // AUDIT LOGS
  // ════════════════════════════════════════════════════════════════════════════

  @Get('audit-logs')
  async getAuditLogs(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('orgId') orgId?: string,
  ) {
    return this.adminService.getAuditLogs(
      parseInt(page ?? '1', 10),
      parseInt(limit ?? '50', 10),
      orgId,
    );
  }
}
