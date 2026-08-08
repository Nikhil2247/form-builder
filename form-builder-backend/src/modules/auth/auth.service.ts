import { Injectable, Logger, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../common/prisma/prisma.service';
import { resolveActiveOrganization } from '../../common/tenancy/active-organization';
import { userCredentialsSelect } from '../../common/prisma/selects';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { MailService } from '../mail/mail.service';
import { TotpService } from '../../common/crypto/totp.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import * as qrcode from 'qrcode';

/**
 * Base URL of the frontend, used to build links in outbound email.
 * Falls back to the first configured CORS origin so the two can never drift
 * (previously this defaulted to :3000, which is the API's own port).
 */
export function frontendUrl(): string {
  return (
    process.env.FRONTEND_URL ??
    process.env.CORS_ORIGINS?.split(',')[0]?.trim() ??
    'http://localhost:3001'
  );
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private mailService: MailService,
    private totp: TotpService,
    private crypto: CryptoService,
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

    const verifyUrl = `${frontendUrl()}/verify-email?token=${rawToken}`;
    // Fire and forget — a mail outage must not block account creation.
    this.mailService
      .sendVerificationEmail(result.user.email, verifyUrl, result.user.firstName)
      .catch((err) => this.logger.error('Failed to send verification email', err));

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
      // Explicit projection. `include` pulled every user column — including
      // `preferredStorage`, `avatarUrl`, and both timestamps — on the hottest
      // unauthenticated endpoint in the app. Only the credential fields and the
      // membership are needed to issue a token.
      select: {
        ...userCredentialsSelect,
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
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!await argon2.verify(user.passwordHash, dto.password)) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const { active: membership, allSuspended } = resolveActiveOrganization(
      user.memberships,
      user.lastActiveOrganizationId,
    );

    // Only refuse the login when every org is suspended — a user with one
    // suspended workspace and one healthy one still has somewhere to land.
    if (allSuspended) {
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
          select: {
            organizationId: true,
            role: true,
            joinedAt: true,
            organization: { select: { isActive: true, suspendedAt: true } },
          },
        },
      },
    });

    if (!user || !user.mfaEnabled || !user.mfaSecret) {
      throw new UnauthorizedException('MFA is not configured for this user');
    }

    const secret = this.crypto.decrypt(user.mfaSecret)!;

    // Accept either a TOTP code or a single-use recovery code.
    let isValid = await this.totp.verifyToken(code, secret);
    if (!isValid) {
      isValid = await this.consumeRecoveryCode(user.id, code);
    }

    if (!isValid) {
      throw new UnauthorizedException('Invalid MFA code');
    }

    const { active: membership } = resolveActiveOrganization(
      user.memberships,
      user.lastActiveOrganizationId,
    );
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
          select: {
            organizationId: true,
            role: true,
            joinedAt: true,
            organization: { select: { isActive: true, suspendedAt: true } },
          },
        },
      },
    });

    if (!user || user.deletedAt) {
      throw new UnauthorizedException('User not found');
    }

    const { active: membership } = resolveActiveOrganization(
      user.memberships,
      user.lastActiveOrganizationId,
    );

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
        // Was missing from the select, so getMe() always returned
        // mfaEnabled: undefined and the UI could never show MFA as active.
        mfaEnabled: true,
        createdAt: true,
        lastActiveOrganizationId: true,
        memberships: {
          select: {
            id: true,
            role: true,
            joinedAt: true,
            organizationId: true,
            organization: {
              select: {
                id: true,
                name: true,
                slug: true,
                logoUrl: true,
                isActive: true,
                suspendedAt: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const { active, usable } = resolveActiveOrganization(
      user.memberships,
      user.lastActiveOrganizationId,
    );

    const toWorkspace = (membership: (typeof user.memberships)[number]) => ({
      id: membership.organization.id,
      name: membership.organization.name,
      slug: membership.organization.slug,
      logoUrl: membership.organization.logoUrl,
      isActive: membership.organization.isActive,
      role: membership.role,
      joinedAt: membership.joinedAt,
    });

    return {
      ...user,
      memberships: undefined,
      lastActiveOrganizationId: undefined,
      /// Every workspace this user can switch into, oldest membership first.
      organizations: usable.map(toWorkspace),
      activeOrganization: active ? toWorkspace(active) : null,
      /// Retained under its original name so existing callers keep working
      /// while the frontend migrates to `activeOrganization`.
      organization: active ? toWorkspace(active) : null,
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

    const resetUrl = `${frontendUrl()}/reset-password?token=${rawToken}`;
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
    const secret = this.totp.generateSecret();

    await this.prisma.writer.user.update({
      where: { id: userId },
      // Encrypted at rest — a leaked backup must not hand over TOTP seeds.
      data: { mfaSecret: this.crypto.encrypt(secret), mfaEnabled: false },
    });

    const otpauthUrl = this.totp.buildUri(user.email, secret);
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

    const secret = this.crypto.decrypt(user.mfaSecret)!;
    // NOTE: totp.verifyToken returns a real boolean. otplib 13's verify()
    // resolves to { valid, delta } — truthiness-checking that object directly
    // would accept every code.
    const isValid = await this.totp.verifyToken(code, secret);

    if (!isValid) {
      throw new UnauthorizedException('Invalid MFA code');
    }

    const recoveryCodes = await this.issueRecoveryCodes(userId);

    await this.prisma.writer.user.update({
      where: { id: userId },
      data: { mfaEnabled: true },
    });

    // Shown exactly once. Without these, a lost device means a support ticket.
    return { message: 'MFA enabled successfully', recoveryCodes };
  }

  async disableMfa(userId: string, currentPassword: string) {
    // Disabling a second factor is a security-sensitive action; require the
    // password so a hijacked session cannot silently strip MFA.
    const user = await this.prisma.reader.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');

    if (!(await argon2.verify(user.passwordHash, currentPassword))) {
      throw new UnauthorizedException('Password is incorrect');
    }

    await this.prisma.writer.$transaction(async (tx: any) => {
      await tx.user.update({
        where: { id: userId },
        data: { mfaEnabled: false, mfaSecret: null },
      });
      await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
    });

    return { message: 'MFA disabled successfully' };
  }

  /**
   * Generate a fresh set of single-use recovery codes, replacing any existing
   * ones. Only argon2 hashes are stored; the plaintext is returned once.
   */
  private async issueRecoveryCodes(userId: string): Promise<string[]> {
    const codes = Array.from({ length: 10 }, () =>
      // 10 chars of base32-ish alphabet, hyphenated for legibility.
      crypto
        .randomBytes(8)
        .toString('base64url')
        .replace(/[^A-Za-z0-9]/g, '')
        .slice(0, 10)
        .toUpperCase()
        .replace(/^(.{5})(.{5})$/, '$1-$2'),
    );

    const hashes = await Promise.all(codes.map((c) => argon2.hash(c, { type: argon2.argon2id })));

    await this.prisma.writer.$transaction(async (tx: any) => {
      await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
      await tx.mfaRecoveryCode.createMany({
        data: hashes.map((codeHash) => ({ userId, codeHash })),
      });
    });

    return codes;
  }

  /**
   * Consume a recovery code in place of a TOTP token.
   * Each code works exactly once.
   */
  private async consumeRecoveryCode(userId: string, candidate: string): Promise<boolean> {
    const normalized = candidate.trim().toUpperCase();
    const codes = await this.prisma.reader.mfaRecoveryCode.findMany({
      where: { userId, usedAt: null },
    });

    for (const record of codes) {
      if (await argon2.verify(record.codeHash, normalized)) {
        await this.prisma.writer.mfaRecoveryCode.update({
          where: { id: record.id },
          data: { usedAt: new Date() },
        });
        return true;
      }
    }
    return false;
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
