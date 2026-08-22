import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { AppLogger } from '../observability/logger/app-logger.service';
import { IS_PUBLIC_KEY } from './public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly logger: AppLogger,
    private readonly reflector: Reflector,
  ) {
    super();
    this.logger.setContext(JwtAuthGuard.name);
  }

  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    // getAllAndOverride would also consult the controller class. Read the
    // handler alone, so @Public() can never be hoisted to a whole controller
    // and quietly unauthenticate every route on it.
    const isPublic = this.reflector.get<boolean | undefined>(
      IS_PUBLIC_KEY,
      context.getHandler(),
    );

    if (isPublic) return true;

    return super.canActivate(context);
  }

  handleRequest(err: any, user: any, info: any, context: ExecutionContext) {
    if (err || !user) {
      const req = context.switchToHttp().getRequest();
      this.logger.warn('Unauthorized JWT access attempt', {
        path: req.url,
        info: info?.message,
        error: err?.message,
      });
      throw (
        err ||
        new UnauthorizedException(
          info?.message ?? 'Invalid or expired access token.',
        )
      );
    }
    return user;
  }
}
