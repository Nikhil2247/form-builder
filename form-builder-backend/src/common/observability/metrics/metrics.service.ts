import {
  Injectable,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { createServer } from 'http';
import type { Server } from 'http';
import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from 'prom-client';
import { AppLogger } from '../logger/app-logger.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { getProcessRole, isApiMode } from '../../../config/runtime.config';
import { intEnv } from '../../../config/env';

/**
 * MetricsService — the single Prometheus registry for this process.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Everything that is exported lives on ONE registry owned by this service, not
 * on prom-client's module-global default registry. That matters for two
 * reasons. Metric objects register themselves with their registry at
 * construction and prom-client throws on a duplicate name, so a global registry
 * turns a second instantiation — a Jest suite that builds two testing modules,
 * a module accidentally listed in two `providers` arrays — into a hard crash at
 * DI time rather than a harmless duplicate. And a private registry means a
 * library that quietly writes to the default registry cannot inject series into
 * our scrape output.
 *
 * ── Label cardinality is the thing to be careful about ─────────────────────
 * Every distinct label combination is a separate time series held in memory
 * here and stored forever in Prometheus. So HTTP requests are labelled by ROUTE
 * PATTERN (`/v1/forms/:formId`), never by URL — see HttpMetricsInterceptor,
 * which collapses anything it cannot match to a single `unmatched` bucket. The
 * same rule governs queue and job labels: queue names and job names are
 * compile-time constants, never user input.
 *
 * ── Both process roles export metrics ──────────────────────────────────────
 * The worker (`src/worker.ts`) is an application *context* with no HTTP
 * adapter, so the `/metrics` controller does not exist there — and the worker
 * is precisely the process that owns queue depth and job durations. It
 * therefore starts its own bare `http.createServer` on METRICS_PORT
 * (default 9464). A second Nest HTTP adapter would drag in the whole global
 * pipeline (guards, throttler, response envelope) for one text endpoint.
 */
@Injectable()
export class MetricsService implements OnApplicationBootstrap, OnModuleDestroy {
  /** The one registry. Exposed so the controller and the worker listener can render it. */
  readonly registry = new Registry();

  private workerServer?: Server;

  // ── HTTP ──────────────────────────────────────────────────────────────────
  private readonly httpDuration: Histogram<'method' | 'route' | 'status_code'>;
  private readonly httpInFlight: Gauge<string>;

  // ── BullMQ ────────────────────────────────────────────────────────────────
  private readonly queueJobs: Gauge<'queue' | 'state'>;
  private readonly queueScrapeFailures: Counter<'queue'>;
  private readonly jobDuration: Histogram<'queue' | 'job_name' | 'status'>;

  constructor(
    private readonly logger: AppLogger,
    private readonly prisma: PrismaService,
  ) {
    this.logger.setContext(MetricsService.name);

    // `process_role` distinguishes the API and worker series of a metric that
    // both roles export (default metrics, Prisma pool). Prometheus's own
    // `instance` label would too, but only if the two roles are scraped as
    // separate targets — which is a deployment detail we should not depend on.
    this.registry.setDefaultLabels({ process_role: getProcessRole() });

    // Node runtime metrics: event-loop lag, heap, GC, handles, fds. These are
    // collected at scrape time (prom-client v15 has no background timer), so
    // they cost nothing between scrapes.
    collectDefaultMetrics({ register: this.registry });

    this.httpDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request latency, from the start of the Nest interceptor chain to the last byte written.',
      labelNames: ['method', 'route', 'status_code'] as const,
      // Tuned for an API whose p50 is a single indexed query and whose slow tail
      // is the CSV export. The 0.5s and 2s edges line up with the slow-request
      // thresholds in HttpLoggingInterceptor, so a latency alert and a slow-log
      // entry always agree about what counts as slow.
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    });

    this.httpInFlight = new Gauge({
      name: 'http_requests_in_flight',
      help: 'HTTP requests currently being handled by this process.',
      registers: [this.registry],
    });

    this.queueJobs = new Gauge({
      name: 'bullmq_queue_jobs',
      help: 'Jobs per BullMQ queue by state, sampled on an interval (see QueueMetricsCollector).',
      labelNames: ['queue', 'state'] as const,
      registers: [this.registry],
    });

    this.queueScrapeFailures = new Counter({
      name: 'bullmq_queue_scrape_failures_total',
      help: 'Failed attempts to read job counts from Redis. A rising count means the depth gauges are stale, not zero.',
      labelNames: ['queue'] as const,
      registers: [this.registry],
    });

    this.jobDuration = new Histogram({
      name: 'bullmq_job_duration_seconds',
      help: 'Time a job spent being processed (BullMQ processedOn → finishedOn), excluding time spent waiting in the queue.',
      labelNames: ['queue', 'job_name', 'status'] as const,
      // Much wider than the HTTP buckets: webhook delivery has a 10s-ish
      // network timeout and file verification waits on object storage, so a
      // 30s job is slow but not broken.
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300],
      registers: [this.registry],
    });

    this.registerPrismaPoolGauges();
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Prisma connection-pool saturation
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Pool gauges read straight from the pg pools that back the driver adapter,
   * via `PrismaService.poolStats()`.
   *
   * WHY NOT `$metrics.json()`: that was the documented route and it is gone.
   * `$metrics` was a feature of the Rust query engine, and Prisma 7 removed the
   * engine in favour of the in-process query compiler — the generated client in
   * this repo has no `$metrics` member at all (and the schema declares no
   * `metrics` preview feature to bring one back). Rather than ship a runtime
   * feature-detect that can only ever take the "unavailable" branch, we read the
   * pool we now own directly. It is the same information, one property access
   * deep, with no engine round trip. If a future Prisma restores `$metrics`,
   * this is the place to prefer it.
   *
   * These use prom-client's `collect()` hook instead of an interval: pool
   * counters are plain in-memory integers, so sampling them at scrape time is
   * both cheaper and fresher than polling. Queue depth deliberately does NOT
   * work this way — see QueueMetricsCollector.
   */
  private registerPrismaPoolGauges(): void {
    const connections = new Gauge({
      name: 'prisma_pool_connections',
      help: "Connections held by this process's Prisma pools. Compare against prisma_pool_max_connections for saturation.",
      labelNames: ['client', 'state'] as const,
      registers: [this.registry],
      collect: () => {
        for (const stat of this.prisma.poolStats()) {
          connections.set({ client: stat.client, state: 'total' }, stat.total);
          connections.set({ client: stat.client, state: 'idle' }, stat.idle);
        }
      },
    });

    const pending = new Gauge({
      name: 'prisma_pool_pending_requests',
      help: 'Queries waiting for a free connection. Sustained non-zero means the pool, not the database, is the bottleneck.',
      labelNames: ['client'] as const,
      registers: [this.registry],
      collect: () => {
        for (const stat of this.prisma.poolStats()) {
          pending.set({ client: stat.client }, stat.waiting);
        }
      },
    });

    const max = new Gauge({
      name: 'prisma_pool_max_connections',
      help: 'Configured pool ceiling (DB_POOL_MAX) per client.',
      labelNames: ['client'] as const,
      registers: [this.registry],
      collect: () => {
        for (const stat of this.prisma.poolStats()) {
          max.set({ client: stat.client }, stat.max);
        }
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Recording API — called from the interceptor, the collector, the processors
  // ─────────────────────────────────────────────────────────────────────────

  observeHttpRequest(
    method: string,
    route: string,
    statusCode: number,
    durationSeconds: number,
  ): void {
    this.httpDuration.observe(
      { method, route, status_code: String(statusCode) },
      durationSeconds,
    );
  }

  incHttpInFlight(): void {
    this.httpInFlight.inc();
  }

  decHttpInFlight(): void {
    this.httpInFlight.dec();
  }

  setQueueDepth(queue: string, state: string, value: number): void {
    this.queueJobs.set({ queue, state }, value);
  }

  recordQueueScrapeFailure(queue: string): void {
    this.queueScrapeFailures.inc({ queue });
  }

  /**
   * Record how long a job took to process.
   *
   * `processedOn`/`finishedOn` are set by BullMQ itself, so this measures the
   * worker's own handling time and excludes queue wait — which is the number
   * you want when deciding whether to raise concurrency (job slow) or add
   * replicas (queue deep). A job with no `processedOn` never entered a
   * processor (it was removed, or failed at fetch), and is not a data point.
   */
  observeJob(
    queue: string,
    job:
      | {
          name?: string;
          processedOn?: number | null;
          finishedOn?: number | null;
        }
      | undefined,
    status: 'completed' | 'failed',
  ): void {
    if (!job?.processedOn) return;
    // A job that failed its final attempt can be reported before BullMQ stamps
    // finishedOn; falling back to now is off by microseconds, not by a bucket.
    const finishedOn = job.finishedOn ?? Date.now();
    this.jobDuration.observe(
      { queue, job_name: job.name ?? 'unknown', status },
      (finishedOn - job.processedOn) / 1000,
    );
  }

  /** Rendered exposition text plus its content type, for whichever listener serves it. */
  async render(): Promise<{ body: string; contentType: string }> {
    return {
      body: await this.registry.metrics(),
      contentType: this.registry.contentType,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Worker-only HTTP listener
  // ─────────────────────────────────────────────────────────────────────────

  onApplicationBootstrap(): void {
    // In `api` and `combined` roles the Nest HTTP server already routes
    // /metrics through MetricsController; a second listener would export the
    // same registry twice and double-count in any query that sums over targets.
    if (isApiMode()) return;
    this.startWorkerMetricsServer();
  }

  private startWorkerMetricsServer(): void {
    const port = intEnv('METRICS_PORT', 9464);

    const server = createServer((req, res) => {
      const path = (req.url ?? '/').split('?')[0];

      // Both spellings are accepted so one scrape config can target the API
      // (which may or may not sit behind the global `v1` prefix) and the worker.
      if (
        req.method !== 'GET' ||
        (path !== '/metrics' && path !== '/v1/metrics')
      ) {
        res.statusCode = 404;
        res.end('Not found\n');
        return;
      }

      this.render()
        .then(({ body, contentType }) => {
          res.statusCode = 200;
          res.setHeader('Content-Type', contentType);
          res.setHeader('Cache-Control', 'no-store');
          res.end(body);
        })
        .catch((err) => {
          // Never let a rendering failure take the worker down: this listener
          // exists to observe the process, not to be a dependency of it.
          this.logger.error('Failed to render metrics', err);
          res.statusCode = 500;
          res.end('metrics rendering failed\n');
        });
    });

    // A port clash must not kill the worker. Queue processing is the job;
    // metrics are diagnostics, and a crash-looping worker is a far worse
    // outcome than a target that fails to scrape.
    server.on('error', (err) => {
      this.logger.error(`Metrics listener failed on port ${port}`, err);
    });

    server.listen(port, () => {
      this.logger.info(
        `Metrics listener started on :${port}/metrics (role=${getProcessRole()}).`,
      );
    });

    this.workerServer = server;
  }

  async onModuleDestroy(): Promise<void> {
    const server = this.workerServer;
    if (!server) return;
    this.workerServer = undefined;

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      // Prometheus scrapes over keep-alive, so `close()` alone waits for an
      // idle connection that will not close on its own — which would stall
      // SIGTERM handling until the kubelet's grace period expires and turns a
      // clean drain into a SIGKILL mid-job.
      server.closeAllConnections();
    });

    this.logger.info('Metrics listener closed.');
  }
}
