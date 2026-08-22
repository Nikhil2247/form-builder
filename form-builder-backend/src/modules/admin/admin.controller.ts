import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  UseGuards,
  Body,
  Req,
  ParseUUIDPipe,
} from '@nestjs/common';
import type { Request } from 'express';
import { AdminService } from './admin.service';
import { SystemService } from './system.service';
import { AdminUsersService } from './admin-users.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { SuperAdminGuard } from '../../common/auth/super-admin.guard';
import { PaginationQueryDto } from '../../common/http/pagination/pagination-query.dto';
import { AuditLogQueryDto } from '../../common/http/pagination/audit-query.dto';
import { parsePagination } from '../../common/http/pagination/pagination';
import { CreateOrganizationDto } from '../organizations/dto/create-organization.dto';
import { UpdateOrganizationDto } from '../organizations/dto/update-organization.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { AddOrgMemberDto } from './dto/add-org-member.dto';

/**
 * Platform administration endpoints — accessible only by SUPER_ADMIN users.
 *
 * Routes:
 *   /admin/dashboard             — Platform-wide statistics
 *   /admin/organizations         — List/manage all organizations
 *   /admin/users                 — List/manage all users
 *   /admin/audit-logs            — View audit logs (per-org filterable)
 *   /admin/system/*              — Dependency health and infrastructure stats
 *   /admin/users/:userId/*       — Per-user roles, sessions, and security
 */
@Controller('admin')
@UseGuards(JwtAuthGuard, SuperAdminGuard)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly systemService: SystemService,
    private readonly adminUsers: AdminUsersService,
  ) {}

  // ════════════════════════════════════════════════════════════════════════════
  // SYSTEM HEALTH & INFRASTRUCTURE
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Everything the system page needs in one request.
   *
   * Note this describes the POD THAT ANSWERED. Process memory and uptime are
   * per-instance; aggregate figures need a metrics backend, not an API call.
   */
  @Get('system')
  async getSystemOverview() {
    return this.systemService.getOverview();
  }

  /** Dependency probes on their own, for polling without the heavier queries. */
  @Get('system/health')
  async getSystemHealth() {
    return this.systemService.getHealth();
  }

  @Get('system/queues')
  async getQueueStats() {
    return this.systemService.getQueueStats();
  }

  // ════════════════════════════════════════════════════════════════════════════
  // USER ADMINISTRATION
  // ════════════════════════════════════════════════════════════════════════════

  @Post('users')
  async createUser(@Body() dto: CreateUserDto, @Req() req: Request) {
    return this.adminUsers.createUser(dto, (req.user as any).sub);
  }

  @Get('users/:userId')
  async getUserDetail(@Param('userId', new ParseUUIDPipe()) userId: string) {
    return this.adminUsers.getUserDetail(userId);
  }

  /** Platform role. Separate from org roles — see AdminUsersService. */
  @Patch('users/:userId/system-role')
  async setSystemRole(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() body: { systemRole: 'USER' | 'SUPER_ADMIN' },
    @Req() req: Request,
  ) {
    return this.adminUsers.setSystemRole(
      userId,
      body.systemRole,
      (req.user as any).sub,
    );
  }

  /** Role within one organization the user already belongs to. */
  @Patch('users/:userId/organizations/:orgId/role')
  async setOrgRole(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Param('orgId', new ParseUUIDPipe()) orgId: string,
    @Body() body: { role: 'ADMIN' | 'EDITOR' | 'VIEWER' },
    @Req() req: Request,
  ) {
    return this.adminUsers.setOrgRole(
      userId,
      orgId,
      body.role,
      (req.user as any).sub,
    );
  }

  @Post('users/:userId/revoke-sessions')
  async revokeSessions(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Req() req: Request,
  ) {
    return this.adminUsers.revokeSessions(userId, (req.user as any).sub);
  }

  @Patch('users/:userId/suspended')
  async setUserSuspended(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() body: { suspended: boolean },
    @Req() req: Request,
  ) {
    return this.adminUsers.setUserSuspended(
      userId,
      body.suspended === true,
      (req.user as any).sub,
    );
  }

  /** Support path for a user locked out of their authenticator. */
  @Post('users/:userId/reset-mfa')
  async resetMfa(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Req() req: Request,
  ) {
    return this.adminUsers.resetMfa(userId, (req.user as any).sub);
  }

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
    return this.adminService.listOrganizations(
      parsePagination(query),
      query.search,
    );
  }

  @Post('organizations')
  async createOrganization(@Body() dto: CreateOrganizationDto) {
    return this.adminService.createOrganization(dto);
  }

  @Get('organizations/:orgId')
  async getOrganizationDetail(@Param('orgId') orgId: string) {
    return this.adminService.getOrganizationDetail(orgId);
  }

  @Patch('organizations/:orgId')
  async updateOrganization(
    @Param('orgId') orgId: string,
    @Body() dto: UpdateOrganizationDto,
  ) {
    return this.adminService.updateOrganization(orgId, dto);
  }

  @Delete('organizations/:orgId')
  async deleteOrganization(@Param('orgId') orgId: string) {
    return this.adminService.deleteOrganization(orgId);
  }

  @Post('organizations/:orgId/members')
  async addOrganizationMember(
    @Param('orgId') orgId: string,
    @Body() dto: AddOrgMemberDto,
  ) {
    return this.adminService.addOrganizationMember(orgId, dto.email, dto.role);
  }

  @Post('organizations/:orgId/suspend')
  async suspendOrganization(
    @Param('orgId') orgId: string,
    @Body('reason') reason: string,
  ) {
    return this.adminService.suspendOrganization(
      orgId,
      reason ?? 'Suspended by administrator',
    );
  }

  @Post('organizations/:orgId/activate')
  async activateOrganization(@Param('orgId') orgId: string) {
    return this.adminService.activateOrganization(orgId);
  }

  @Patch('organizations/:orgId/quotas')
  async updateOrgQuotas(
    @Param('orgId') orgId: string,
    @Body()
    quotas: {
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
    return this.adminService.getAuditLogs(
      parsePagination(query),
      query.orgId,
      query.action,
    );
  }
}
