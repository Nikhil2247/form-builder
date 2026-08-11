import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';

import { MailModule } from '../mail/mail.module';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: process.env.JWT_SECRET,
        // AuthService.generateTokens always passes its own `expiresIn`
        // (sourced from the same env var via ConfigService), so this default
        // only matters for other `jwtService.sign()` callers — currently just
        // the short-lived MFA challenge token, which sets its own 5m anyway.
        signOptions: { expiresIn: parseInt(process.env.JWT_ACCESS_TTL_SECONDS ?? '86400', 10) },
      }),
    }),
    MailModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
