import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { APP_INTERCEPTOR, APP_FILTER, APP_GUARD } from '@nestjs/core';
import { CacheModule } from '@nestjs/cache-manager';
import { redisStore } from 'cache-manager-ioredis-yet';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';

import { AppController } from './app.controller';
import { AppService } from './app.service';

import { AuthModule } from './modules/auth/auth.module';
import { FormsModule } from './modules/forms/forms.module';
import { SubmissionsModule } from './modules/submissions/submissions.module';
import { StorageModule } from './modules/storage/storage.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { LookupModule } from './modules/lookup/lookup.module';
import { AdminModule } from './modules/admin/admin.module';
import { AuditModule } from './modules/audit/audit.module';
import { MailModule } from './modules/mail/mail.module';
import { HealthModule } from './common/health/health.module';
import { TemplatesModule } from './modules/templates/templates.module';

import configuration, { validationSchema } from './config/configuration';
import { bullMQConnection } from './config/bullmq.config';

// ── Logging ────────────────────────────────────────────────────────────────────
import { LoggerModule } from './common/logger/logger.module';
import { HttpLoggingInterceptor } from './common/interceptors/logging.interceptor';

import { PrismaModule } from './common/prisma/prisma.module';
import { RedisModule } from './common/redis/redis.module';
import { CryptoModule } from './common/crypto/crypto.module';

// ── Global error handling ──────────────────────────────────────────────────────
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

// ── Global response envelope ───────────────────────────────────────────────────
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

@Module({
  imports: [
    // ── Environment & Config ─────────────────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema,
    }),

    // ── Winston Logger (global — no need to import in feature modules) ────────
    LoggerModule,

    // ── Prisma Database (global) ──────────────────────────────────────────────
    PrismaModule,

    // ── Redis (global, single shared connection) ──────────────────────────────
    RedisModule,

    // ── Crypto: secret encryption at rest + TOTP (global) ─────────────────────
    CryptoModule,

    // ── Audit Logging (global) ────────────────────────────────────────────────
    AuditModule,

    // ── Mail Service (global) ─────────────────────────────────────────────────
    MailModule,

    // ── BullMQ — shared Redis connection for all queues ───────────────────────
    BullModule.forRoot({ connection: bullMQConnection }),

    // ── Global Cache (Redis) ──────────────────────────────────────────────────
    CacheModule.registerAsync({
      isGlobal: true,
      useFactory: () => ({
        store: redisStore,
        url: process.env.REDIS_URL ?? 'redis://localhost:6379',
      }),
    }),

    // ── Global Rate Limiting (Redis-backed) ───────────────────────────────────
    // MUST be Redis-backed: the default in-memory storage gives each pod its own
    // counters, so with N pods the effective limit is N x limit and every deploy
    // resets it. Named throttlers let routes opt into stricter buckets via
    // @Throttle({ strict: {...} }) — see AuthController.
    ThrottlerModule.forRootAsync({
      useFactory: () => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 100 }],
        storage: new ThrottlerStorageRedisService(
          process.env.REDIS_URL ?? 'redis://localhost:6379',
        ),
        // Trust the proxy-provided client IP. main.ts sets `trust proxy` so
        // req.ips is populated from X-Forwarded-For.
        getTracker: (req: any) =>
          req.ips?.length ? req.ips[0] : (req.ip ?? req.socket?.remoteAddress ?? 'unknown'),
      }),
    }),

    // ── Feature Modules ───────────────────────────────────────────────────────
    AuthModule,
    FormsModule,
    SubmissionsModule,
    StorageModule,
    AnalyticsModule,
    WebhooksModule,
    OrganizationsModule,
    LookupModule,
    AdminModule,
    HealthModule,
    TemplatesModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,

    // ── Global HTTP request/response logger (Winston) ─────────────────────────
    // Runs on EVERY request: logs incoming + outgoing with timing, status, IP.
    {
      provide: APP_INTERCEPTOR,
      useClass: HttpLoggingInterceptor,
    },

    // ── Global response envelope ──────────────────────────────────────────────
    // Wraps every successful response: { data: ..., meta: { requestId, timestamp } }
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseInterceptor,
    },

    // ── Global rate limiting guard ────────────────────────────────────────────
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },

    // ── Global exception filter ───────────────────────────────────────────────
    // Catches all exceptions and formats them as: { error: { statusCode, message } }
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
  ],
})
export class AppModule {}
