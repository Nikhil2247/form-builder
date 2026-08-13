import {
  Controller,
  Post,
  Get,
  Body,
  Res,
  Req,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { DisableMfaDto } from './dto/disable-mfa.dto';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyMfaDto, VerifyMfaLoginDto } from './dto/verify-mfa.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { CookieOptions, Response, Request } from 'express';

const COOKIE_NAME = 'refresh_token';

/**
 * The refresh cookie's attributes, in one place so that `res.cookie` and
 * `res.clearCookie` cannot drift apart. A `clearCookie` whose domain or path
 * does not match the cookie that was set deletes nothing at all, silently, and
 * the browser goes on presenting a token the API has already revoked.
 *
 * COOKIE_DOMAIN is the load-bearing one in a split-host deployment. Left unset,
 * this is a host-only cookie: set by `formsapi.example.org`, and therefore
 * invisible to `forms.example.org`. That is harmless in local development,
 * where the API and the web app share the `localhost` host and cookies ignore
 * the port — which is exactly why this defect cannot reproduce there. In
 * production it means `proxy.ts`, which gates every dashboard route on the mere
 * PRESENCE of this cookie, can never see it: login succeeds, the API sets the
 * cookie on the API host, and the very next navigation to /dashboard is bounced
 * straight back to /login?next=%2Fdashboard, forever. Set it to the registrable
 * domain both hosts share, e.g. `.example.org`.
 *
 * sameSite is 'lax' rather than 'strict'. Both hosts sit under one registrable
 * domain, so the XHRs are same-site under either value; what 'strict'
 * additionally withholds is the cookie on arrival from OFF-site — an invite or
 * password-reset link opened from a mail client. That top-level navigation
 * would carry no cookie, so `proxy.ts` would send an already-signed-in user to
 * /login. 'lax' still withholds it from cross-site POSTs, which is the CSRF
 * case that actually matters for /auth/refresh.
 */
