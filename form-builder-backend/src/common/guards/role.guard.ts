import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppLogger } from '../logger/app-logger.service';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * Role hierarchy for organization-level roles.
 * Higher number = more permissions.
 */
const ROLE_HIERARCHY: Record<string, number> = {
  VIEWER: 1,
  EDITOR: 2,
  ADMIN: 3,
};

/**
 * RoleGuard — enforces minimum organization role required for a route.
 *
 * Usage:
 *   @UseGuards(JwtAuthGuard, OrgMemberGuard, RoleGuard)
 *   @RequiredRole('ADMIN')
 *   async myAdminEndpoint() { ... }
 *
 * IMPORTANT: Must be used AFTER OrgMemberGuard, which attaches
 * request.orgMembership with the user's role in the target org.
 *
 * If no @RequiredRole() decorator is present on the handler,
 * the guard allows access (defaults to VIEWER level, i.e., any member).
 */
@Injectable()
export class RoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly logger: AppLogger,
  ) {
    this.logger.setContext(RoleGuard.name);
  }

  canActivate(context: ExecutionContext): boolean {
    // Get the required role from the @RequiredRole() decorator
    const requiredRole = this.reflector.getAllAndOverride<string | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No role requirement specified — allow any authenticated org member
    if (!requiredRole) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const membership = request.orgMembership;

    // SUPER_ADMIN always passes role checks
    if (user?.systemRole === 'SUPER_ADMIN') {
      return true;
    }

    if (!membership) {
      this.logger.warn(
        'RoleGuard: No org membership found on request. Was OrgMemberGuard used?',
      );
      throw new ForbiddenException('Organization membership required.');
    }

    const userRoleLevel = ROLE_HIERARCHY[membership.role] ?? 0;
    const requiredRoleLevel = ROLE_HIERARCHY[requiredRole] ?? 0;

    if (userRoleLevel < requiredRoleLevel) {
      this.logger.warn(
        `Role access denied: user has ${membership.role} (level ${userRoleLevel}), requires ${requiredRole} (level ${requiredRoleLevel})`,
        { userId: user.sub, path: request.url },
      );
      throw new ForbiddenException(
        `This action requires ${requiredRole} role or higher. Your role: ${membership.role}.`,
      );
    }

    return true;
  }
}
