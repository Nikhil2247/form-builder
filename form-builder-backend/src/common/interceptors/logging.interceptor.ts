import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Inject,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger as WinstonLogger } from 'winston';

/**
 * HttpLoggingInterceptor
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Logs every HTTP request/response with:
 *  • Unique X-Request-ID per request (also injected into response header)
 *  • Method, URL, route pattern (e.g., /forms/:id, not /forms/abc-uuid)
 *  • Response status code with semantic level (info/warn/error)
 *  • Duration in ms (measured from first byte received to last byte sent)
 *  • Request IP (respects X-Forwarded-For behind proxies)
 *  • Response content-length in bytes
 *  • Authenticated user ID (when available)
 *
 * EXAMPLE DEV OUTPUT:
 *   → POST  /v1/forms          from 127.0.0.1  (Mozilla/5.0...)  [req-abc123]
 *   ← 201   POST  /v1/forms    12ms  [req-abc123]
 *
 *   → GET   /v1/forms/bad-id   from 127.0.0.1
 *   ← 404   GET   /v1/forms/bad-id   3ms
 *
 * SLOW REQUEST THRESHOLD:
 *   Requests taking >500ms are logged at WARN level with slowRequest=true.
 *   Requests taking >2000ms are logged at ERROR level for alerting.
 *
 * SCALABILITY NOTES:
 *  • Uses RxJS tap/catchError — zero blocking, zero CPU overhead on the hot path.
 *  • Request IDs are randomUUID() — cryptographically random, collision-free.
 *  • All timing uses process.hrtime.bigint() — nanosecond precision, no Date.now() drift.
 */
@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
  // Slow-request thresholds
  private readonly SLOW_WARN_MS  = parseInt(process.env.SLOW_REQUEST_WARN_MS  ?? '500',  10);
  private readonly SLOW_ERROR_MS = parseInt(process.env.SLOW_REQUEST_ERROR_MS ?? '2000', 10);

  // Paths to skip logging (health checks, static assets)
  private readonly SKIP_PATHS = new Set([
    '/health', '/healthz', '/ping', '/metrics', '/favicon.ico',
  ]);

  constructor(
    @Inject(WINSTON_MODULE_PROVIDER)
    private readonly logger: WinstonLogger,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') return next.handle();

    const req   = context.switchToHttp().getRequest<Request>();
    const res   = context.switchToHttp().getResponse<Response>();
    const { method, url, ip, headers } = req;

    // Skip noisy health-check and static paths
    const cleanUrl = url.split('?')[0]; // strip query string for matching
    if (this.SKIP_PATHS.has(cleanUrl)) return next.handle();

    // ── Request ID ────────────────────────────────────────────────────────────
    // Honour an existing request ID from the gateway/load-balancer, or generate one.
    const requestId = (
      (req.headers['x-request-id'] as string) ??
      (req.headers['x-correlation-id'] as string) ??
      randomUUID()
    );
    res.setHeader('X-Request-ID', requestId);  // Echo back for client tracing

    // ── Client info ───────────────────────────────────────────────────────────
    const clientIp = (
      (headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
      (headers['x-real-ip'] as string) ??
      req.socket?.remoteAddress ??
      ip ??
      'unknown'
    );
    const userAgent = (headers['user-agent'] as string) ?? '';

    // ── Body size ─────────────────────────────────────────────────────────────
    const bodySize = parseInt(headers['content-length'] as string, 10) || 0;

    // ── Auth user (populated by JwtAuthGuard if request is authenticated) ─────
    const userId = (req as any).user?.sub ?? undefined;

    // ── Start high-precision timer ────────────────────────────────────────────
    const startNs = process.hrtime.bigint();

    // ── Log incoming request ──────────────────────────────────────────────────
    this.logger.http('→ Incoming request', {
      context:   'HTTP',
      direction: 'IN',
      requestId,
      method,
      url,
      ip:        clientIp,
      userAgent: userAgent.slice(0, 120),
      bodySize,
      userId,
    });

    return next.handle().pipe(
      tap(() => {
        this.logOutgoing(context, req, res, requestId, clientIp, startNs, userId);
      }),
      catchError((err) => {
        // Log the response even on exception (HttpExceptionFilter handles the body)
        this.logOutgoing(context, req, res, requestId, clientIp, startNs, userId, err);
        return throwError(() => err);
      }),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  private logOutgoing(
    context: ExecutionContext,
    req: Request,
    res: Response,
    requestId: string,
    ip: string,
    startNs: bigint,
    userId?: string,
    err?: any,
  ) {
    const durationMs = Number((process.hrtime.bigint() - startNs) / 1_000_000n);

    // Status code: use the error's status if the filter hasn't written it yet
    const statusCode =
      err?.status ?? err?.statusCode ?? res.statusCode ?? 200;

    // Route pattern — e.g. /v1/forms/:id (more useful than /v1/forms/abc-uuid)
    const routePattern =
      context.switchToHttp().getRequest<any>()?.route?.path ?? req.url;

    const contentLength = parseInt(res.getHeader('content-length') as string, 10) || undefined;

    // ── Choose log level based on status + duration ───────────────────────────
    let level: string;
    if (statusCode >= 500 || durationMs >= this.SLOW_ERROR_MS) {
      level = 'error';
    } else if (statusCode >= 400 || durationMs >= this.SLOW_WARN_MS) {
      level = 'warn';
    } else {
      level = 'http';
    }

    const slowRequest = durationMs >= this.SLOW_WARN_MS;

    this.logger.log(level, '← Outgoing response', {
      context:       'HTTP',
      direction:     'OUT',
      requestId,
      method:        req.method,
      url:           req.url,
      routePattern,
      statusCode,
      durationMs,
      contentLength,
      ip,
      userId,
      slowRequest:   slowRequest || undefined,  // Only include if true
      errorMessage:  err?.message ?? undefined,
    });
  }
}
