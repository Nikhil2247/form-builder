import { Injectable, NotFoundException, ForbiddenException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import * as crypto from 'crypto';
import {
  parsePagination,
  paginated,
  type Pagination,
} from '../../common/pagination/pagination';
import {
  memberSelect,
  invitationSelect,
  auditLogSelect,
  organizationDetailSelect,
} from '../../common/prisma/selects';

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  /**
   * Generate a URL-safe slug from a string with a random suffix.
   */
  private generateSlug(name: string): string {
    const baseSlug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 100);
    const suffix = crypto.randomBytes(3).toString('hex');
    return `${baseSlug}-${suffix}`;
  }

  // ... (keeping other methods as they are)

  /**
   * Get the organization for the current user.
   * Users belong to exactly one org.
   */
  async getMyOrganization(userId: string) {
    const membership = await this.prisma.reader.organizationMember.findUnique({
      where: { userId },
      include: {
        organization: {
          include: {
            _count: {
              select: {
                members: true,
                forms: true,
              },
            },
          },
        },
      },
    });

    if (!membership) {
      throw new NotFoundException('You are not a member of any organization.');
    }

    return {
      ...membership.organization,
      myRole: membership.role,
    };
  }

  /**
   * Get organization details by ID (for org members).
   */
  async getOrganization(orgId: string) {
    const org = await this.prisma.reader.organization.findUnique({
      where: { id: orgId },
      include: {
        _count: {
          select: {
            members: true,
            forms: true,
          },
        },
      },
    });

    if (!org || org.deletedAt) {
      throw new NotFoundException('Organization not found.');
    }

    return org;
  }

  /**
   * Update organization details. Only ADMINs can do this.
   */
  async updateOrganization(orgId: string, dto: UpdateOrganizationDto) {
    // Check slug uniqueness if changing
    if (dto.slug) {
      const existing = await this.prisma.reader.organization.findUnique({
        where: { slug: dto.slug },
      });
      if (existing && existing.id !== orgId) {
        throw new ConflictException('This slug is already taken.');
      }
    }

    return this.prisma.writer.organization.update({
      where: { id: orgId },
      data: {
        name: dto.name,
        slug: dto.slug,
        logoUrl: dto.logoUrl,
        maxForms: dto.maxForms,
        maxSubmissionsMonth: dto.maxSubmissionsMonth,
        maxMembers: dto.maxMembers,
      },
    });
  }

  /**
   * Soft-delete an organization. Only ADMINs can do this.
   * All members are removed and the org becomes inaccessible.
   */
  async deleteOrganization(orgId: string) {
    return this.prisma.writer.organization.update({
      where: { id: orgId },
      data: {
        deletedAt: new Date(),
        isActive: false,
      },
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MEMBER MANAGEMENT
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * List all members of an organization with their roles and user info.
   */
  async listMembers(orgId: string, pagination: Pagination = parsePagination()) {
    const where = { organizationId: orgId };

    const [members, total] = await Promise.all([
      this.prisma.reader.organizationMember.findMany({
        where,
        select: memberSelect,
        // `id` breaks ties on joinedAt — two members created in the same
        // transaction share a timestamp and could otherwise swap between pages.
        orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.reader.organizationMember.count({ where }),
    ]);

    return paginated('members', members, pagination, total);
  }

  /**
   * Change a member's role within the organization.
   * Cannot demote the last ADMIN.
   */
  async updateMemberRole(orgId: string, memberId: string, newRole: string, actorUserId: string) {
    const member = await this.prisma.reader.organizationMember.findFirst({
      where: { id: memberId, organizationId: orgId },
    });

    if (!member) {
      throw new NotFoundException('Member not found in this organization.');
    }

    // Prevent self-demotion (optional safety)
    if (member.userId === actorUserId && newRole !== 'ADMIN') {
      // Check if there are other admins
      const adminCount = await this.prisma.reader.organizationMember.count({
        where: { organizationId: orgId, role: 'ADMIN' },
      });

      if (adminCount <= 1) {
        throw new BadRequestException(
          'Cannot change your own role. You are the last ADMIN of this organization.',
        );
      }
    }

    return this.prisma.writer.organizationMember.update({
      where: { id: memberId },
      data: { role: newRole as any },
    });
  }

  /**
   * Remove a member from the organization.
   * Cannot remove the last ADMIN.
   */
  async removeMember(orgId: string, memberId: string, actorUserId: string) {
    const member = await this.prisma.reader.organizationMember.findFirst({
      where: { id: memberId, organizationId: orgId },
    });

    if (!member) {
      throw new NotFoundException('Member not found in this organization.');
    }

    // Prevent removing yourself if you're the last admin
    if (member.userId === actorUserId) {
      const adminCount = await this.prisma.reader.organizationMember.count({
        where: { organizationId: orgId, role: 'ADMIN' },
      });

      if (adminCount <= 1 && member.role === 'ADMIN') {
        throw new BadRequestException(
          'Cannot remove yourself. You are the last ADMIN. Transfer admin role first.',
        );
      }
    }

    return this.prisma.writer.organizationMember.delete({
      where: { id: memberId },
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // INVITATION MANAGEMENT
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Create an invitation for a new member.
   * Returns the invite link token (shown once).
   */
  async createInvitation(orgId: string, email: string, role: string, invitedById: string) {
    // Check if user is already a member
    const existingUser = await this.prisma.reader.user.findUnique({
      where: { email: email.toLowerCase() },
      select: { id: true },
    });

    if (existingUser) {
      const existingMembership = await this.prisma.reader.organizationMember.findUnique({
        where: { userId: existingUser.id },
      });

      if (existingMembership) {
        if (existingMembership.organizationId === orgId) {
          throw new ConflictException('This user is already a member of your organization.');
        }
        throw new ConflictException('This user already belongs to another organization.');
      }
    }

    // Check for existing pending invitation
    const existingInvite = await this.prisma.reader.organizationInvitation.findFirst({
      where: {
        organizationId: orgId,
        email: email.toLowerCase(),
        status: 'PENDING',
        expiresAt: { gt: new Date() },
      },
    });

    if (existingInvite) {
      throw new ConflictException('An active invitation already exists for this email.');
    }

    // Check member quota & get org name + inviter details
    const org = await this.prisma.reader.organization.findUnique({
      where: { id: orgId },
      select: { name: true, maxMembers: true, _count: { select: { members: true } } },
    });

    if (org && org._count.members >= org.maxMembers) {
      throw new ForbiddenException('Organization member limit reached.');
    }

    const inviter = await this.prisma.reader.user.findUnique({
      where: { id: invitedById },
      select: { firstName: true, lastName: true },
    });
    const inviterName = inviter ? `${inviter.firstName} ${inviter.lastName}` : 'An administrator';
    const orgName = org?.name ?? 'your organization';

    // Generate invite token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7-day expiry

    const invitation = await this.prisma.writer.organizationInvitation.create({
      data: {
        organizationId: orgId,
        email: email.toLowerCase(),
        role: role as any,
        token: hashedToken,
        invitedById,
        expiresAt,
      },
    });

    // Determine the frontend base URL (you might want this in env config)
    const frontendUrl = process.env.CORS_ORIGINS?.split(',')[0] || 'http://localhost:3001';
    const inviteUrl = `${frontendUrl}/invite/accept?token=${rawToken}`;

    // Send the email in the background
    this.mailService.sendInvitationEmail(email, inviterName, orgName, inviteUrl)
      .catch(err => console.error('Failed to send invite email:', err));

    return {
      invitationId: invitation.id,
      inviteToken: rawToken, // Shown once — frontend builds the invite URL or user can copy it manually
      expiresAt: invitation.expiresAt,
    };
  }

  /**
   * Accept an invitation using the raw token.
   * Creates the OrganizationMember record.
   */
  async acceptInvitation(rawToken: string, userId: string) {
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

    const invitation = await this.prisma.reader.organizationInvitation.findUnique({
      where: { token: hashedToken },
      include: {
        organization: {
          select: { id: true, name: true, isActive: true },
        },
      },
    });

    if (!invitation) {
      throw new NotFoundException('Invalid invitation token.');
    }

    if (invitation.status !== 'PENDING') {
      throw new BadRequestException(`This invitation has already been ${invitation.status.toLowerCase()}.`);
    }

    if (invitation.expiresAt < new Date()) {
      // Mark as expired
      await this.prisma.writer.organizationInvitation.update({
        where: { id: invitation.id },
        data: { status: 'EXPIRED' },
      });
      throw new BadRequestException('This invitation has expired.');
    }

    if (!invitation.organization.isActive) {
      throw new BadRequestException('This organization is no longer active.');
    }

    // Check if user already belongs to an org
    const existingMembership = await this.prisma.reader.organizationMember.findUnique({
      where: { userId },
    });

    if (existingMembership) {
      throw new ConflictException('You already belong to an organization. Leave your current org first.');
    }

    // Transaction: create membership + update invitation
    await this.prisma.writer.$transaction(async (tx: any) => {
      await tx.organizationMember.create({
        data: {
          organizationId: invitation.organizationId,
          userId,
          role: invitation.role,
          invitedById: invitation.invitedById,
        },
      });

      await tx.organizationInvitation.update({
        where: { id: invitation.id },
        data: { status: 'ACCEPTED', acceptedAt: new Date() },
      });
    });

    return {
      message: 'Invitation accepted successfully.',
      organization: {
        id: invitation.organization.id,
        name: invitation.organization.name,
      },
      role: invitation.role,
    };
  }

  /**
   * List all invitations for an organization.
   */
  async listInvitations(orgId: string, pagination: Pagination = parsePagination()) {
    const where = { organizationId: orgId };

    const [invitations, total] = await Promise.all([
      this.prisma.reader.organizationInvitation.findMany({
        where,
        // Never selects `token`: it is the bearer credential that accepts the
        // invitation, and the previous `include` returned it to every admin
        // listing the page — and to anything logging that response.
        select: invitationSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.reader.organizationInvitation.count({ where }),
    ]);

    return paginated('invitations', invitations, pagination, total);
  }

  /**
   * Revoke a pending invitation.
   */
  async revokeInvitation(orgId: string, invitationId: string) {
    const invitation = await this.prisma.reader.organizationInvitation.findFirst({
      where: { id: invitationId, organizationId: orgId, status: 'PENDING' },
    });

    if (!invitation) {
      throw new NotFoundException('Pending invitation not found.');
    }

    return this.prisma.writer.organizationInvitation.update({
      where: { id: invitationId },
      data: { status: 'REVOKED' },
    });
  }

  /**
   * Get audit logs for the organization.
   */
  async getAuditLogs(
    orgId: string,
    pagination: Pagination = parsePagination(),
    action?: string,
  ) {
    const where: any = { organizationId: orgId };
    if (action) where.action = action;

    const [logs, total] = await Promise.all([
      this.prisma.reader.auditLog.findMany({
        where,
        // Joins the actor. `userId` was stored but had no relation, so the UI
        // could only ever show a bare UUID for who did what.
        select: auditLogSelect,
        skip: pagination.skip,
        take: pagination.take,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      }),
      this.prisma.reader.auditLog.count({ where }),
    ]);

    return paginated('logs', logs, pagination, total);
  }
}
