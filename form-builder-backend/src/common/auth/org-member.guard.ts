import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../infra/prisma/prisma.service';
import { AppLogger } from '../observability/logger/app-logger.service';
import { SessionCacheService } from '../infra/session/session-cache.service';

/**
 * OrgMemberGuard — validates that the authenticated user is a member
 * of the organization specified in the route parameter `:orgId`.
 *
 * Usage:
 *   @UseGuards(JwtAuthGuard, OrgMemberGuard)
 *
 * This guard:
 *  1. Reads the orgId from route params
 *  2. Finds the (userId, orgId) membership in the cached session
 *  3. Attaches the membership (with role) to request.orgMembership
 *  4. Also attaches request.orgId for convenience
 *  5. Rejects with 403 if the user is not a member
 *
 * SUPER_ADMIN BYPASS: If the user has systemRole === 'SUPER_ADMIN',
 * they are allowed access to any organization without a membership record.
 *
 * ── Why step 2 no longer queries ──────────────────────────────────────────────
 * It used to. JwtStrategy had, moments earlier in the same request, loaded this
 * user together with every one of their memberships — and this guard then went
 * back to Postgres for one of the rows it had just been given, because the two
 * ran in different components with no channel between them. Both now read the
 * same SessionCacheService entry, so the membership check costs nothing beyond
 * the lookup the request had already performed. The authorization logic below is
 * unchanged: same membership, same suspension check, same 403s.
 */
@Injectable()
export class OrgMemberGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionCacheService,
    private readonly logger: AppLogger,
  ) {
    this.logger.setContext(OrgMemberGuard.name);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Authentication required.');
    }

    // Extract orgId from route params
    const orgId = request.params.orgId;
    if (!orgId) {
      throw new ForbiddenException(
        'Organization ID is required in route parameters.',
      );
    }

    // SUPER_ADMIN bypass — can access any org
    if (user.systemRole === 'SUPER_ADMIN') {
      // Verify the org exists.
      //
      // THIS ONE STAYS A QUERY, deliberately. The session cache is keyed by user
      // and holds only that user's own memberships — and the defining property
      // of this branch is that the super admin has NO membership in the target
      // org, so their cached session says nothing whatsoever about it. Serving
      // this from cache would mean a second key space (`org:{id}`) with its own
      // invalidation surface: every org create, soft-delete and restore would
      // become another write that has to remember to clear it, to save one
      // indexed primary-key lookup on the platform-admin path — by far the
      // lowest-traffic path in the application. Not a trade worth making.
      const org = await this.prisma.reader.organization.findUnique({
        where: { id: orgId },
        select: { id: true, isActive: true, suspendedAt: true },
      });

      if (!org) {
        throw new ForbiddenException('Organization not found.');
      }

      request.orgId = orgId;
      request.orgMembership = { role: 'ADMIN', isSuperAdmin: true }; // SuperAdmin gets ADMIN-level access
      return true;
    }

    // Regular user — check membership against the session, which falls back to
    // the database on a cache miss or a Redis outage.
    const session = await this.sessions.getSession(user.sub);

    // Re-checked here as well as in JwtStrategy. The two reads are normally the
    // same cached object, but a soft-delete landing between them must not leave
    // a window where the guard admits an account the strategy would now reject.
    if (!session || session.deletedAt) {
      throw new ForbiddenException(
        'You are not a member of this organization.',
      );
    }

    const membership = session.memberships.find(
      (m) => m.organizationId === orgId,
    );

    if (!membership) {
      this.logger.warn(
        `User ${user.sub} attempted to access org ${orgId} without membership.`,
      );
      throw new ForbiddenException(
        'You are not a member of this organization.',
      );
    }

    if (
      !membership.organization.isActive ||
      membership.organization.suspendedAt
    ) {
      throw new ForbiddenException('This organization has been suspended.');
    }

    // Attach org context to the request for downstream handlers.
    //
    // The membership ROW id is no longer included: the session projection does
    // not carry it, and nothing consumed it — RoleGuard, the only reader of
    // request.orgMembership, uses `.role` alone. Adding the id back to the
    // cached shape purely to populate a field no code reads would be paying
    // memory and a version bump for nothing.
    request.orgId = orgId;
    request.orgMembership = {
      role: membership.role,
      isSuperAdmin: false,
    };

    return true;
  }
}
