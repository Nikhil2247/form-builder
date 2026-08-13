import {
  Injectable,
  Logger,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../common/prisma/prisma.service';
import { resolveActiveOrganization } from '../../common/tenancy/active-organization';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { userCredentialsSelect } from '../../common/prisma/selects';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { MailService } from '../mail/mail.service';
import { AuditService } from '../audit/audit.service';
import { TotpService } from '../../common/crypto/totp.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import {
  decideRefreshAction,
  interpretRotationClaim,
} from './refresh-token-family';
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

/**
 * Where a token exchange came from.
 *
 * Carried purely so a security event can be attributed to something. A token
 * reuse entry that says only "a refresh token was replayed" tells an incident
 * responder nothing they can act on; the same entry with an address and a user
 * agent tells them whether the replay came from the victim's own browser or
 * from somewhere else entirely, which is the whole question.
 *
 * Never an authorization input — both fields are attacker-controlled.
 */
export interface SessionContext {
  ipAddress?: string;
  userAgent?: string;
}

/** What every successful authentication hands back. */
export interface IssuedTokenPair {
  accessToken: string;
  refreshToken: string;
  /** When the whole session ends. The controller sizes the cookie to it. */
  sessionExpiresAt: Date;
  user: {
    id: string;
    email: string;
    systemRole: string;
    organizationId: string | null;
    orgRole: string | null;
  };
}

/**
 * Outcome of the rotation transaction. A discriminated union rather than a
 * thrown exception because two of the three arms must COMMIT before they fail
 * the request: the predecessor has already been revoked at that point, and
 * throwing from inside `$transaction` would roll that revocation back and hand
 * a spent token back its validity.
 */
type RotationOutcome =
  | { outcome: 'rotated'; tokens: IssuedTokenPair }
  | { outcome: 'replay' }
  | { outcome: 'user-invalid' };

/** Column widths from the schema; values here are client-supplied. */
const IP_ADDRESS_MAX = 45;
const USER_AGENT_MAX = 512;

/**
 * The user fields needed to mint a token pair.
 *
 * Declared alongside its own interface because it is read through a transaction
 * client, and this codebase types those `any` (Prisma's `$transaction` callback
 * parameter carries no useful type through the pagination extension). Without
 * the annotation, `resolveActiveOrganization` infers its generic from `any` and
 * degrades to the bare `MembershipLike` constraint — which has no `role`, so the
 * org role silently stops reaching the token.
 */
interface TokenSubject {
  id: string;
  email: string;
  systemRole: string;
  deletedAt: Date | null;
  lastActiveOrganizationId: string | null;
  memberships: Array<{
    organizationId: string;
    role: string;
    joinedAt: Date;
    organization: { isActive: boolean; suspendedAt: Date | null };
  }>;
}

