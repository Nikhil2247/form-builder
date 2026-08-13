import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { SessionCacheService } from '../../../common/session/session-cache.service';
import { resolveActiveOrganization } from '../../../common/tenancy/active-organization';

export interface JwtPayload {
  sub: string;
  email: string;
  systemRole: string; // 'USER' | 'SUPER_ADMIN'
  organizationId?: string; // null if user has no org yet
  orgRole?: string; // 'ADMIN' | 'EDITOR' | 'VIEWER'
  iat?: number;
  exp?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private readonly sessions: SessionCacheService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET!,
    });
  }

  /**
   * Re-derive the caller's identity from stored state on every request.
   *
   * The JWT's own claims are deliberately NOT trusted for anything but `sub`:
   * they were minted when the user signed in and say nothing about what has
   * happened since. Reading the user back is what makes a suspension, a
   * soft-delete or a role change take effect before the access token expires.
   *
   * That read used to be a database query on every single authenticated
   * request. It now goes through SessionCacheService, which serves it from
   * Redis for a short TTL and falls back to the identical query when the cache
   * is cold, versioned out, or unreachable — so the security properties above
   * are unchanged, bounded by the TTL documented on that service. `OrgMemberGuard`
   * reads the same cached object, which is what removed the SECOND query this
   * path used to cost.
   */
  async validate(payload: JwtPayload): Promise<JwtPayload> {
    const user = await this.sessions.getSession(payload.sub);

    if (!user || user.deletedAt) {
      throw new UnauthorizedException('User not found or deleted.');
    }

    const { active, allSuspended } = resolveActiveOrganization(
      user.memberships,
      user.lastActiveOrganizationId,
    );

    // Only lock the session out when EVERY org the user belongs to is
    // suspended. Under multi-org, rejecting the token because one workspace is
    // suspended would strand the user in their other, healthy workspaces.
    if (allSuspended) {
      throw new UnauthorizedException(
        'Your organization has been suspended. Contact support.',
      );
    }

    // organizationId/orgRole describe the default workspace only. Authorization
    // for any org-scoped route comes from :orgId + OrgMemberGuard, never these.
    return {
      sub: user.id,
      email: user.email,
      systemRole: user.systemRole,
      organizationId: active?.organizationId ?? undefined,
      orgRole: active?.role ?? undefined,
    };
  }
}
