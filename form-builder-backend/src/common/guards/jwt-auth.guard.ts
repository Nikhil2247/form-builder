import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AppLogger } from '../logger/app-logger.service';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly logger: AppLogger) {
    super();
    this.logger.setContext(JwtAuthGuard.name);
  }

  handleRequest(err: any, user: any, info: any, context: ExecutionContext) {
    if (err || !user) {
      const req = context.switchToHttp().getRequest();
      this.logger.warn('Unauthorized JWT access attempt', { path: req.url, info: info?.message, error: err?.message });
      throw err || new UnauthorizedException(info?.message ?? 'Invalid or expired access token.');
    }
    return user;
  }
}