function refreshCookieOptions(): CookieOptions {
  const domain = process.env.COOKIE_DOMAIN?.trim();
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    ...(domain ? { domain } : {}),
  };
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Size the cookie to the session's real end, not to a fresh full term.
   *
   * `expiresAt` is the deadline the service decided when the user signed in and
   * has carried through every exchange since. Deriving the cookie's lifetime
   * from JWT_REFRESH_TTL_DAYS instead — which is what this did — handed the
   * browser a full extra day on every refresh, so the cookie outlived the
   * token record inside it and `middleware.ts` went on believing there was a
   * session long after the API would honour one.
   */
  private setRefreshTokenCookie(res: Response, token: string, expiresAt: Date) {
    res.cookie(COOKIE_NAME, token, {
      ...refreshCookieOptions(),
      expires: expiresAt,
    });
  }

  /**
   * Where this request came from, for the session record and for security
   * audit entries.
   *
   * `req.ip` is trustworthy only because main.ts sets `trust proxy`, which makes
   * Express derive it from X-Forwarded-For behind the load balancer instead of
   * reporting the proxy's own address for every user on the platform. Both
   * values are still attacker-influenced and are recorded for humans to read —
   * never used to decide anything.
   */
  private sessionContext(req: Request) {
    return {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    };
  }

  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.register(
      dto,
      this.sessionContext(req),
    );
    this.setRefreshTokenCookie(
      res,
      result.refreshToken,
      result.sessionExpiresAt,
    );
    return { accessToken: result.accessToken, user: result.user };
  }

  // 5 attempts / 15 min. The global 100/min bucket allows ~144k password
  // guesses per IP per day, which is not meaningful protection against
  // credential stuffing.
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(dto, this.sessionContext(req));

    // If MFA is required, we don't get tokens yet
    if ('mfaRequired' in result) {
      return result;
    }

    this.setRefreshTokenCookie(
      res,
      result.refreshToken,
      result.sessionExpiresAt,
    );
    return { accessToken: result.accessToken, user: result.user };
  }

  // A 6-digit TOTP has a 1M keyspace; at the global 100/min an attacker could
  // brute-force it within the validity window. 5 attempts per 5 minutes makes
  // that infeasible.
  @Throttle({ default: { limit: 5, ttl: 300_000 } })
  @Post('login/mfa')
  @HttpCode(HttpStatus.OK)
  async loginMfa(
    @Body() dto: VerifyMfaLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.verifyMfaLogin(
      dto.mfaToken,
      dto.code,
      this.sessionContext(req),
    );
    this.setRefreshTokenCookie(
      res,
      result.refreshToken,
      result.sessionExpiresAt,
    );
    return { accessToken: result.accessToken, user: result.user };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const oldRefreshToken = req.cookies?.[COOKIE_NAME];
    if (!oldRefreshToken) {
      // `passthrough: true` means Nest still owns the response after this
      // handler returns — it serialises whatever comes back (or, for a thrown
      // exception, hands it to the exception filter) and sends it exactly
      // once. Writing to `res` directly here as well as returning made Nest
      // try to send a second response on top of the first and crash with
      // ERR_HTTP_HEADERS_SENT. Throwing keeps this on the one path that
      // handler is actually written for.
      throw new UnauthorizedException('No refresh token provided');
    }

    let result: Awaited<ReturnType<AuthService['refresh']>>;
    try {
      result = await this.authService.refresh(
        oldRefreshToken,
        this.sessionContext(req),
      );
    } catch (err) {
      // The cookie is spent — revoked, expired, or from a session that has run
      // its full day. Clearing it here matters because `middleware.ts` reads
      // the cookie's PRESENCE as "this browser has a session": leaving a dead
      // one in place sent signed-out visitors from /login to /dashboard, which
      // then sent them back to /login, forever.
      res.clearCookie(COOKIE_NAME, refreshCookieOptions());
      throw err;
    }

    this.setRefreshTokenCookie(
      res,
      result.refreshToken,
      result.sessionExpiresAt,
    );
    return { accessToken: result.accessToken, user: result.user };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = req.cookies?.[COOKIE_NAME];
    if (refreshToken) {
      await this.authService.logout(refreshToken);
    }
    res.clearCookie(COOKIE_NAME, refreshCookieOptions());
    return { message: 'Logged out successfully' };
  }

  @Get('verify-email')
  async verifyEmail(@Req() req: Request) {
    const token = req.query.token as string;
    if (!token) {
      return { message: 'Token is required' };
    }
    return this.authService.verifyEmail(token);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // FORGOT / RESET PASSWORD
  // ════════════════════════════════════════════════════════════════════════════

  // Rate-limited to prevent using the endpoint as a free mail-bomb relay
  // against arbitrary third-party addresses.
  @Throttle({ default: { limit: 3, ttl: 900_000 } })
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.newPassword);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // MULTI-FACTOR AUTHENTICATION
  // ════════════════════════════════════════════════════════════════════════════

  @Post('mfa/setup')
  @UseGuards(JwtAuthGuard)
  async setupMfa(@Req() req: Request) {
    const userId = (req.user as any).sub;
    return this.authService.setupMfa(userId);
  }

  @Post('mfa/verify')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async verifyMfa(@Req() req: Request, @Body() dto: VerifyMfaDto) {
    const userId = (req.user as any).sub;
    return this.authService.verifyMfaSetup(userId, dto.code);
  }

  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  @Post('mfa/disable')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async disableMfa(@Req() req: Request, @Body() dto: DisableMfaDto) {
    const userId = (req.user as any).sub;
    return this.authService.disableMfa(userId, dto.currentPassword);
  }

  /**
   * GET /auth/me — Returns the current user's profile with organization context.
   * Used by the frontend to hydrate the user state on page load.
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@Req() req: Request) {
    const userId = (req.user as any).sub;
    return this.authService.getMe(userId);
  }
}
