import { Injectable, Scope } from '@nestjs/common';
import { INQUIRER } from '@nestjs/core';
import { Inject } from '@nestjs/common';
import { Logger as WinstonLogger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';

/**
 * AppLogger — Injectable, context-aware application logger.
 *
 * Wraps Winston with a NestJS-friendly API. Automatically captures
 * the calling class name as the log context.
 *
 * USAGE:
 *
 *   @Injectable()
 *   export class FormsService {
 *     constructor(private readonly logger: AppLogger) {}
 *
 *     createForm() {
 *       this.logger.log('Creating form', 'FormsService', { userId, title });
 *       this.logger.error('DB write failed', error, 'FormsService');
 *     }
 *   }
 *
 * Or use the static factory for manual context:
 *   const log = AppLogger.forContext('MyWorker');
 *   log.info('Processing job', { jobId });
 */
@Injectable({ scope: Scope.TRANSIENT })
export class AppLogger {
  private context: string;

  constructor(
    @Inject(WINSTON_MODULE_PROVIDER)
    private readonly winston: WinstonLogger,
    // Auto-inject the calling class name as context
    @Inject(INQUIRER) private readonly parentClass?: any,
  ) {
    this.context = parentClass?.constructor?.name ?? 'App';
  }

  setContext(context: string) {
    this.context = context;
    return this;
  }

  // ── Application-level logs ─────────────────────────────────────────────────

  log(message: string, context?: string, meta?: Record<string, any>) {
    this.winston.info(message, { context: context ?? this.context, ...meta });
  }

  info(message: string, meta?: Record<string, any>) {
    this.winston.info(message, { context: this.context, ...meta });
  }

  warn(message: string, meta?: Record<string, any>) {
    this.winston.warn(message, { context: this.context, ...meta });
  }

  error(message: string, error?: Error | unknown, meta?: Record<string, any>) {
    const errMeta =
      error instanceof Error
        ? { errorMessage: error.message, stack: error.stack, errorName: error.name }
        : { error };

    this.winston.error(message, { context: this.context, ...errMeta, ...meta });
  }

  debug(message: string, meta?: Record<string, any>) {
    this.winston.debug(message, { context: this.context, ...meta });
  }

  verbose(message: string, meta?: Record<string, any>) {
    this.winston.verbose(message, { context: this.context, ...meta });
  }

  // ── HTTP access log (called by LoggingInterceptor) ─────────────────────────

  /**
   * Logs an incoming HTTP request (before handler executes).
   */
  logRequest(meta: {
    method: string;
    url: string;
    ip: string;
    userAgent?: string;
    requestId: string;
    bodySize?: number;
    userId?: string;
  }) {
    this.winston.http('→ Incoming request', {
      context:   'HTTP',
      direction: 'IN',
      ...meta,
    });
  }

  /**
   * Logs a completed HTTP response with full timing and status.
   */
  logResponse(meta: {
    method: string;
    url: string;
    statusCode: number;
    durationMs: number;
    requestId: string;
    contentLength?: number;
    ip?: string;
    userId?: string;
    routePattern?: string;
  }) {
    // Pick level based on status code
    const level =
      meta.statusCode >= 500 ? 'error'
      : meta.statusCode >= 400 ? 'warn'
      : 'http';

    this.winston.log(level, '← Outgoing response', {
      context:   'HTTP',
      direction: 'OUT',
      ...meta,
    });
  }
}
