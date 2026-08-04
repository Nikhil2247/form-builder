import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../common/prisma/prisma.service';

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
        memberships: {
          select: {
            organizationId: true,
            role: true,
            organization: {
              select: { isActive: true, suspendedAt: true },
            },
          },
          take: 1, // User can only have one membership
        },
      },
    });

    if (!user || user.deletedAt) {
      throw new UnauthorizedException('User not found or deleted.');
    }

    const membership = user.memberships[0];

    // Check if org is active (not suspended)
    if (membership?.organization && (!membership.organization.isActive || membership.organization.suspendedAt)) {
      throw new UnauthorizedException('Your organization has been suspended. Contact support.');
    }

    return {
      sub: user.id,
      email: user.email,
      systemRole: user.systemRole,
      organizationId: membership?.organizationId ?? undefined,
      orgRole: membership?.role ?? undefined,
    };
  }
}
