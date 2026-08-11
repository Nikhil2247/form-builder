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
import type { Response, Request } from 'express';

const COOKIE_NAME = 'refresh_token';

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
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      expires: expiresAt,
    });
  }

  @Post('register')
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.register(dto);
    this.setRefreshTokenCookie(res, result.refreshToken, result.sessionExpiresAt);
    return { accessToken: result.accessToken, user: result.user };
  }

  // 5 attempts / 15 min. The global 100/min bucket allows ~144k password
  // guesses per IP per day, which is not meaningful protection against
  // credential stuffing.
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(dto);
    
    // If MFA is required, we don't get tokens yet
    if ('mfaRequired' in result) {
      return result;
    }

    this.setRefreshTokenCookie(res, result.refreshToken, result.sessionExpiresAt);
    return { accessToken: result.accessToken, user: result.user };
  }

  // A 6-digit TOTP has a 1M keyspace; at the global 100/min an attacker could
  // brute-force it within the validity window. 5 attempts per 5 minutes makes
  // that infeasible.
  @Throttle({ default: { limit: 5, ttl: 300_000 } })
  @Post('login/mfa')
  @HttpCode(HttpStatus.OK)
  async loginMfa(@Body() dto: VerifyMfaLoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.verifyMfaLogin(dto.mfaToken, dto.code);
    this.setRefreshTokenCookie(res, result.refreshToken, result.sessionExpiresAt);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
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
      result = await this.authService.refresh(oldRefreshToken);
    } catch (err) {
      // The cookie is spent — revoked, expired, or from a session that has run
      // its full day. Clearing it here matters because `middleware.ts` reads
      // the cookie's PRESENCE as "this browser has a session": leaving a dead
      // one in place sent signed-out visitors from /login to /dashboard, which
      // then sent them back to /login, forever.
      res.clearCookie(COOKIE_NAME);
      throw err;
    }

    this.setRefreshTokenCookie(res, result.refreshToken, result.sessionExpiresAt);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = req.cookies?.[COOKIE_NAME];
    if (refreshToken) {
      await this.authService.logout(refreshToken);
    }
    res.clearCookie(COOKIE_NAME);
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
