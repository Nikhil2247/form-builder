// MUST be first. Loads .env before any other module is imported, so config
// files that read process.env at module scope see the real values. Without
// this, ConfigModule loads .env too late to help them and they fall back to
// their defaults — which is how every queue ended up pointed at localhost.
import './config/env';

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { WinstonNestAdapter } from './common/logger/winston-nest.adapter';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { getProcessRole } from './config/runtime.config';

// Patch BigInt to be serializable by JSON.stringify
(BigInt.prototype as any).toJSON = function () {
  return Number(this);
};

async function bootstrap() {
  // We use bufferLogs to ensure that NestJS buffers all initialisation logs 
  // until we can attach our Winston logger adapter.
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  // Replace standard Nest logger with our Winston adapter
  app.useLogger(app.get(WinstonNestAdapter));

  // ── Trust Proxy ───────────────────────────────────────────────────────────
  // CRITICAL when running behind a load balancer / nginx / Cloudflare.
  // Without this, req.ip is the proxy's address for EVERY request, so the rate
  // limiter buckets the entire internet into a single key — the first 100 req/min
  // succeed and everyone else gets 429. TRUSTED_PROXY_HOPS should match the
  // number of proxies in front of this service.
  const trustedHops = parseInt(process.env.TRUSTED_PROXY_HOPS ?? '1', 10);
  app.getHttpAdapter().getInstance().set('trust proxy', trustedHops);

  // ── API Versioning ────────────────────────────────────────────────────────
  // All routes served under /v1/ prefix for future versioning (URI-based).
  app.setGlobalPrefix('v1');

  // ── Body Size Limits ──────────────────────────────────────────────────────
  // Explicit and small. File bytes never pass through this API (uploads go
  // direct to MinIO/S3 via presigned URLs), so no route legitimately needs a
  // large body. Submission payloads are additionally size-checked per form by
  // AnswerValidatorService.
  const bodyLimit = process.env.MAX_REQUEST_BODY ?? '256kb';
  app.use(json({ limit: bodyLimit }));
  app.use(urlencoded({ extended: true, limit: bodyLimit }));

  // ── CORS ──────────────────────────────────────────────────────────────────
  // Allow requests from frontend origins. credentials: true is required for
  // HttpOnly refresh token cookies to be sent cross-origin.
  const corsOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim());
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Request-ID',
      'X-Api-Key',
      'Idempotency-Key',
      'X-Form-Password',
    ],
    exposedHeaders: ['X-Request-ID', 'Retry-After'],
    maxAge: 86400,
  });

  // ── Security Headers (Helmet) ─────────────────────────────────────────────
  // Sets CSP, HSTS, X-Frame-Options, X-Content-Type-Options, etc.
  // crossOriginResourcePolicy is relaxed to 'cross-origin' because the public
  // form runner is served from the frontend origin and reads from this API.
  // The default CSP blocks Swagger UI's inline scripts, so it is disabled only
  // on the docs route below (never globally).
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      crossOriginEmbedderPolicy: false,
    }),
  );

  // ── Response Compression ──────────────────────────────────────────────────
  // Gzip/Brotli compression reduces payload size by 40-60%.
  app.use(compression());

  // ── Cookie Parser ─────────────────────────────────────────────────────────
  // Required to read the HttpOnly refresh_token cookie set by AuthController.
  app.use(cookieParser());

  // ── Global Validation Pipe ────────────────────────────────────────────────
  // Enforces class-validator decorators on ALL DTOs. whitelist strips unknown
  // properties, forbidNonWhitelisted rejects requests with extra fields,
  // transform auto-converts payloads to DTO class instances.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ── Swagger API Documentation ─────────────────────────────────────────────
  // Available at /v1/docs in non-production environments.
  if (process.env.NODE_ENV !== 'production') {
    // Helmet's default CSP blocks Swagger UI's inline bootstrap script.
    // Scope the exemption to the docs path only.
    app.use('/v1/docs', (_req: any, res: any, next: any) => {
      res.removeHeader('Content-Security-Policy');
      next();
    });
    const swaggerConfig = new DocumentBuilder()
      .setTitle('FormBuilder API')
      .setDescription('Multi-tenant form builder backend API')
      .setVersion('1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
      .addCookieAuth('refresh_token')
      .addApiKey({ type: 'apiKey', name: 'X-Api-Key', in: 'header' }, 'api-key')
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('v1/docs', app, document);
  }

  // ── Graceful Shutdown ─────────────────────────────────────────────────────
  // Ensures BullMQ workers drain active jobs before the process exits.
  // Required for zero-job-loss during K8s rolling deployments.
  app.enableShutdownHooks();

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`🚀 Application is running on: http://localhost:${port}`);
  console.log(`⚙️  Process role: ${getProcessRole()}`);
  if (process.env.NODE_ENV !== 'production') {
    console.log(`📚 Swagger docs: http://localhost:${port}/v1/docs`);
  }
}

bootstrap();
