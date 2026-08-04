import { Controller, Post, Get, Body, Res, Req, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
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
  constructor(private readonly authService: AuthService) {}

  private setRefreshTokenCookie(res: Response, token: string) {
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });
  }

  @Post('register')
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.register(dto);
    this.setRefreshTokenCookie(res, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(dto);
    
    // If MFA is required, we don't get tokens yet
    if ('mfaRequired' in result) {
      return result;
    }

    this.setRefreshTokenCookie(res, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Post('login/mfa')
  @HttpCode(HttpStatus.OK)
  async loginMfa(@Body() dto: VerifyMfaLoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.verifyMfaLogin(dto.mfaToken, dto.code);
    this.setRefreshTokenCookie(res, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const oldRefreshToken = req.cookies?.[COOKIE_NAME];
    if (!oldRefreshToken) {
      res.status(HttpStatus.UNAUTHORIZED).send({ message: 'No refresh token provided' });
      return;
    }

    const result = await this.authService.refresh(oldRefreshToken);
    this.setRefreshTokenCookie(res, result.refreshToken);
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

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

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

  @Post('mfa/disable')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async disableMfa(@Req() req: Request) {
    const userId = (req.user as any).sub;
    return this.authService.disableMfa(userId);
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
