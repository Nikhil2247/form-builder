import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
  Query,
} from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { InviteMemberDto } from './dto/invite-member.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../../common/guards/org-member.guard';
import { RoleGuard } from '../../common/guards/role.guard';
import { RequiredRole } from '../../common/decorators/roles.decorator';
import { OrgId } from '../../common/decorators/org-id.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Throttle } from '@nestjs/throttler';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';
import { AuditLogQueryDto } from '../../common/pagination/audit-query.dto';
import { parsePagination } from '../../common/pagination/pagination';
import type { Request } from 'express';

/**
 * Organization endpoints — CRUD for org settings, member management, and invitations.
 *
 * Route hierarchy:
 *   /organizations/me              — Get current user's org (no orgId needed)
 *   /organizations/:orgId          — Org CRUD (requires membership)
 *   /organizations/:orgId/members  — Member management
 *   /organizations/:orgId/invitations — Invitation management
 */
@Controller('organizations')
@UseGuards(JwtAuthGuard)
export class OrganizationsController {
  constructor(private readonly orgsService: OrganizationsService) {}

  // ════════════════════════════════════════════════════════════════════════════
  // ORGANIZATION CRUD
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * GET /organizations — Every workspace the caller belongs to.
   * Backs the org switcher; also reports which one is currently active.
   */
  @Get()
  async listMyOrganizations(@Req() req: Request) {
    const userId = (req.user as any).sub;
    return this.orgsService.listMyOrganizations(userId);
  }

  /**
   * GET /organizations/me — The caller's currently-active organization.
   *
   * Declared before :orgId so Nest does not match "me" as an org id.
   */
  @Get('me')
  async getMyOrganization(@Req() req: Request) {
    const userId = (req.user as any).sub;
    return this.orgsService.getMyOrganization(userId);
  }

  /**
   * POST /organizations/:orgId/activate — Switch the active workspace.
   *
   * Guarded like every other :orgId route. The guard is not what makes this
   * safe (the service re-checks membership, and nothing is authorized off the
   * stored pointer) — it is here so the rule "every :orgId route proves
   * membership" holds without exception.
   */
  @Post(':orgId/activate')
  @UseGuards(OrgMemberGuard)
  async setActiveOrganization(@OrgId() orgId: string, @Req() req: Request) {
    const userId = (req.user as any).sub;
    return this.orgsService.setActiveOrganization(userId, orgId);
  }

  /**
   * GET /organizations/:orgId — Get organization details.
   * Any member can view.
   */
  @Get(':orgId')
  @UseGuards(OrgMemberGuard)
  async getOrganization(@OrgId() orgId: string) {
    return this.orgsService.getOrganization(orgId);
  }

  /**
   * PATCH /organizations/:orgId — Update organization settings.
   * Only ADMINs can update.
   */
  @Patch(':orgId')
  @UseGuards(OrgMemberGuard, RoleGuard)
  @RequiredRole('ADMIN')
  async updateOrganization(
    @OrgId() orgId: string,
    @Body() dto: UpdateOrganizationDto,
  ) {
    return this.orgsService.updateOrganization(orgId, dto);
  }

