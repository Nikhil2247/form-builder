import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MailService } from '../mail/mail.service';

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
} from '../../common/prisma/selects';
import { resolveActiveOrganization } from '../../common/tenancy/active-organization';
import { SessionCacheService } from '../../common/session/session-cache.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_TYPES } from '../notifications/notification-recipients';

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    // Every method below that changes a membership, an active-org pointer, or an
    // organization's activity flags MUST invalidate the affected users' cached
    // sessions. A cached session that still lists a membership the database has
    // dropped is not a stale read — it is a removed member who can still get in.
    private readonly sessions: SessionCacheService,
    private readonly notifications: NotificationsService,
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
   * Every organization the current user belongs to. Drives the org switcher.
   */
  async listMyOrganizations(userId: string) {
    const memberships = await this.prisma.reader.organizationMember.findMany({
      where: { userId },
      include: {
        organization: {
          include: {
            _count: { select: { members: true, forms: true } },
          },
        },
      },
    });

    const user = await this.prisma.reader.user.findUnique({
      where: { id: userId },
      select: { lastActiveOrganizationId: true },
    });

    const { active, usable } = resolveActiveOrganization(
      memberships,
      user?.lastActiveOrganizationId,
    );

    return {
      organizations: usable.map((membership) => ({
        ...membership.organization,
        myRole: membership.role,
        joinedAt: membership.joinedAt,
        isActive: membership.organizationId === active?.organizationId,
      })),
      activeOrganizationId: active?.organizationId ?? null,
    };
  }

  /**
   * The user's currently-active organization.
   *
   * Kept for callers that want a single org rather than the full list. The
   * choice of "which one" is User.lastActiveOrganizationId, not row order.
   */
  async getMyOrganization(userId: string) {
    const memberships = await this.prisma.reader.organizationMember.findMany({
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

    const user = await this.prisma.reader.user.findUnique({
      where: { id: userId },
      select: { lastActiveOrganizationId: true },
    });

    const { active } = resolveActiveOrganization(
      memberships,
      user?.lastActiveOrganizationId,
    );

    if (!active) {
      throw new NotFoundException('You are not a member of any organization.');
    }

    return {
      ...active.organization,
      myRole: active.role,
    };
  }

  /**
   * Switch the user's active workspace.
   *
   * Purely a UI preference: it changes which org the dashboard opens in and
   * nothing else. Membership is still re-checked per request by OrgMemberGuard,
   * so this cannot be used to gain access — but it is verified here anyway so
   * the pointer can never reference an org the user does not belong to.
   */
  async setActiveOrganization(userId: string, orgId: string) {
    const membership = await this.prisma.reader.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId } },
      include: {
        organization: {
          select: { id: true, name: true, isActive: true, suspendedAt: true },
        },
      },
    });

    if (!membership) {
      throw new NotFoundException('You are not a member of this organization.');
    }

    if (
      !membership.organization.isActive ||
      membership.organization.suspendedAt
    ) {
      throw new BadRequestException('This organization has been suspended.');
    }

    await this.prisma.writer.user.update({
      where: { id: userId },
      data: { lastActiveOrganizationId: orgId },
    });

    // `lastActiveOrganizationId` is part of the cached session and feeds
    // resolveActiveOrganization. Skipping this would leave the switcher visibly
    // broken — the user picks a workspace, the next request still reports the
    // old one as active, and the UI snaps back.
    await this.sessions.invalidate(userId);

    return {
      activeOrganizationId: orgId,
      name: membership.organization.name,
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
    const deleted = await this.prisma.writer.organization.update({
      where: { id: orgId },
      data: {
        deletedAt: new Date(),
        isActive: false,
      },
    });

    // Clears `isActive` for every member at once: the flag lives inside each
    // member's cached session, so without this the org is deleted for the
    // database and still open for business for everyone already signed in.
    await this.sessions.invalidateOrganizationMembers(orgId);

    return deleted;
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
  async updateMemberRole(
    orgId: string,
    memberId: string,
    newRole: string,
    actorUserId: string,
  ) {
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

    const updated = await this.prisma.writer.organizationMember.update({
      where: { id: memberId },
      data: { role: newRole as any },
    });

    // A demotion that does not reach the cache is a user who keeps their old
    // permissions — RoleGuard reads the role this guard cached.
    await this.sessions.invalidate(member.userId);

    return updated;
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

    const removed = await this.prisma.writer.organizationMember.delete({
      where: { id: memberId },
    });

    // The one that matters most: an ex-member whose session still lists the
    // membership passes OrgMemberGuard and reads the tenant's data.
    await this.sessions.invalidate(member.userId);

    return removed;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // INVITATION MANAGEMENT
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Create an invitation for a new member.
   * Returns the invite link token (shown once).
   */
  async createInvitation(
    orgId: string,
    email: string,
    role: string,
    invitedById: string,
  ) {
    // Check if user is already a member
    const existingUser = await this.prisma.reader.user.findUnique({
      where: { email: email.toLowerCase() },
      select: { id: true },
    });

    if (existingUser) {
      // Only membership in THIS org blocks the invite. Belonging to other
      // organizations is expected under multi-org — and reporting it would
      // leak one tenant's membership roster to another.
      const existingMembership =
        await this.prisma.reader.organizationMember.findUnique({
          where: {
            organizationId_userId: {
              organizationId: orgId,
              userId: existingUser.id,
            },
          },
        });

      if (existingMembership) {
        throw new ConflictException(
          'This user is already a member of your organization.',
        );
      }
    }

    // Check for existing pending invitation
    const existingInvite =
      await this.prisma.reader.organizationInvitation.findFirst({
        where: {
          organizationId: orgId,
          email: email.toLowerCase(),
          status: 'PENDING',
          expiresAt: { gt: new Date() },
        },
      });

    if (existingInvite) {
      throw new ConflictException(
        'An active invitation already exists for this email.',
      );
    }

    // Check member quota & get org name + inviter details
    const org = await this.prisma.reader.organization.findUnique({
      where: { id: orgId },
      select: {
        name: true,
        maxMembers: true,
        _count: { select: { members: true } },
      },
    });

    if (org && org._count.members >= org.maxMembers) {
      throw new ForbiddenException('Organization member limit reached.');
    }

    const inviter = await this.prisma.reader.user.findUnique({
      where: { id: invitedById },
      select: { firstName: true, lastName: true },
    });
    const inviterName = inviter
      ? `${inviter.firstName} ${inviter.lastName}`
      : 'An administrator';
    const orgName = org?.name ?? 'your organization';

    // Generate invite token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto
      .createHash('sha256')
      .update(rawToken)
      .digest('hex');
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
    const frontendUrl =
      process.env.CORS_ORIGINS?.split(',')[0] || 'http://localhost:3001';
    const inviteUrl = `${frontendUrl}/invite/accept?token=${rawToken}`;

    // Send the email in the background
    this.mailService
      .sendInvitationEmail(email, inviterName, orgName, inviteUrl)
      .catch((err) => console.error('Failed to send invite email:', err));

    return {
      invitationId: invitation.id,
      inviteToken: rawToken, // Shown once — frontend builds the invite URL or user can copy it manually
      expiresAt: invitation.expiresAt,
    };
  }

  /**
   * Read an invitation without consuming it, so the accept screen can name the
   * organization and role the user is agreeing to.
   *
   * Unauthenticated by necessity — the recipient may not have an account yet,
   * and the link has to be meaningful before they sign up. The token is the
   * secret: holding it already implies the right to see these fields, and
   * nothing here is more sensitive than what the invite email said. Returns
   * only display data — never the member roster or org settings.
   */
  async previewInvitation(rawToken: string) {
    const hashedToken = crypto
      .createHash('sha256')
      .update(rawToken)
      .digest('hex');

    const invitation =
      await this.prisma.reader.organizationInvitation.findUnique({
        where: { token: hashedToken },
        select: {
          email: true,
          role: true,
          status: true,
          expiresAt: true,
          organization: {
            select: { name: true, logoUrl: true, isActive: true },
          },
          invitedBy: { select: { firstName: true, lastName: true } },
        },
      });

    if (!invitation) {
      throw new NotFoundException('Invalid invitation link.');
    }

    const isExpired = invitation.expiresAt < new Date();

    return {
      email: invitation.email,
      role: invitation.role,
      organizationName: invitation.organization.name,
      organizationLogoUrl: invitation.organization.logoUrl,
      invitedByName: invitation.invitedBy
        ? `${invitation.invitedBy.firstName} ${invitation.invitedBy.lastName}`.trim()
        : null,
      expiresAt: invitation.expiresAt,
      // Pre-computed so the client renders one honest state rather than
      // re-deriving validity from three fields and getting it subtly wrong.
      isAcceptable:
        invitation.status === 'PENDING' &&
        !isExpired &&
        invitation.organization.isActive,
      status:
        isExpired && invitation.status === 'PENDING'
          ? 'EXPIRED'
          : invitation.status,
    };
  }

  /**
   * Accept an invitation using the raw token.
   * Creates the OrganizationMember record.
   */
  async acceptInvitation(rawToken: string, userId: string) {
    const hashedToken = crypto
      .createHash('sha256')
      .update(rawToken)
      .digest('hex');

    const invitation =
      await this.prisma.reader.organizationInvitation.findUnique({
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
      throw new BadRequestException(
        `This invitation has already been ${invitation.status.toLowerCase()}.`,
      );
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

    // Joining additional organizations is the normal case now — only a
    // duplicate membership in THIS org is a conflict.
    const existingMembership =
      await this.prisma.reader.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId: invitation.organizationId,
            userId,
          },
        },
      });

    if (existingMembership) {
      throw new ConflictException(
        'You are already a member of this organization.',
      );
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

      // Drop the user into the workspace they just joined — accepting an
      // invite and then having to hunt for the new org in a switcher is a
      // confusing first impression.
      await tx.user.update({
        where: { id: userId },
        data: { lastActiveOrganizationId: invitation.organizationId },
      });
    });

    // Two cached fields changed at once — the membership list gained an entry
    // and the active-org pointer moved. Invalidated after the transaction
    // commits, never inside it: clearing the key first would let a concurrent
    // request repopulate it from the pre-commit state and leave the stale copy
    // behind with a full TTL ahead of it.
    await this.sessions.invalidate(userId);

    // Tell the org's admins somebody joined.
    //
    // AFTER the transaction, for the same reason the session invalidation is:
    // a notification about a membership that then failed to commit is a lie the
    // recipient cannot un-see. `notifyOrganization` swallows its own failures,
    // so this cannot turn a successful acceptance into a 500 — accepting an
    // invitation must not fail because Redis hiccuped.
    //
    // `actorUserId` is the joiner, so they are excluded: the person who just
    // clicked "accept" does not need to be told that they accepted. The
    // audience is ADMINs only — member management is `member:view`, and a
    // VIEWER cannot open /team to act on it. That rule lives in
    // notification-recipients.ts and is tested there.
    const joiner = await this.prisma.reader.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true, email: true },
    });
    const joinerName = joiner
      ? `${joiner.firstName ?? ''} ${joiner.lastName ?? ''}`.trim() ||
        joiner.email
      : 'A new member';

    await this.notifications.notifyOrganization({
      organizationId: invitation.organizationId,
      type: NOTIFICATION_TYPES.MEMBER_JOINED,
      title: `${joinerName} joined ${invitation.organization.name}`,
      body: `They accepted their invitation and now have the ${invitation.role} role.`,
      metadata: {
        organizationId: invitation.organizationId,
        userId,
        role: invitation.role,
        href: '/team',
      },
      actorUserId: userId,
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
  async listInvitations(
    orgId: string,
    pagination: Pagination = parsePagination(),
  ) {
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
    const invitation =
      await this.prisma.reader.organizationInvitation.findFirst({
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
