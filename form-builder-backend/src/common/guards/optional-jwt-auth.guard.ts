import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * OptionalJwtAuthGuard — attaches req.user when a valid bearer token is present,
 * and allows the request through when it is absent or invalid.
 *
 * WHY: public form endpoints must stay open to anonymous respondents, but still
 * need to identify a signed-in user so that:
 *   • forms with requireAuth = true can be enforced
 *   • duplicate detection can key on userId instead of a weak IP hash
 *   • the submission can be attributed via respondentId
 *
 * The standard JwtAuthGuard rejects anonymous callers outright, which would make
 * every public form login-only.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest(_err: any, user: any) {
    // Never throw: an absent or expired token simply means "anonymous".
    return user || undefined;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      await super.canActivate(context);
    } catch {
      // Swallow — anonymous access is legitimate here.
    }
    return true;
  }
}