  /**
   * DELETE /organizations/:orgId — Soft-delete the organization.
   * Only ADMINs can delete.
   */
  @Delete(':orgId')
  @UseGuards(OrgMemberGuard, RoleGuard)
  @RequiredRole('ADMIN')
  async deleteOrganization(@OrgId() orgId: string) {
    return this.orgsService.deleteOrganization(orgId);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // MEMBER MANAGEMENT
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * GET /organizations/:orgId/members — List all members.
   * ADMINs can view.
   */
  @Get(':orgId/members')
  @UseGuards(OrgMemberGuard, RoleGuard)
  @RequiredRole('ADMIN')
  async listMembers(
    @OrgId() orgId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.orgsService.listMembers(orgId, parsePagination(query));
  }

  /**
   * PATCH /organizations/:orgId/members/:memberId — Change a member's role.
   * Only ADMINs can change roles.
   */
  @Patch(':orgId/members/:memberId')
  @UseGuards(OrgMemberGuard, RoleGuard)
  @RequiredRole('ADMIN')
  async updateMemberRole(
    @OrgId() orgId: string,
    @Param('memberId') memberId: string,
    @Body() dto: UpdateMemberRoleDto,
    @Req() req: Request,
  ) {
    const actorUserId = (req.user as any).sub;
    return this.orgsService.updateMemberRole(
      orgId,
      memberId,
      dto.role,
      actorUserId,
    );
  }

  /**
   * DELETE /organizations/:orgId/members/:memberId — Remove a member.
   * Only ADMINs can remove.
   */
  @Delete(':orgId/members/:memberId')
  @UseGuards(OrgMemberGuard, RoleGuard)
  @RequiredRole('ADMIN')
  async removeMember(
    @OrgId() orgId: string,
    @Param('memberId') memberId: string,
    @Req() req: Request,
  ) {
    const actorUserId = (req.user as any).sub;
    return this.orgsService.removeMember(orgId, memberId, actorUserId);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // INVITATION MANAGEMENT
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * POST /organizations/:orgId/invitations — Create a new invitation.
   * Only ADMINs can invite.
   */
  @Post(':orgId/invitations')
  @UseGuards(OrgMemberGuard, RoleGuard)
  @RequiredRole('ADMIN')
  async createInvitation(
    @OrgId() orgId: string,
    @Body() dto: InviteMemberDto,
    @Req() req: Request,
  ) {
    const invitedById = (req.user as any).sub;
    return this.orgsService.createInvitation(
      orgId,
      dto.email,
      dto.role ?? 'VIEWER',
      invitedById,
    );
  }

  /**
   * GET /organizations/:orgId/invitations — List all invitations.
   * Only ADMINs can view invitations.
   */
  @Get(':orgId/invitations')
  @UseGuards(OrgMemberGuard, RoleGuard)
  @RequiredRole('ADMIN')
  async listInvitations(
    @OrgId() orgId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.orgsService.listInvitations(orgId, parsePagination(query));
  }

  /**
   * DELETE /organizations/:orgId/invitations/:invitationId — Revoke a pending invitation.
   * Only ADMINs can revoke.
   */
  @Delete(':orgId/invitations/:invitationId')
  @UseGuards(OrgMemberGuard, RoleGuard)
  @RequiredRole('ADMIN')
  async revokeInvitation(
    @OrgId() orgId: string,
    @Param('invitationId') invitationId: string,
  ) {
    return this.orgsService.revokeInvitation(orgId, invitationId);
  }

  /**
   * GET /organizations/invitations/:token — Preview an invitation.
   *
   * Unauthenticated: the recipient may not have an account yet, and the accept
   * screen has to be able to name the organization and role before they sign
   * up. Returns display fields only. The token is the secret.
   */
  @Public()
  @Get('invitations/:token')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async previewInvitation(@Param('token') token: string) {
    return this.orgsService.previewInvitation(token);
  }

  /**
   * POST /organizations/invitations/:token/accept — Accept an invitation.
   * Public (any authenticated user with a valid token can accept).
   * No org membership check needed — that's the point of the invitation.
   */
  @Post('invitations/:token/accept')
  async acceptInvitation(@Param('token') token: string, @Req() req: Request) {
    const userId = (req.user as any).sub;
    return this.orgsService.acceptInvitation(token, userId);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // AUDIT LOGS
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * GET /organizations/:orgId/audit-logs — List audit logs.
   * Only ADMINs can view audit logs.
   */
  @Get(':orgId/audit-logs')
  @UseGuards(OrgMemberGuard, RoleGuard)
  @RequiredRole('ADMIN')
  async getAuditLogs(@OrgId() orgId: string, @Query() query: AuditLogQueryDto) {
    return this.orgsService.getAuditLogs(
      orgId,
      parsePagination(query),
      query.action,
    );
  }
}
