import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { WinstonNestAdapter } from './common/logger/winston-nest.adapter';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';

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

  // ── API Versioning ────────────────────────────────────────────────────────
  // All routes served under /v1/ prefix for future versioning (URI-based).
  app.setGlobalPrefix('v1');

  // ── CORS ──────────────────────────────────────────────────────────────────
  // Allow requests from frontend origins. credentials: true is required for
  // HttpOnly refresh token cookies to be sent cross-origin.
  const corsOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:3001')
    .split(',')
    .map((o) => o.trim());
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  });

  // ── Security Headers (Helmet) ─────────────────────────────────────────────
  // Sets CSP, HSTS, X-Frame-Options, X-Content-Type-Options, etc.
  app.use(helmet());

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
    const swaggerConfig = new DocumentBuilder()
      .setTitle('FormBuilder API')
      .setDescription('Multi-tenant form builder backend API')
      .setVersion('1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
      .addCookieAuth('refresh_token')
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('v1/docs', app, document);
  }

  // ── Graceful Shutdown ─────────────────────────────────────────────────────
  // Ensures BullMQ workers drain active jobs before the process exits.
  // Required for zero-job-loss during K8s rolling deployments.
  app.enableShutdownHooks();

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`🚀 Application is running on: http://localhost:${port}`);
  if (process.env.NODE_ENV !== 'production') {
    console.log(`📚 Swagger docs: http://localhost:${port}/v1/docs`);
  }
}

bootstrap();
