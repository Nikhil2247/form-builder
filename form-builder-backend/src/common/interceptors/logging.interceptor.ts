import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Inject,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger as WinstonLogger } from 'winston';

/**
 * HttpLoggingInterceptor
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ONE log record per request, written when the response is finished:
 *  • Unique X-Request-ID per request (also injected into response header)
 *  • Method, URL, route pattern (e.g., /v1/forms/:id, not /v1/forms/abc-uuid)
 *  • Response status code with semantic level (info/warn/error)
 *  • Duration in ms (measured from first byte received to last byte sent)
 *  • Request IP (respects X-Forwarded-For behind proxies)
 *  • Request body size and response content-length in bytes
 *  • Authenticated user ID (when available)
 *  • The exception message, when the request ended in one
 *
 * EXAMPLE DEV OUTPUT:
 *   ← 201  POST /v1/forms          312B  12ms  from 127.0.0.1  [req-abc123]
 *   ← 404  GET  /v1/forms/bad-id          3ms  from 127.0.0.1
 *
 * ── WHY ONE RECORD AND NOT TWO ───────────────────────────────────────────────
 * This used to emit an `IN` line before the handler and an `OUT` line after,
 * which is two writes per request through every transport for one event, and
 * the `IN` line carried nothing the `OUT` line does not — it exists to tell you
 * a request arrived, which the completion record also tells you, with the
 * outcome attached. Half the log volume, half the disk and ingest cost, and one
 * line per request to grep instead of an interleaved pair that has to be
 * correlated by request id under concurrency.
 *
 * The one thing the early write did that mattered is the request id, and that
 * is unchanged: it is still generated (or adopted from the gateway) and set as
 * the X-Request-ID response header BEFORE the handler runs, so a client, an
 * exception filter, or a downstream service sees the same id whether or not the
 * request ever completes.
 *
 * ── WHY res.on('finish') AND NOT rxjs tap ────────────────────────────────────
 * `tap` fires when the handler's observable completes: before the exception
 * filter has chosen a status code, and before the body has been serialised and
 * written. That records a 200 for a request that becomes a 500, and a duration
 * that omits serialisation — which for the submissions export is most of the
 * request. `finish` fires after the last byte; `close` catches a client that
 * hung up first. `catchError` is still in the chain, but only to capture the
 * exception's message for the record — it does not decide when to write.
 *
 * SLOW REQUEST THRESHOLD:
 *   Requests taking >500ms are logged at WARN level with slowRequest=true.
 *   Requests taking >2000ms are logged at ERROR level for alerting.
 *
 * SCALABILITY NOTES:
 *  • One event-emitter callback per request — zero blocking on the hot path.
 *  • Request IDs are randomUUID() — cryptographically random, collision-free.
 *  • All timing uses process.hrtime.bigint() — nanosecond precision, no Date.now() drift.
 */
@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
  // Slow-request thresholds
  private readonly SLOW_WARN_MS = parseInt(
    process.env.SLOW_REQUEST_WARN_MS ?? '500',
    10,
  );
  private readonly SLOW_ERROR_MS = parseInt(
    process.env.SLOW_REQUEST_ERROR_MS ?? '2000',
    10,
  );

  // Paths to skip logging (probes, scrapes, static assets)
  private readonly SKIP_PATHS = new Set([
    '/healthz',
    '/ping',
    '/metrics',
    '/favicon.ico',
  ]);

  constructor(
    @Inject(WINSTON_MODULE_PROVIDER)
    private readonly logger: WinstonLogger,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    // `method` is read off `req` again at log time rather than destructured
    // here, so it is not bound in this scope.
    const { url, ip, headers } = req;

    if (this.shouldSkip(url)) return next.handle();

    // ── Request ID ────────────────────────────────────────────────────────────
    // Honour an existing request ID from the gateway/load-balancer, or generate one.
    const requestId =
      (req.headers['x-request-id'] as string) ??
      (req.headers['x-correlation-id'] as string) ??
      randomUUID();
    res.setHeader('X-Request-ID', requestId); // Echo back for client tracing

    // ── Client info ───────────────────────────────────────────────────────────
    const clientIp =
      (headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
      (headers['x-real-ip'] as string) ??
      req.socket?.remoteAddress ??
      ip ??
      'unknown';
    const userAgent = (headers['user-agent'] as string) ?? '';

    // ── Body size ─────────────────────────────────────────────────────────────
    const bodySize = parseInt(headers['content-length'] as string, 10) || 0;

    // ── Start high-precision timer ────────────────────────────────────────────
    const startNs = process.hrtime.bigint();

    // Captured by catchError below, read by the writer. The exception filter
    // turns the error into a status code; this keeps the message, which the
    // status code alone does not give you.
    let caught: any;

    // `finish` and `close` both fire on a normal response, in that order.
    let written = false;
    const write = () => {
      if (written) return;
      written = true;
      this.logCompleted(
        req,
        res,
        requestId,
        clientIp,
        userAgent,
        bodySize,
        startNs,
        caught,
      );
    };
    res.once('finish', write);
    res.once('close', write);

    return next.handle().pipe(
      catchError((err) => {
        caught = err;
        return throwError(() => err);
      }),
    );
  }

  /**
   * Probes and scrapes hit these paths every few seconds per replica, and none
   * of them says anything about the service that its own metrics do not.
   *
   * The `/v1` strip is what makes this actually work: main.ts sets a global
   * prefix, so the same endpoints arrive here as `/v1/health` and `/v1/metrics`
   * — while `/metrics` is (deliberately) also served outside the prefix, and
   * the worker's standalone listener uses the bare form. Matching the literal
   * `/metrics` alone, as this did before, skipped none of them.
   */
  private shouldSkip(url: string): boolean {
    const path = url.split('?')[0];
    const bare = path.startsWith('/v1/') ? path.slice(3) : path;

    if (this.SKIP_PATHS.has(bare)) return true;

    // Covers /health plus the /health/live and /health/ready split.
    return bare === '/health' || bare.startsWith('/health/');
  }

  // ─────────────────────────────────────────────────────────────────────────
  private logCompleted(
    req: Request,
    res: Response,
    requestId: string,
    ip: string,
    userAgent: string,
    bodySize: number,
    startNs: bigint,
    err?: any,
  ) {
    const durationMs = Number((process.hrtime.bigint() - startNs) / 1_000_000n);

    // res.statusCode is final here — the exception filter has already written.
    const statusCode = res.statusCode ?? err?.status ?? err?.statusCode ?? 200;

    // Route pattern — e.g. /v1/forms/:id (more useful than /v1/forms/abc-uuid)
    const routePattern = (req as any).route?.path ?? req.url;

    const contentLength =
      parseInt(res.getHeader('content-length') as string, 10) || undefined;

    // Read at completion rather than at entry: guards populate req.user, and on
    // a route where authentication happens in a guard the value is only settled
    // by the time the response is finished.
    const userId = (req as any).user?.sub ?? undefined;

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

    this.logger.log(level, 'HTTP request', {
      context: 'HTTP',
      requestId,
      method: req.method,
      url: req.url,
      routePattern,
      statusCode,
      durationMs,
      bodySize: bodySize || undefined,
      contentLength,
      ip,
      userAgent: userAgent ? userAgent.slice(0, 120) : undefined,
      userId,
      slowRequest: slowRequest || undefined, // Only include if true
      errorMessage: err?.message ?? undefined,
    });
  }
}
