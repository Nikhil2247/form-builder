import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import type { Request, Response } from 'express';
import { MetricsService } from './metrics.service';

/**
 * Per-request latency, status and concurrency for the HTTP metrics.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why the route PATTERN and nothing else ────────────────────────────────
 * `req.url` is unusable as a label. `/v1/forms/9f3c…` is a distinct value for
 * every form, so a week of traffic against a few thousand forms leaves
 * Prometheus holding a few thousand dead series per status code and method —
 * the classic cardinality explosion that makes a metrics stack fall over long
 * before the service does. Express fills `req.route.path` with the pattern the
 * router matched (`/v1/forms/:formId`), which is bounded by the number of
 * routes the app declares. Anything without one collapses to the single
 * literal `unmatched`, because an unbounded fallback is exactly the bug we are
 * avoiding.
 *
 * ── Why response events rather than rxjs tap/catchError ───────────────────
 * `tap` fires when the handler's observable completes, which is before the
 * exception filter has chosen a status code and before the body has been
 * serialised and flushed. Reading `res.statusCode` there records a 200 for a
 * request that goes on to be a 500, and the duration misses serialisation
 * entirely — which is most of the cost of the submissions export. `finish`
 * fires after the last byte is written and `close` catches a client that hung
 * up mid-response; both are guarded so only the first one counts.
 *
 * ── Known blind spot ──────────────────────────────────────────────────────
 * Nest runs guards BEFORE interceptors, so a request rejected by ThrottlerGuard
 * (429) or by an auth guard (401) never reaches this code and is not counted.
 * Nor is a 404 for a path that matched no route, which the router rejects
 * before the pipeline. If those need to be measured, the recorder has to move
 * to an Express middleware in main.ts — the same `res.on('finish')` body works
 * there unchanged. Noted in WIRING-observability.md.
 */
@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    // The scrape endpoint does not observe itself. Counting it would make every
    // dashboard's request rate a function of the scrape interval, and the
    // in-flight gauge would never read zero on an idle service.
    const path = (req.originalUrl ?? req.url ?? '').split('?')[0];
    if (path === '/metrics' || path === '/v1/metrics') return next.handle();

    const startNs = process.hrtime.bigint();
    this.metrics.incHttpInFlight();

    let recorded = false;
    const record = () => {
      if (recorded) return;
      recorded = true;

      this.metrics.decHttpInFlight();

      const durationSeconds = Number(process.hrtime.bigint() - startNs) / 1e9;
      // Read at completion, not at entry: `req.route` is populated by the time
      // the response finishes even when the handler threw.
      const route = (req as any).route?.path ?? 'unmatched';

      this.metrics.observeHttpRequest(
        req.method,
        route,
        res.statusCode,
        durationSeconds,
      );
    };

    res.once('finish', record);
    res.once('close', record);

    return next.handle();
  }
}