const tokenSubjectSelect = {
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
      organization: { select: { isActive: true, suspendedAt: true } },
    },
  },
} as const;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private mailService: MailService,
    private totp: TotpService,
    private crypto: CryptoService,
    private featureFlags: FeatureFlagsService,
    private config: ConfigService,
    // AuditModule is @Global, so no import is needed in AuthModule.
    private audit: AuditService,
  ) {}

  private async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      timeCost: 3,
      memoryCost: 65536,
      parallelism: 4,
    });
  }

  private generateRefreshToken(): {
    plainTextToken: string;
    hashedToken: string;
  } {
    const plainTextToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto
      .createHash('sha256')
      .update(plainTextToken)
      .digest('hex');
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

  async register(dto: RegisterDto, context: SessionContext = {}) {
    const existing = await this.prisma.reader.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (existing) {
      throw new ConflictException('Email already in use');
    }

    const passwordHash = await this.hashPassword(dto.password);

    // Check if there's a pending invitation for this email
    const pendingInvitation =
      await this.prisma.reader.organizationInvitation.findFirst({
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
        const orgName =
          dto.organizationName || `${dto.firstName}'s Organization`;
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
    const tokenHash = crypto
      .createHash('sha256')
      .update(rawToken)
      .digest('hex');
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
      .sendVerificationEmail(
        result.user.email,
        verifyUrl,
        result.user.firstName,
      )
      .catch((err) =>
        this.logger.error('Failed to send verification email', err),
      );

    // No familyId: this is a root token, so it founds its own family.
    return this.generateTokens(
      result.user.id,
      result.user.email,
      result.user.systemRole,
      result.organizationId,
      result.orgRole,
      undefined,
      { context },
    );
  }

  async verifyEmail(token: string) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const verifyToken =
      await this.prisma.reader.emailVerificationToken.findUnique({
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

  async login(dto: LoginDto, context: SessionContext = {}) {
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

    if (!(await argon2.verify(user.passwordHash, dto.password))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const { active: membership, allSuspended } = resolveActiveOrganization(
      user.memberships,
      user.lastActiveOrganizationId,
    );

    // Only refuse the login when every org is suspended — a user with one
    // suspended workspace and one healthy one still has somewhere to land.
    if (allSuspended) {
      throw new UnauthorizedException(
        'Your organization has been suspended. Contact support.',
      );
    }

    if (user.mfaEnabled) {
      // Issue a temporary token for MFA verification
      const mfaToken = this.jwtService.sign(
        { sub: user.id, email: user.email, isMfaPending: true },
        { expiresIn: '5m' },
      );
      return { mfaRequired: true, mfaToken };
    }

    // Root token — a fresh sign-in starts a fresh family.
    return this.generateTokens(
      user.id,
      user.email,
      user.systemRole,
      membership?.organizationId,
      membership?.role,
      undefined,
      { context },
    );
  }

  async verifyMfaLogin(
    mfaToken: string,
    code: string,
    context: SessionContext = {},
  ) {
    let payload: any;
    try {
      payload = this.jwtService.verify(mfaToken);
    } catch {
      // The verify failure is deliberately not surfaced or attached: expired,
      // malformed and wrong-signature must be indistinguishable to the caller.
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

    // Root token — completing an MFA challenge is the second half of a sign-in,
    // not a continuation of anything, so it founds its own family too.
    return this.generateTokens(
      user.id,
      user.email,
      user.systemRole,
      membership?.organizationId,
      membership?.role,
      undefined,
      { context },
    );
  }

  /**
   * Exchange a refresh token for its successor, with replay detection.
   * ═════════════════════════════════════════════════════════════════════════
   *
   * The shape of this method is dictated by two failure modes it has to close.
   *
   * ── 1. A replayed token is not an expired token ───────────────────────────
   * The old implementation rejected "revoked" and "expired" with the same
   * generic 401, so a stolen-and-already-spent token was indistinguishable from
   * a session that had simply run out — see `refresh-token-family.ts` for the
   * full threat model. `decideRefreshAction` now separates them, and a replay
   * takes the whole family down.
   *
   * ── 2. Two concurrent refreshes must not both succeed ─────────────────────
   * Read-then-write is not enough: two requests carrying the same valid token
   * both read `revokedAt: null`, both revoke, and both mint a successor,
   * leaving two live tokens in one family. The revoke is therefore a
   * conditional UPDATE (`updateMany` with `revokedAt: null` in the WHERE),
   * which Postgres resolves as a compare-and-swap — exactly one caller can see
   * one row change. See `interpretRotationClaim`.
   *
   * The claim and the successor's INSERT share one transaction so they commit
   * or fail together; without that, a crash between them would revoke a token
   * and issue nothing, silently ending a session.
   */
  async refresh(
    oldRefreshToken: string,
    context: SessionContext = {},
  ): Promise<IssuedTokenPair> {
    const hashedToken = crypto
      .createHash('sha256')
      .update(oldRefreshToken)
      .digest('hex');

    // Deliberately the WRITER, not the reader. Every refresh reads a row that
    // was written seconds earlier by the previous refresh, so a replica behind
    // by even a moment reports the successor as missing and 401s a session that
    // is perfectly valid. (The stale-replica read in the other direction — a
    // spent token still showing as live — is harmless here, because the
    // conditional UPDATE below re-checks on the primary. The missing-row
    // direction has no such backstop.)
    const tokenRecord = await this.prisma.writer.refreshToken.findUnique({
      where: { tokenHash: hashedToken },
      select: {
        id: true,
        userId: true,
        familyId: true,
        expiresAt: true,
        revokedAt: true,
        revokedReason: true,
      },
    });

    const decision = decideRefreshAction(tokenRecord);

    if (decision.action === 'reject') {
      // One message for both reasons: telling the caller WHICH token they hold
      // would let anyone probe the token table by trying values and reading the
      // difference between "no such token" and "that one is finished".
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // `decision` is no longer 'reject', so the row exists.
    const token = tokenRecord!;

    if (decision.action === 'burn-family') {
      await this.burnTokenFamily(token, context);
      throw new UnauthorizedException(
        'This session was ended for security reasons. Please sign in again.',
      );
    }

    const result: RotationOutcome = await this.prisma.writer.$transaction(
      async (tx: any): Promise<RotationOutcome> => {
        // The compare-and-swap. `revokedAt: null` in the WHERE is the whole
        // mechanism — drop it and this becomes a plain update that every
        // concurrent caller wins.
        const claim = await tx.refreshToken.updateMany({
          where: { id: token.id, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: 'ROTATED' },
        });

        if (interpretRotationClaim(claim.count).action === 'burn-family') {
          // Lost the race. Return rather than throw: the family burn has to run
          // on its own after this transaction settles, not inside it.
          return { outcome: 'replay' };
        }

        const user: TokenSubject | null = await tx.user.findUnique({
          where: { id: token.userId },
          select: tokenSubjectSelect,
        });

        if (!user || user.deletedAt) {
          // Commit the revocation anyway. A deleted user's token has no business
          // staying live, and rolling back here would hand it back its validity.
          return { outcome: 'user-invalid' };
        }

        const { active: membership } = resolveActiveOrganization(
          user.memberships,
          user.lastActiveOrganizationId,
        );

        // The SAME session, continued — not a new one. `token.expiresAt` is
        // the deadline set when this user signed in, and passing it through is
        // what stops an exchange from extending anything: the replacement pair
        // expires at the same instant the one it replaced would have.
        //
        // `familyId` is inherited for the same reason: the successor belongs to
        // the login that started the chain, so a replay anywhere in it burns
        // every descendant including this one.
        const tokens = await this.generateTokens(
          user.id,
          user.email,
          user.systemRole,
          membership?.organizationId,
          membership?.role,
          token.expiresAt,
          { familyId: token.familyId, client: tx, context },
        );

        return { outcome: 'rotated', tokens };
      },
    );

    if (result.outcome === 'replay') {
      await this.burnTokenFamily(token, context);
      throw new UnauthorizedException(
        'This session was ended for security reasons. Please sign in again.',
      );
    }

    if (result.outcome === 'user-invalid') {
      throw new UnauthorizedException('User not found');
    }

    return result.tokens;
  }

  /**
   * Cascade-revoke every live token descended from one login, because one of
   * them was replayed.
   *
   * A single UPDATE, so it needs no transaction of its own: the set of rows it
   * touches is decided by the database at execution time, and a concurrent
   * rotation either commits before it (and is then revoked by it) or blocks on
   * the row lock and finds its own predicate no longer satisfiable. Either
   * ordering ends with no live token in the family, which is the only property
   * that matters.
   *
   * Frequently updates ZERO rows — a family burned by logout or by an admin is
   * already fully revoked, and a stale tab replaying its dead cookie lands
   * here. That is why `previousReason` goes into the audit entry: it separates
   * "a credential leaked" from "a browser retried something harmless", which
   * anyone triaging these needs and cannot otherwise recover.
   */
  private async burnTokenFamily(
    token: {
      id: string;
      userId: string;
      familyId: string;
      revokedReason: string | null;
    },
    context: SessionContext,
  ): Promise<void> {
    const { count } = await this.prisma.writer.refreshToken.updateMany({
      where: { familyId: token.familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'REUSE_DETECTED' },
    });

    this.logger.warn(
      `Refresh token reuse detected for user ${token.userId} — revoked ${count} live token(s) in family ${token.familyId}.`,
    );

    // Attributable by construction: the account whose credential was replayed,
    // the family that was burned, and where the replay came from. `resource:
    // 'session'` rather than 'user' so these can be pulled out of the audit log
    // as a class. organizationId is null — this is a platform-level security
    // event, and at the point of detection there is no reliable tenant to
    // attribute it to (the presenter has not been authenticated as anyone).
    this.audit.log({
      organizationId: null,
      userId: token.userId,
      action: 'auth.refresh_token_reuse_detected',
      resource: 'session',
      resourceId: token.familyId,
      metadata: {
        tokenId: token.id,
        familyId: token.familyId,
        // NULL here means the token was live and we lost a rotation race;
        // anything else names how the family had already ended.
        previousReason: token.revokedReason,
        liveTokensRevoked: count,
        userAgent: context.userAgent ?? null,
      },
      ipAddress: context.ipAddress,
    });
  }

  async logout(refreshToken: string) {
    if (!refreshToken) return;

    const hashedToken = crypto
      .createHash('sha256')
      .update(refreshToken)
      .digest('hex');

    // Scoped to the presented token rather than its family, and the two are the
    // same set in practice: rotation revokes each predecessor as it issues the
    // successor, so a family has at most one live token at any moment. Scoping
    // it here keeps logout doing exactly what it says — ending THIS session —
    // instead of quietly acquiring the power to end others.
    await this.prisma.writer.refreshToken.updateMany({
      where: { tokenHash: hashedToken, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'LOGOUT' },
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
      /// Resolved feature flags for the active workspace, as { KEY: boolean }.
      /// Delivered with the session so the shell can decide what to render
      /// without a second round-trip on every page load.
      ///
      /// UI gating only — never authorization. Every endpoint keeps its own
      /// guards, so flipping a flag in devtools reveals menus, not data.
      features: await this.featureFlags.getForOrganization(
        active?.organizationId,
      ),
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
    const tokenHash = crypto
      .createHash('sha256')
      .update(rawToken)
      .digest('hex');

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

      // Revoke all refresh tokens so all devices are logged out. Reason matters:
      // the whole point of a password reset is that the old credential may be in
      // someone else's hands, so these revocations are evidence, not routine —
      // and without the label they are indistinguishable in the token table from
      // ordinary rotations.
      await tx.refreshToken.updateMany({
        where: { userId: resetToken.userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'PASSWORD_RESET' },
      });
    });

    return { message: 'Password has been reset successfully' };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // MULTI-FACTOR AUTHENTICATION (MFA)
  // ════════════════════════════════════════════════════════════════════════════

  async setupMfa(userId: string) {
    const user = await this.prisma.reader.user.findUnique({
      where: { id: userId },
    });
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
    const user = await this.prisma.reader.user.findUnique({
      where: { id: userId },
    });
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
    const user = await this.prisma.reader.user.findUnique({
      where: { id: userId },
    });
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

    const hashes = await Promise.all(
      codes.map((c) => argon2.hash(c, { type: argon2.argon2id })),
    );

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
  private async consumeRecoveryCode(
    userId: string,
    candidate: string,
  ): Promise<boolean> {
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

  /**
   * Mint the token pair for a session.
   * ═════════════════════════════════════════════════════════════════════════
   *
   * ── A session has a fixed end, and nothing can move it ────────────────────
   * `sessionExpiresAt` is the moment this session dies, decided once when the
   * user signs in and then carried forward unchanged by every subsequent call.
   * Omit it and a NEW session starts, ending `JWT_REFRESH_TTL_DAYS` from now;
   * pass the existing deadline (what `refresh` does) and the session keeps the
   * end it already had.
   *
   * That parameter is the whole point. This method used to compute both
   * lifetimes from `Date.now()` on every call, including from `refresh()` — so
   * each refresh minted a fresh full-length access token AND a fresh
   * full-length refresh token. A client that refreshed once a day would have
   * stayed signed in forever, and the configured one-day session would never
   * once have expired for anybody actually using the app. That is a rolling
   * session wearing a fixed session's clothes.
   *
   * The access token is additionally capped so it can never outlive the
   * session: near the end of the day the last token issued is a short one,
   * and the client's expiry timer fires at the real deadline rather than a
   * day past it.
   *
   * ── This is the ONLY place a RefreshToken row is created ──────────────────
   * Which is what makes family seeding safe to reason about: register, login,
   * MFA login and refresh all funnel through here, so there is exactly one line
   * that decides what `familyId` a token carries. Omit `opts.familyId` and the
   * row founds a new family pointing at itself; pass one and the row joins its
   * predecessor's chain. A family is therefore never empty and never orphaned.
   *
   * @param opts.familyId Inherited from the predecessor during rotation. Absent
   *   for a root token (a real sign-in), which seeds the family to its own id.
   * @param opts.client   Prisma transaction client, so the caller can commit the
   *   INSERT together with whatever else it is doing. Defaults to the writer.
   * @param opts.context  Caller IP / user agent, recorded on the row for the
   *   "active sessions" admin view. Display only — never an auth input.
   */
  private async generateTokens(
    userId: string,
    email: string,
    systemRole: string,
    organizationId?: string,
    orgRole?: string,
    sessionExpiresAt?: Date,
    opts: { familyId?: string; client?: any; context?: SessionContext } = {},
  ): Promise<IssuedTokenPair> {
    const payload: Record<string, any> = { sub: userId, email, systemRole };
    if (organizationId) payload.organizationId = organizationId;
    if (orgRole) payload.orgRole = orgRole;

    const refreshTtlDays = this.config.get<number>('jwt.refreshTtlDays', 1);
    const sessionEnd =
      sessionExpiresAt ??
      new Date(Date.now() + refreshTtlDays * 24 * 60 * 60 * 1000);

    const secondsLeft = Math.floor((sessionEnd.getTime() - Date.now()) / 1000);
    if (secondsLeft <= 0) {
      throw new UnauthorizedException(
        'Your session has expired. Please sign in again.',
      );
    }

    // Previously hardcoded to '15m' here regardless of JWT_ACCESS_TTL_SECONDS —
    // the env var was validated and parsed into config.jwt.accessTtl but never
    // actually reached the token. JwtModule's own default (also read from the
    // same env var) only applies when `sign()` is called without an explicit
    // `expiresIn`, so the two never conflicted; the configured value just
    // silently never took effect.
    const configuredAccessTtl = this.config.get<number>(
      'jwt.accessTtl',
      86_400,
    );
    const accessTtlSeconds = Math.min(configuredAccessTtl, secondsLeft);
    const accessToken = this.jwtService.sign(payload, {
      expiresIn: accessTtlSeconds,
    });

    // Opaque refresh token, expiring with the session rather than a fresh day
    // from now. It exists so that reloading the tab does not sign the user
    // out — the access token is held in memory only and dies with the page —
    // and for nothing else: it is exchanged at most once per page load and
    // never on a timer or a 401.
    const { plainTextToken, hashedToken } = this.generateRefreshToken();

    // The id is generated here rather than left to the column default because a
    // root token has to store its OWN id in `familyId`, and the default is
    // computed inside the INSERT where nothing can read it back in time.
    const id = crypto.randomUUID();
    const db = opts.client ?? this.prisma.writer;

    await db.refreshToken.create({
      data: {
        id,
        userId,
        tokenHash: hashedToken,
        // Root of a new family, or a link in an existing chain. Never null: an
        // unattributable token could not be cascade-revoked, which would make it
        // the one token a compromise could not clean up.
        familyId: opts.familyId ?? id,
        expiresAt: sessionEnd,
        // Truncated because both are client-supplied and `ip_address` is a
        // VarChar(45); an oversized header should not fail a login with a
        // database error.
        userAgent: opts.context?.userAgent?.slice(0, USER_AGENT_MAX) ?? null,
        ipAddress: opts.context?.ipAddress?.slice(0, IP_ADDRESS_MAX) ?? null,
      },
    });

    return {
      accessToken,
      refreshToken: plainTextToken,
      sessionExpiresAt: sessionEnd,
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
