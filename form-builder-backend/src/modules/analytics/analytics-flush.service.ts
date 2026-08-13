import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { isWorkerMode } from '../../config/runtime.config';

/**
 * AnalyticsFlushService — drains Redis-buffered view/start counters into
 * FormAnalytics on a fixed interval.
 *
 * WHY BUFFER AT ALL:
 *  Form views are the highest-volume event in the system by an order of
 *  magnitude. An UPSERT per page load would make analytics the dominant write
 *  workload and put Postgres on the critical path of every public form render.
 *  These counters are a dashboard metric, not an audit record — a few seconds
 *  of lag is a fine trade for removing that write entirely.
 *
 * ONLY RUNS IN WORKER MODE so N API pods don't all flush the same keys.
 */
@Injectable()
export class AnalyticsFlushService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnalyticsFlushService.name);
  private timer: NodeJS.Timeout | null = null;

  private readonly intervalMs = parseInt(
    process.env.ANALYTICS_FLUSH_MS ?? '30000',
    10,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  onModuleInit() {
    if (!isWorkerMode()) return;

    this.timer = setInterval(() => {
      this.flush().catch((e) => this.logger.error('Analytics flush failed', e));
    }, this.intervalMs);

    // Don't hold the event loop open on shutdown.
    this.timer.unref?.();
    this.logger.log(`Analytics flush scheduled every ${this.intervalMs}ms`);
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    // Final drain so a rolling deploy doesn't discard buffered counts.
    await this.flush().catch(() => undefined);
  }

  /** Drain today's and yesterday's buckets (yesterday covers a UTC rollover). */
  async flush(): Promise<void> {
    const now = new Date();
    const days = [
      now.toISOString().slice(0, 10),
      new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10),
    ];

    for (const day of days) {
      await this.flushDay(day);
    }
  }

  private async flushDay(day: string) {
    const key = `analytics:pending:${day}`;
    const client = this.redis.getClient();

    // Atomically take the whole bucket: rename to a private key, read it, then
    // delete. Anything written after the rename lands in a fresh bucket, so no
    // increment is lost or double-counted.
    const workKey = `${key}:flushing`;
    try {
      const exists = await client.exists(key);
      if (!exists) return;
      await client.rename(key, workKey);
    } catch {
      return; // key vanished between EXISTS and RENAME — nothing to do
    }

    const entries = await client.hgetall(workKey);
    await client.del(workKey);

    if (!entries || Object.keys(entries).length === 0) return;

    // Collapse "formId:event" -> counts per form.
    const perForm = new Map<string, { views: number; starts: number }>();
    for (const [field, rawCount] of Object.entries(entries)) {
      const [formId, event] = field.split(':');
      const count = parseInt(rawCount, 10);
      if (!formId || !Number.isFinite(count)) continue;

      const bucket = perForm.get(formId) ?? { views: 0, starts: 0 };
      if (event === 'view') bucket.views += count;
      else if (event === 'start') bucket.starts += count;
      perForm.set(formId, bucket);
    }

    for (const [formId, { views, starts }] of perForm) {
      try {
        await this.prisma.writer.$executeRaw`
          INSERT INTO form_analytics (id, form_id, date, views, starts, submissions, sum_completion_ms, avg_completion_ms)
          VALUES (gen_random_uuid(), ${formId}::uuid, ${day}::date, ${views}, ${starts}, 0, 0, 0)
          ON CONFLICT (form_id, date) DO UPDATE SET
            views  = form_analytics.views  + EXCLUDED.views,
            starts = form_analytics.starts + EXCLUDED.starts
        `;
      } catch (e) {
        // A deleted form leaves an orphaned counter; drop it rather than
        // retrying forever.
        this.logger.warn(`Failed to flush analytics for form ${formId}`, e);
      }
    }

    this.logger.debug(
      `Flushed analytics for ${perForm.size} form(s) on ${day}`,
    );
  }
}
