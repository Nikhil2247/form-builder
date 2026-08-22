import {
  Injectable,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AppLogger } from '../logger/app-logger.service';
import { MetricsService } from './metrics.service';
import { QUEUE_NAMES } from '../../../config/bullmq.config';
import { intEnv } from '../../../config/env';

/** The states worth alerting on. `completed` is unbounded history, not a depth signal. */
const OBSERVED_STATES = ['waiting', 'active', 'delayed', 'failed'] as const;

/**
 * Samples BullMQ queue depth on a timer.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why a timer and not a scrape-time `collect()` hook ────────────────────
 * `getJobCounts` is four Redis round trips per queue, twelve in total. Hanging
 * those off the /metrics render would make the scrape's latency — and its
 * success — a function of Redis health, so a Redis blip would produce an empty
 * scrape and take the *node* metrics down with it, at the moment they are most
 * needed. A fixed 10s interval also decouples cost from scrape frequency: two
 * Prometheus replicas scraping the same target no longer doubles the Redis
 * load. The gauges are then at most one interval stale, which is nothing next
 * to the queue-depth timescales anyone alerts on.
 *
 * ── Why only in worker mode ───────────────────────────────────────────────
 * Queue depth is a property of the queue, not of the process reading it, so
 * every pod that exported it would report the same number and every query would
 * need `max by (queue)` to avoid multiplying the backlog by the replica count.
 * The worker is the natural owner: it is the process whose autoscaler keys on
 * this number, and keeping the poll off the API pods keeps a Redis stall away
 * from the latency-sensitive event loop. Multiple worker replicas still report
 * the same value, so dashboards should use `max by (queue) (bullmq_queue_jobs)`.
 */
@Injectable()
export class QueueMetricsCollector
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private timer?: NodeJS.Timeout;
  private sampling = false;

  /** Only log the transition into and out of failure, never every tick. */
  private failing = false;

  private readonly queues: ReadonlyArray<{ name: string; queue: Queue }>;

  constructor(
    private readonly logger: AppLogger,
    private readonly metrics: MetricsService,
    @InjectQueue(QUEUE_NAMES.SUBMISSIONS) submissions: Queue,
    @InjectQueue(QUEUE_NAMES.WEBHOOKS) webhooks: Queue,
    @InjectQueue(QUEUE_NAMES.FILE_VERIFY) fileVerify: Queue,
  ) {
    this.logger.setContext(QueueMetricsCollector.name);
    this.queues = [
      { name: QUEUE_NAMES.SUBMISSIONS, queue: submissions },
      { name: QUEUE_NAMES.WEBHOOKS, queue: webhooks },
      { name: QUEUE_NAMES.FILE_VERIFY, queue: fileVerify },
    ];
  }

  onApplicationBootstrap(): void {
    const intervalMs = intEnv('METRICS_QUEUE_SCRAPE_INTERVAL_MS', 10_000);

    // Sample once immediately so the gauges are not absent for the first
    // interval — an absent series and a zero-depth series look very different
    // to an alert rule.
    void this.sample();

    this.timer = setInterval(() => void this.sample(), intervalMs);
    // An open interval is a handle the event loop counts. Without unref a
    // SIGTERM'd worker that has drained its jobs would sit here until the timer
    // is cleared, turning a fast shutdown into a ten-second one.
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async sample(): Promise<void> {
    // A Redis stall makes each tick outlive its interval. Without this guard the
    // pending samples pile up and every one of them retries on a connection
    // that is already struggling.
    if (this.sampling) return;
    this.sampling = true;

    try {
      let anyFailed = false;

      for (const { name, queue } of this.queues) {
        try {
          const counts = await queue.getJobCounts(...OBSERVED_STATES);
          for (const state of OBSERVED_STATES) {
            this.metrics.setQueueDepth(name, state, counts[state] ?? 0);
          }
        } catch (err) {
          anyFailed = true;
          // Deliberately leave the gauges at their last value rather than
          // zeroing them: a failed read means "unknown", and a queue that
          // suddenly reads zero is indistinguishable from one that drained.
          // bullmq_queue_scrape_failures_total is how you tell them apart.
          this.metrics.recordQueueScrapeFailure(name);
          if (!this.failing) {
            this.logger.warn(
              `Queue depth scrape failed for ${name}; gauges are now stale.`,
              {
                queue: name,
                errorMessage: err instanceof Error ? err.message : String(err),
              },
            );
          }
        }
      }

      if (anyFailed !== this.failing) {
        if (!anyFailed) this.logger.info('Queue depth scrape recovered.');
        this.failing = anyFailed;
      }
    } finally {
      this.sampling = false;
    }
  }
}
