import { Controller, Get, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../auth/public.decorator';
import { MetricsService } from './metrics.service';

/**
 * Prometheus scrape endpoint.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Three global behaviours have to be switched off here, and each of them would
 * break the endpoint in a different way:
 *
 *  • @SkipThrottle — the global ThrottlerGuard buckets by client IP. Every
 *    scrape comes from the same Prometheus pod, so a busy cluster would burn
 *    the 100/min bucket and the endpoint would start returning 429s: metrics
 *    would go blind exactly when there is most to look at.
 *
 *  • @Public — JwtAuthGuard is not global today, but it is the kind of thing
 *    that gets promoted to global later. Saying "no authentication" explicitly
 *    means that change cannot silently take the scrape target down. Nothing
 *    here is tenant data — it is counters and latency histograms keyed by route
 *    pattern — but the endpoint should still be reachable only from inside the
 *    cluster (a NetworkPolicy, or the worker's METRICS_PORT listener, which is
 *    not published in the Service).
 *
 *  • @Res() — ResponseInterceptor wraps every returned value in
 *    `{ data, meta }`. Prometheus's exposition format is line-oriented text,
 *    not JSON, so a wrapped body is unparseable. Taking the raw response object
 *    (without `passthrough`) makes Nest skip its own response handling, and the
 *    interceptor's mapped value is discarded.
 *
 * Logging is handled on the other side: HttpLoggingInterceptor lists both
 * `/metrics` and `/v1/metrics` in SKIP_PATHS, so a 15-second scrape does not
 * become 5 760 log lines a day.
 */
@ApiExcludeController()
@SkipThrottle()
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Public()
  @Get()
  async scrape(@Res() res: Response): Promise<void> {
    const { body, contentType } = await this.metrics.render();
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-store');
    res.send(body);
  }
}
