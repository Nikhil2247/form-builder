import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { resolveActiveOrganization } from '../../../common/tenancy/active-organization';

export interface JwtPayload {
  sub: string;
  email: string;
  systemRole: string;      // 'USER' | 'SUPER_ADMIN'
  organizationId?: string; // null if user has no org yet
  orgRole?: string;        // 'ADMIN' | 'EDITOR' | 'VIEWER'
  iat?: number;
  exp?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET!,
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    const user = await this.prisma.reader.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        systemRole: true,
        deletedAt: true,
        lastActiveOrganizationId: true,
        memberships: {
          select: {
            organizationId: true,
            role: true,
            joinedAt: true,
            organization: {
              select: { isActive: true, suspendedAt: true },
            },
          },
        },
      },
    });

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
      throw new UnauthorizedException('Your organization has been suspended. Contact support.');
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
