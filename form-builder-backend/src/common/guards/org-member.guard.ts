import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppLogger } from '../logger/app-logger.service';

/**
 * OrgMemberGuard — validates that the authenticated user is a member
 * of the organization specified in the route parameter `:orgId`.
 *
 * Usage:
 *   @UseGuards(JwtAuthGuard, OrgMemberGuard)
 *
 * This guard:
 *  1. Reads the orgId from route params
 *  2. Queries OrganizationMember for the (userId, orgId) pair
 *  3. Attaches the membership (with role) to request.orgMembership
 *  4. Also attaches request.orgId for convenience
 *  5. Rejects with 403 if the user is not a member
 *
 * SUPER_ADMIN BYPASS: If the user has systemRole === 'SUPER_ADMIN',
 * they are allowed access to any organization without a membership record.
 */
@Injectable()
export class OrgMemberGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
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
      throw new ForbiddenException('Organization ID is required in route parameters.');
    }

    // SUPER_ADMIN bypass — can access any org
    if (user.systemRole === 'SUPER_ADMIN') {
      // Verify the org exists
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

    // Regular user — check membership
    const membership = await this.prisma.reader.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: orgId,
          userId: user.sub,
        },
      },
      select: {
        id: true,
        role: true,
        organization: {
          select: { isActive: true, suspendedAt: true },
        },
      },
    });

    if (!membership) {
      this.logger.warn(`User ${user.sub} attempted to access org ${orgId} without membership.`);
      throw new ForbiddenException('You are not a member of this organization.');
    }

    if (!membership.organization.isActive || membership.organization.suspendedAt) {
      throw new ForbiddenException('This organization has been suspended.');
    }

    // Attach org context to the request for downstream handlers
    request.orgId = orgId;
    request.orgMembership = {
      id: membership.id,
      role: membership.role,
      isSuperAdmin: false,
    };

    return true;
  }
}
