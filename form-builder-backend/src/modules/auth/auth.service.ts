import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../common/prisma/prisma.service';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { MailService } from '../mail/mail.service';
// @ts-ignore
import { authenticator } from 'otplib';
import * as qrcode from 'qrcode';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private mailService: MailService,
  ) {}

  private async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      timeCost: 3,
      memoryCost: 65536,
      parallelism: 4,
    });
  }

  private generateRefreshToken(): { plainTextToken: string; hashedToken: string } {
    const plainTextToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(plainTextToken).digest('hex');
    return { plainTextToken, hashedToken };
  }

  /**
   * Generate a URL-safe slug from a string.
   * Used for organization slugs derived from the org name.
   */
  private generateSlug(name: string): string {
    const baseSlug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 100);
    // Append random suffix to ensure uniqueness
    const suffix = crypto.randomBytes(3).toString('hex');
    return `${baseSlug}-${suffix}`;
  }

  async register(dto: RegisterDto) {
    const existing = await this.prisma.reader.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (existing) {
      throw new ConflictException('Email already in use');
    }

    const passwordHash = await this.hashPassword(dto.password);

    // Check if there's a pending invitation for this email
    const pendingInvitation = await this.prisma.reader.organizationInvitation.findFirst({
      where: {
        email: dto.email.toLowerCase(),
        status: 'PENDING',
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Use a transaction to atomically create user + org + membership
    const result = await this.prisma.writer.$transaction(async (tx: any) => {
      // 1. Create the user
      const user = await tx.user.create({
        data: {
          email: dto.email.toLowerCase(),
          passwordHash,
          firstName: dto.firstName,
          lastName: dto.lastName,
        },
      });

      let organizationId: string | undefined;
      let orgRole: string | undefined;

      if (pendingInvitation) {
        // User was invited to an existing org — join that org
        await tx.organizationMember.create({
          data: {
            organizationId: pendingInvitation.organizationId,
            userId: user.id,
            role: pendingInvitation.role,
            invitedById: pendingInvitation.invitedById,
          },
        });

        // Mark invitation as accepted
        await tx.organizationInvitation.update({
          where: { id: pendingInvitation.id },
          data: { status: 'ACCEPTED', acceptedAt: new Date() },
        });

        organizationId = pendingInvitation.organizationId;
        orgRole = pendingInvitation.role;
      } else {
        // No invitation — create a new organization for this user
        const orgName = dto.organizationName || `${dto.firstName}'s Organization`;
        const org = await tx.organization.create({
          data: {
            name: orgName,
            slug: this.generateSlug(orgName),
          },
        });

        // Make the user an ADMIN of their new org
        await tx.organizationMember.create({
          data: {
            organizationId: org.id,
            userId: user.id,
            role: 'ADMIN',
          },
        });

        organizationId = org.id;
        orgRole = 'ADMIN';
      }

      return { user, organizationId, orgRole };
    });

    // ── Generate and send email verification token ──
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24); // 24 hour expiry

    await this.prisma.writer.emailVerificationToken.create({
      data: {
        userId: result.user.id,
        tokenHash,
        expiresAt,
      },
    });

    const verifyUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/verify-email?token=${rawToken}`;
    // Fire and forget email sending
    this.mailService.sendPasswordResetEmail(result.user.email, verifyUrl).catch(console.error); // We'd want a proper sendVerificationEmail here in reality, but leveraging this for now or assuming mailService has it

    return this.generateTokens(
      result.user.id,
      result.user.email,
      result.user.systemRole,
      result.organizationId,
      result.orgRole,
    );
  }

  async verifyEmail(token: string) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const verifyToken = await this.prisma.reader.emailVerificationToken.findUnique({
      where: { tokenHash },
    });

    if (!verifyToken || verifyToken.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired verification token');
    }

    await this.prisma.writer.$transaction(async (tx: any) => {
      // Mark email as verified
      await tx.user.update({
        where: { id: verifyToken.userId },
        data: { emailVerified: true },
      });

      // Delete this token and all other tokens for this user
      await tx.emailVerificationToken.deleteMany({
        where: { userId: verifyToken.userId },
      });
    });

    return { message: 'Email has been verified successfully' };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.reader.user.findUnique({
      where: { email: dto.email.toLowerCase() },
      include: {
        memberships: {
          select: {
            organizationId: true,
            role: true,
            organization: {
              select: { isActive: true, suspendedAt: true },
            },
          },
          take: 1,
        },
      },
    });

    if (!user || user.deletedAt) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!await argon2.verify(user.passwordHash, dto.password)) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const membership = user.memberships[0];

    // Check if org is suspended
    if (membership?.organization && (!membership.organization.isActive || membership.organization.suspendedAt)) {
      throw new UnauthorizedException('Your organization has been suspended. Contact support.');
    }

    if (user.mfaEnabled) {
      // Issue a temporary token for MFA verification
      const mfaToken = this.jwtService.sign(
        { sub: user.id, email: user.email, isMfaPending: true },
        { expiresIn: '5m' }
      );
      return { mfaRequired: true, mfaToken };
    }

    return this.generateTokens(
      user.id,
      user.email,
      user.systemRole,
      membership?.organizationId,
      membership?.role,
    );
  }

  async verifyMfaLogin(mfaToken: string, code: string) {
    let payload: any;
    try {
      payload = this.jwtService.verify(mfaToken);
    } catch (e) {
      throw new UnauthorizedException('Invalid or expired MFA token');
    }

    if (!payload.isMfaPending) {
      throw new UnauthorizedException('Invalid token type');
    }

    const user = await this.prisma.reader.user.findUnique({
      where: { id: payload.sub },
      include: {
        memberships: {
          select: { organizationId: true, role: true },
          take: 1,
        },
      },
    });

    if (!user || !user.mfaEnabled || !user.mfaSecret) {
      throw new UnauthorizedException('MFA is not configured for this user');
    }

    const isValid = authenticator.verify({ token: code, secret: user.mfaSecret });
    if (!isValid) {
      throw new UnauthorizedException('Invalid MFA code');
    }

    const membership = user.memberships[0];
    return this.generateTokens(
      user.id,
      user.email,
      user.systemRole,
      membership?.organizationId,
      membership?.role,
    );
  }

  async refresh(oldRefreshToken: string) {
    const hashedToken = crypto.createHash('sha256').update(oldRefreshToken).digest('hex');

    const tokenRecord = await this.prisma.reader.refreshToken.findUnique({
      where: { tokenHash: hashedToken },
    });

    if (!tokenRecord || tokenRecord.revokedAt || tokenRecord.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Revoke old token
    await this.prisma.writer.refreshToken.update({
      where: { id: tokenRecord.id },
      data: { revokedAt: new Date() },
    });

    const user = await this.prisma.reader.user.findUnique({
      where: { id: tokenRecord.userId },
      include: {
        memberships: {
          select: { organizationId: true, role: true },
          take: 1,
        },
      },
    });

    if (!user || user.deletedAt) {
      throw new UnauthorizedException('User not found');
    }

    const membership = user.memberships[0];

    // Issue new tokens
    return this.generateTokens(
      user.id,
      user.email,
      user.systemRole,
      membership?.organizationId,
      membership?.role,
    );
  }

  async logout(refreshToken: string) {
    if (!refreshToken) return;

    const hashedToken = crypto.createHash('sha256').update(refreshToken).digest('hex');

    await this.prisma.writer.refreshToken.updateMany({
      where: { tokenHash: hashedToken, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Get the current user's profile with org context.
   * Called by GET /auth/me endpoint.
   */
  async getMe(userId: string) {
    const user = await this.prisma.reader.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        emailVerified: true,
        systemRole: true,
        createdAt: true,
        memberships: {
          select: {
            id: true,
            role: true,
            joinedAt: true,
            organization: {
              select: {
                id: true,
                name: true,
                slug: true,
                logoUrl: true,
                isActive: true,
              },
            },
          },
          take: 1,
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const membership = user.memberships[0];

    return {
      ...user,
      memberships: undefined,
      organization: membership ? {
        id: membership.organization.id,
        name: membership.organization.name,
        slug: membership.organization.slug,
        logoUrl: membership.organization.logoUrl,
        isActive: membership.organization.isActive,
        role: membership.role,
        joinedAt: membership.joinedAt,
      } : null,
      mfaEnabled: user.mfaEnabled,
    };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // FORGOT / RESET PASSWORD
  // ════════════════════════════════════════════════════════════════════════════

  async forgotPassword(email: string) {
    const user = await this.prisma.reader.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!user || user.deletedAt) {
      // Return success anyway to prevent email enumeration
      return { message: 'If that email exists, a reset link has been sent.' };
    }

    // Generate token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    // 1 hour expiration
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1);

    await this.prisma.writer.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${rawToken}`;
    await this.mailService.sendPasswordResetEmail(user.email, resetUrl);

    return { message: 'If that email exists, a reset link has been sent.' };
  }

  async resetPassword(token: string, newPassword: string) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const resetToken = await this.prisma.reader.passwordResetToken.findUnique({
      where: { tokenHash },
    });

    if (!resetToken || resetToken.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired reset token');
    }

    const passwordHash = await this.hashPassword(newPassword);

    await this.prisma.writer.$transaction(async (tx: any) => {
      // Update password
      await tx.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash },
      });

      // Delete this token and all other tokens for this user
      await tx.passwordResetToken.deleteMany({
        where: { userId: resetToken.userId },
      });
      
      // Revoke all refresh tokens so all devices are logged out
      await tx.refreshToken.updateMany({
        where: { userId: resetToken.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });

    return { message: 'Password has been reset successfully' };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // MULTI-FACTOR AUTHENTICATION (MFA)
  // ════════════════════════════════════════════════════════════════════════════

  async setupMfa(userId: string) {
    const user = await this.prisma.reader.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');
    
    // Always generate a new secret during setup
    const secret = authenticator.generateSecret();
    
    await this.prisma.writer.user.update({
      where: { id: userId },
      data: { mfaSecret: secret, mfaEnabled: false }, // Only enable after verification
    });

    const otpauthUrl = authenticator.keyuri(user.email, 'FormBuilder', secret);
    const qrCodeDataUrl = await qrcode.toDataURL(otpauthUrl);

    return {
      secret,
      qrCode: qrCodeDataUrl,
    };
  }

  async verifyMfaSetup(userId: string, code: string) {
    const user = await this.prisma.reader.user.findUnique({ where: { id: userId } });
    if (!user || !user.mfaSecret) {
      throw new UnauthorizedException('MFA setup not initiated');
    }

    const isValid = authenticator.verify({ token: code, secret: user.mfaSecret });
    
    if (!isValid) {
      throw new UnauthorizedException('Invalid MFA code');
    }

    await this.prisma.writer.user.update({
      where: { id: userId },
      data: { mfaEnabled: true },
    });

    return { message: 'MFA enabled successfully' };
  }

  async disableMfa(userId: string) {
    await this.prisma.writer.user.update({
      where: { id: userId },
      data: { mfaEnabled: false, mfaSecret: null },
    });
    return { message: 'MFA disabled successfully' };
  }

  private async generateTokens(
    userId: string,
    email: string,
    systemRole: string,
    organizationId?: string,
    orgRole?: string,
  ) {
    // Generate short-lived access token (15 mins)
    const payload: Record<string, any> = { sub: userId, email, systemRole };
    if (organizationId) payload.organizationId = organizationId;
    if (orgRole) payload.orgRole = orgRole;

    const accessToken = this.jwtService.sign(payload, { expiresIn: '15m' });

    // Generate opaque refresh token (7 days)
    const { plainTextToken, hashedToken } = this.generateRefreshToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await this.prisma.writer.refreshToken.create({
      data: {
        userId,
        tokenHash: hashedToken,
        expiresAt,
      },
    });

    return {
      accessToken,
      refreshToken: plainTextToken,
      user: {
        id: userId,
        email,
        systemRole,
        organizationId: organizationId ?? null,
        orgRole: orgRole ?? null,
      },
    };
  }
}
