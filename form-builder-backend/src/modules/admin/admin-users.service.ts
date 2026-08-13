import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SessionCacheService } from '../../common/session/session-cache.service';

/**
 * Platform-level user administration.
 *
 * Two separate axes, and conflating them is the mistake this file exists to
 * avoid:
 *
 *   systemRole  SUPER_ADMIN | USER — platform-wide. Governs /platform/*.
 *   OrgRole     ADMIN | EDITOR | VIEWER — per membership. Governs everything else.
 *
 * A SUPER_ADMIN is NOT automatically an org admin, and an org admin has no
 * platform access. A super-admin who wants access to one organization's data
 * must be given a membership there, which is visible in the audit log — rather
 * than it being an invisible side effect of the platform role.
 */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sessions: SessionCacheService,
  ) {}

  /** Full profile: memberships with roles, session count, security posture. */
  async getUserDetail(userId: string) {
    const user = await this.prisma.reader.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        systemRole: true,
        emailVerified: true,
        mfaEnabled: true,
        deletedAt: true,
        createdAt: true,
        updatedAt: true,
        lastActiveOrganizationId: true,
        memberships: {
          select: {
            id: true,
            role: true,
            joinedAt: true,
            organization: {
              select: {
                id: true,
                name: true,
                slug: true,
                isActive: true,
                suspendedAt: true,
              },
            },
          },
          orderBy: { joinedAt: 'asc' },
        },
      },
    });

    if (!user) throw new NotFoundException('User not found.');

    const [activeSessions, recoveryCodesRemaining, formsCreated] =
      await Promise.all([
        this.prisma.reader.refreshToken.count({
          where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
        }),
        this.prisma.reader.mfaRecoveryCode.count({
          where: { userId, usedAt: null },
        }),
        this.prisma.reader.form.count({
          where: { createdById: userId, deletedAt: null },
        }),
      ]);

    return {
      ...user,
      security: {
        mfaEnabled: user.mfaEnabled,
        recoveryCodesRemaining,
        activeSessions,
        emailVerified: user.emailVerified,
      },
      activity: { formsCreated },
    };
  }

  /**
   * Change a user's platform role.
   *
   * Guarded against the two ways an operator can lock everyone out:
   * demoting themselves, and removing the last super-admin. Both are
   * unrecoverable through the UI — the only fix is a manual database edit.
   */
  async setSystemRole(
    userId: string,
    systemRole: 'USER' | 'SUPER_ADMIN',
    actingUserId: string,
  ) {
    if (userId === actingUserId && systemRole !== 'SUPER_ADMIN') {
      throw new ForbiddenException(
        'You cannot remove your own platform admin access. Ask another super admin to do it.',
      );
    }

    const user = await this.prisma.reader.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, systemRole: true },
    });
    if (!user) throw new NotFoundException('User not found.');

    if (user.systemRole === 'SUPER_ADMIN' && systemRole === 'USER') {
      const remaining = await this.prisma.reader.user.count({
        where: {
          systemRole: 'SUPER_ADMIN',
          deletedAt: null,
          id: { not: userId },
        },
      });
      if (remaining === 0) {
        throw new BadRequestException(
          'This is the only platform admin. Promote someone else before demoting this account.',
        );
      }
    }

    const updated = await this.prisma.writer.user.update({
      where: { id: userId },
      data: { systemRole },
      select: { id: true, email: true, systemRole: true },
    });

    // `systemRole` is cached, and it is what OrgMemberGuard's SUPER_ADMIN bypass
    // keys off. A demotion that does not reach the cache leaves platform-wide
    // access to every tenant standing — the single most consequential entry on
    // the invalidation list.
    await this.sessions.invalidate(userId);

    this.audit.log({
      organizationId: null,
      userId: actingUserId,
      action:
        systemRole === 'SUPER_ADMIN'
          ? 'user.promoted_super_admin'
          : 'user.demoted_to_user',
      resource: 'user',
      resourceId: userId,
      metadata: { email: user.email, from: user.systemRole, to: systemRole },
    });

    return updated;
  }

  /**
   * Change what a user can do inside one organization.
   *
   * Refuses to remove the last ADMIN of an org — otherwise nobody can manage
   * members, and the organization becomes unadministrable from inside.
   */
  async setOrgRole(
    userId: string,
    organizationId: string,
    role: 'ADMIN' | 'EDITOR' | 'VIEWER',
    actingUserId: string,
  ) {
    const membership = await this.prisma.reader.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { id: true, role: true },
    });
    if (!membership)
      throw new NotFoundException(
        'This user is not a member of that organization.',
      );

    if (membership.role === 'ADMIN' && role !== 'ADMIN') {
      const otherAdmins = await this.prisma.reader.organizationMember.count({
        where: { organizationId, role: 'ADMIN', userId: { not: userId } },
      });
      if (otherAdmins === 0) {
        throw new BadRequestException(
          'This is the organization’s only admin. Promote someone else first.',
        );
      }
    }

    const updated = await this.prisma.writer.organizationMember.update({
      where: { id: membership.id },
      data: { role },
      select: { id: true, role: true, organizationId: true, userId: true },
    });

    // Same cached field OrganizationsService.updateMemberRole invalidates; this
    // is the platform-admin route to the identical change.
    await this.sessions.invalidate(userId);

    this.audit.log({
      organizationId,
      userId: actingUserId,
      action: 'member.role_changed',
      resource: 'member',
      resourceId: membership.id,
      metadata: {
        targetUserId: userId,
        from: membership.role,
        to: role,
        via: 'platform-admin',
      },
    });

    return updated;
  }

  /**
   * Sign a user out of every device.
   *
   * Revokes refresh tokens only. Access tokens are stateless and live up to
   * their TTL (15 minutes by default), so this is not instantaneous — say so
   * rather than implying the session is severed the moment the button is
   * pressed.
   */
  async revokeSessions(userId: string, actingUserId: string) {
    const user = await this.prisma.reader.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });
    if (!user) throw new NotFoundException('User not found.');

    // ADMIN_REVOKED, not a bare revocation: when this user next presents one of
    // these tokens the refresh path treats it as a replay and burns the family,
    // and the audit trail needs to show that the family was already dead by an
    // operator's hand rather than that a credential leaked.
    const { count } = await this.prisma.writer.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'ADMIN_REVOKED' },
    });

    this.audit.log({
      organizationId: null,
      userId: actingUserId,
      action: 'user.sessions_revoked',
      resource: 'user',
      resourceId: userId,
      metadata: { email: user.email, sessionsRevoked: count },
    });

    return {
      sessionsRevoked: count,
      message:
        count === 0
          ? 'This user had no active sessions.'
          : `Revoked ${count} session(s). Existing access tokens remain valid until they expire (up to 15 minutes).`,
    };
  }

  /**
   * Suspend or restore an account.
   *
   * Soft delete: `deletedAt` blocks login (JwtStrategy and login both reject a
   * deleted user) while every form they authored and every audit entry naming
   * them survives. A hard delete would rewrite history.
   */
  async setUserSuspended(
    userId: string,
    suspended: boolean,
    actingUserId: string,
  ) {
    if (userId === actingUserId && suspended) {
      throw new ForbiddenException('You cannot suspend your own account.');
    }

    const user = await this.prisma.reader.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, systemRole: true, deletedAt: true },
    });
    if (!user) throw new NotFoundException('User not found.');

    if (suspended && user.systemRole === 'SUPER_ADMIN') {
      const remaining = await this.prisma.reader.user.count({
        where: {
          systemRole: 'SUPER_ADMIN',
          deletedAt: null,
          id: { not: userId },
        },
      });
      if (remaining === 0) {
        throw new BadRequestException(
          'This is the only active platform admin.',
        );
      }
    }

    const updated = await this.prisma.writer.user.update({
      where: { id: userId },
      data: { deletedAt: suspended ? new Date() : null },
      select: { id: true, email: true, deletedAt: true },
    });

    // A suspended user holding a valid refresh token could otherwise keep
    // rotating it; suspension has to end the sessions too.
    if (suspended) {
      await this.prisma.writer.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'ADMIN_REVOKED' },
      });
    }

    // `deletedAt` is the field JwtStrategy rejects on, and it is cached. Both
    // directions need this: without it a suspension does not bite until the TTL
    // expires, and a reinstatement leaves the user locked out just as long.
    await this.sessions.invalidate(userId);

    this.audit.log({
      organizationId: null,
      userId: actingUserId,
      action: suspended ? 'user.suspended' : 'user.reinstated',
      resource: 'user',
      resourceId: userId,
      metadata: { email: user.email },
    });

    return updated;
  }

  /**
   * Turn off MFA for a locked-out user.
   *
   * The support path for a lost authenticator with no recovery codes left.
   * Deliberately does not reveal or reset the secret — it clears it, so the
   * user re-enrols from scratch on next sign-in.
   */
  async resetMfa(userId: string, actingUserId: string) {
    const user = await this.prisma.reader.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, mfaEnabled: true },
    });
    if (!user) throw new NotFoundException('User not found.');
    if (!user.mfaEnabled)
      throw new BadRequestException('This account does not have MFA enabled.');

    await this.prisma.writer.$transaction(async (tx: any) => {
      await tx.user.update({
        where: { id: userId },
        data: { mfaEnabled: false, mfaSecret: null },
      });
      // Codes belong to the secret being removed; leaving them would let an
      // old printout unlock a future enrolment.
      await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
    });

    this.audit.log({
      organizationId: null,
      userId: actingUserId,
      action: 'user.mfa_reset',
      resource: 'user',
      resourceId: userId,
      metadata: { email: user.email },
    });

    return {
      message:
        'Two-factor authentication has been removed. The user can enrol again.',
    };
  }
}
