import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { HealthIndicatorService } from '@nestjs/terminus';
import type { HealthIndicatorResult } from '@nestjs/terminus';
import { Queue } from 'bullmq';
import { QUEUE_NAMES } from '../../../config/bullmq.config';
import { intEnv } from '../../../config/env';
import { describeError, withDeadline } from './deadline';

/**
 * BullMQ reachability.
 *
 * Distinct from the plain Redis PING, and worth checking separately: the queues
 * connect with their own ioredis instances built from `bullmq.config.ts`, so
 * they can be pointed at a different server, be mid-reconnect, or fail BullMQ's
 * Redis version check while RedisService is perfectly happy. `getJobCounts`
 * exercises exactly the path the producers use — a real command against the
 * real queue keyspace on the real connection.
 *
 * WHY THIS IS A READINESS CONCERN FOR THE API TOO: submission ingest is
 * enqueue-then-acknowledge. An API pod that cannot enqueue cannot accept a
 * submission, so it has nothing useful to do with the traffic it is sent.
 *
 * The counts are reported in the probe body but deliberately do NOT affect the
 * verdict. Depth is a capacity signal, not a health signal — failing readiness
 * on a deep backlog would pull every replica out of the load balancer at
 * exactly the moment the backlog needs draining.
 */
@Injectable()
export class QueueHealthIndicator {
  private readonly timeoutMs = intEnv('HEALTH_QUEUE_TIMEOUT_MS', 2000);

  private readonly queues: ReadonlyArray<{ name: string; queue: Queue }>;

  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    @InjectQueue(QUEUE_NAMES.SUBMISSIONS) submissions: Queue,
    @InjectQueue(QUEUE_NAMES.WEBHOOKS) webhooks: Queue,
    @InjectQueue(QUEUE_NAMES.FILE_VERIFY) fileVerify: Queue,
  ) {
    this.queues = [
      { name: QUEUE_NAMES.SUBMISSIONS, queue: submissions },
      { name: QUEUE_NAMES.WEBHOOKS, queue: webhooks },
      { name: QUEUE_NAMES.FILE_VERIFY, queue: fileVerify },
    ];
  }

  async isHealthy<Key extends string = string>(
    key: Key,
  ): Promise<HealthIndicatorResult<Key>> {
    const check = this.healthIndicatorService.check(key);

    const results = await Promise.all(
      this.queues.map(async ({ name, queue }) => {
        try {
          const counts = await withDeadline(
            queue.getJobCounts('waiting', 'active'),
            this.timeoutMs,
            `Queue ${name}`,
          );
          return {
            name,
            ok: true,
            waiting: counts.waiting ?? 0,
            active: counts.active ?? 0,
          };
        } catch (err) {
          return { name, ok: false, error: describeError(err) };
        }
      }),
    );

    const unreachable = results.filter((r) => !r.ok);
    const detail = Object.fromEntries(
      results.map(({ name, ...rest }) => [name, rest]),
    );

    if (unreachable.length > 0) {
      return check.down({
        queues: detail,
        message: `Unreachable: ${unreachable.map((r) => r.name).join(', ')}`,
      });
    }

    return check.up({ queues: detail });
  }
}
