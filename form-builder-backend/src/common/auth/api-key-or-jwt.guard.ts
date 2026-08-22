import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { AppLogger } from '../observability/logger/app-logger.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { ApiKeyGuard, hasApiKeyHeader } from './api-key.guard';
import { SCOPES_KEY } from './scopes.decorator';

/**
 * Accept EITHER a bearer token OR an API key — never require both.
 *
 * ── Why a guard and not two ────────────────────────────────────────────────
 * Nest's `@UseGuards(A, B)` is an AND: every guard must return true. There is
 * no built-in OR, and the usual workarounds are worse than they look:
 *
 *  • Two guards where the first swallows its own failure and sets a flag on the
 *    request means the *second* guard decides, and reading the code tells you
 *    nothing about which one actually authenticated.
 *  • Method-level `@UseGuards(ApiKeyGuard)` does not replace a controller-level
 *    `@UseGuards(JwtAuthGuard)`; class guards run first and reject the request
 *    before the method guard is ever consulted. This is the trap: it looks like
 *    an override and behaves like an addition.
 *
 * So the OR lives in one place, as one guard, and it is a strict dispatch
 * rather than a fallback chain: exactly one authentication path runs, chosen by
 * whether the caller presented `X-API-Key`. A request never gets two chances,
 * and a failure is always attributed to the mechanism the caller actually used.
 *
 * ── How to use it ──────────────────────────────────────────────────────────
 * Substitute it for JwtAuthGuard at the head of the existing chain:
 *
 *   @UseGuards(ApiKeyOrJwtGuard, OrgMemberGuard, RoleGuard)
 *   export class FormsController {
 *     @Get(':formId')
 *     @RequiredRole('VIEWER')
 *     @RequiredScope('forms:read')     // ← opts THIS route in to API keys
 *     getFormById(...) {}
 *
 *     @Delete(':formId')
 *     @RequiredRole('ADMIN')           // no @RequiredScope → keys rejected
 *     deleteForm(...) {}
 *   }
 *
 * Swapping the guard on a controller is therefore not a security change on its
 * own. Every route on that controller keeps behaving exactly as it did until
 * someone adds @RequiredScope to a specific handler, which is the one edit a
 * reviewer needs to look for.
 *
 * The rest of the chain is untouched and still runs on the API-key path:
 * ApiKeyGuard populates `request.user` with the key's owner, so OrgMemberGuard
 * re-checks that owner's membership of :orgId and RoleGuard applies their org
 * role. A key is thus bounded by the intersection of its scopes and its
 * owner's role — it can never outlive the owner's access or exceed it.
 */
@Injectable()
export class ApiKeyOrJwtGuard extends JwtAuthGuard {
  constructor(
    logger: AppLogger,
    // JwtAuthGuard holds its own private copy; this one is ours to read the
    // scope metadata with. They are the same instance — passed straight to
    // super — so there is no second Reflector and no chance of divergence.
    private readonly scopeReflector: Reflector,
    private readonly apiKeyGuard: ApiKeyGuard,
  ) {
    super(logger, scopeReflector);
  }

  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const request = context.switchToHttp().getRequest();

    // No key presented → this is an ordinary browser/session request. Straight
    // to the JWT path, including its @Public() handling.
    if (!hasApiKeyHeader(request.headers)) {
      return super.canActivate(context);
    }

    // Handler only, never the class — see @RequiredScope. Checked here as well
    // as inside ApiKeyGuard so the refusal happens before any Redis or database
    // work is done on behalf of an unauthenticated caller.
    const requiredScopes = this.scopeReflector.get<string[] | undefined>(
      SCOPES_KEY,
      context.getHandler(),
    );

    if (!requiredScopes?.length) {
      // Deliberately NOT a fallthrough to the JWT path. A caller sending
      // X-API-Key against a route that does not accept keys has made a mistake
      // worth naming; letting it fall through would report "no bearer token",
      // which describes a problem they do not have.
      throw new UnauthorizedException(
        'This endpoint does not accept API key authentication.',
      );
    }

    return this.apiKeyGuard.canActivate(context);
  }
}
