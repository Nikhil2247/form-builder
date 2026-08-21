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
import { SubjectsModule } from './modules/subjects/subjects.module';
import { FormAppsModule } from './modules/form-apps/form-apps.module';
import { FeatureFlagsModule } from './modules/feature-flags/feature-flags.module';
import { ChoiceListsModule } from './modules/choice-lists/choice-lists.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ExportsModule } from './modules/exports/exports.module';
import { AssistantModule } from './modules/assistant/assistant.module';

import configuration, { validationSchema } from './config/configuration';
import { bullMQConnection } from './config/bullmq.config';
import { getRedisUrl } from './config/env';

// ── Logging ────────────────────────────────────────────────────────────────────
import { LoggerModule } from './common/logger/logger.module';
import { HttpLoggingInterceptor } from './common/interceptors/logging.interceptor';

import { PrismaModule } from './common/prisma/prisma.module';
import { RedisModule } from './common/redis/redis.module';
import { CryptoModule } from './common/crypto/crypto.module';
import { SessionModule } from './common/session/session.module';

// ── Observability ──────────────────────────────────────────────────────────────
import { MetricsModule } from './common/metrics/metrics.module';
import { HttpMetricsInterceptor } from './common/metrics/http-metrics.interceptor';

// ── Tenant scoping ─────────────────────────────────────────────────────────────
import { TenantContextInterceptor } from './common/tenancy/tenant-context.interceptor';

// ── Global error handling ──────────────────────────────────────────────────────
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

// ── Global response envelope ───────────────────────────────────────────────────
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { CacheControlInterceptor } from './common/interceptors/cache-control.interceptor';

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

    // ── Prometheus metrics (global) ───────────────────────────────────────────
    // Owns the process's single prom-client Registry. @Global for the same
    // reason as RedisModule: a second instance would try to register metric
    // names that already exist and, in worker mode, bind METRICS_PORT twice.
    MetricsModule,

    // ── Session cache (global) ────────────────────────────────────────────────
    // Serves the authenticated user + memberships to JwtStrategy and
    // OrgMemberGuard from Redis instead of two DB round-trips per request.
    SessionModule,

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
        // One resolver for every Redis consumer (cache, throttler, BullMQ), so
        // they cannot end up pointed at different servers.
        url: getRedisUrl(),
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
        storage: new ThrottlerStorageRedisService(getRedisUrl()),
        // Trust the proxy-provided client IP. main.ts sets `trust proxy` so
        // req.ips is populated from X-Forwarded-For.
        getTracker: (req: any) =>
          req.ips?.length
            ? req.ips[0]
            : (req.ip ?? req.socket?.remoteAddress ?? 'unknown'),
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
    SubjectsModule,
    FormAppsModule,
    FeatureFlagsModule,
    ChoiceListsModule,

    // Global: exports ApiKeyGuard / ApiKeyOrJwtGuard, which controllers in other
    // modules name in @UseGuards(). A guard that injects another guard needs
    // that guard to be a real exported provider — Nest will not instantiate it
    // implicitly.
    ApiKeysModule,

    // In-app notifications + the SSE stream.
    NotificationsModule,

    // Asynchronous exports. Registers its processor only in worker/combined mode
    // (see ExportsModule), so API pods never stream a submissions table on the
    // event loop they serve HTTP from.
    ExportsModule,

    // Claude-backed AI assistant. Phase 0: the Claude client wrapper and the
    // idea/generation service behind POST .../forms/generate (imported
    // directly by FormsModule too). Later phases add its own controllers —
    // see AI_ASSISTANT_PLAN.md.
    AssistantModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,

    // ── INTERCEPTOR ORDER IS LOAD-BEARING ─────────────────────────────────────
    // Nest applies global interceptors in registration order, and the FIRST
    // registered is the OUTERMOST wrapper. Read this list as onion layers,
    // outside in. Guards run before all of them, which is why none of these can
    // observe a 401/429/404 — see the note in common/metrics/.

    // ── HTTP metrics (outermost) ──────────────────────────────────────────────
    // Only from here does http_request_duration_seconds cover the work the other
    // interceptors do, and does http_requests_in_flight count a request for the
    // whole time it is in the pipeline rather than only while the handler runs.
    {
      provide: APP_INTERCEPTOR,
      useClass: HttpMetricsInterceptor,
    },

    // ── Global HTTP request/response logger (Winston) ─────────────────────────
    // One record per request, emitted on response finish.
    {
      provide: APP_INTERCEPTOR,
      useClass: HttpLoggingInterceptor,
    },

    // ── Default Cache-Control ─────────────────────────────────────────────────
    // `no-store` unless a route opted into caching with @Header. Without this,
    // authenticated responses carried no directive and a shared cache was free
    // to reuse one tenant's data for another's request.
    {
      provide: APP_INTERCEPTOR,
      useClass: CacheControlInterceptor,
    },

    // ── Global response envelope ──────────────────────────────────────────────
    // Wraps every successful response: { data: ..., meta: { requestId, timestamp } }
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseInterceptor,
    },

    // ── Tenant context (innermost) ────────────────────────────────────────────
    // Registered LAST so it sits closest to the route handler. That is
    // deliberate: it must wrap the handler (everything the handler awaits runs
    // inside the AsyncLocalStorage store), but there is nothing to gain from
    // also wrapping response serialisation, and an ALS store held across more
    // of the pipeline than necessary is a store with more chances to leak.
    //
    // It reads request.orgId — the OUTPUT of OrgMemberGuard, never the raw
    // :orgId URL segment. Guards run before interceptors, so by this point
    // membership has already been proven. See tenant-context.interceptor.ts.
    {
      provide: APP_INTERCEPTOR,
      useClass: TenantContextInterceptor,
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
