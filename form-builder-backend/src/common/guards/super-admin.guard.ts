import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { AppLogger } from '../logger/app-logger.service';

/**
 * SuperAdminGuard — restricts route access to platform-level SUPER_ADMIN users.
 *
 * Usage:
 *   @UseGuards(JwtAuthGuard, SuperAdminGuard)
 *   @Get('admin/dashboard')
 *   async platformDashboard() { ... }
 *
 * Checks the `systemRole` field from the JWT payload (attached by JwtStrategy).
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(private readonly logger: AppLogger) {
    this.logger.setContext(SuperAdminGuard.name);
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      this.logger.warn(
        'SuperAdmin access denied: No authenticated user found.',
        { path: request.url },
      );
      throw new ForbiddenException('Super Administrator access required.');
    }

    if (user.systemRole !== 'SUPER_ADMIN') {
      this.logger.warn(`SuperAdmin access denied for user ${user.sub}`, {
        path: request.url,
        email: user.email,
      });
      throw new ForbiddenException('Super Administrator access required.');
    }

    return true;
  }
}
