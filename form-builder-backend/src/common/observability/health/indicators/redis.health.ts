import { Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import type { HealthIndicatorResult } from '@nestjs/terminus';
import { RedisService } from '../../../infra/redis/redis.service';
import { intEnv } from '../../../../config/env';
import { describeError, withDeadline } from './deadline';

/**
 * Redis readiness.
 *
 * Redis is not optional infrastructure here — it backs the cache, the rate
 * limiter, the queues and the session/refresh-token bookkeeping — so a pod that
 * cannot reach it cannot serve traffic and should leave the load balancer.
 *
 * PING rather than a read/write round trip on purpose: it needs no key, cannot
 * be affected by an eviction policy, and (unlike SET) still succeeds against a
 * read-only replica, which is a working Redis for our purposes even mid-failover.
 */
@Injectable()
export class RedisHealthIndicator {
  private readonly timeoutMs = intEnv('HEALTH_REDIS_TIMEOUT_MS', 2000);

  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly redis: RedisService,
  ) {}

  async isHealthy<Key extends string = string>(
    key: Key,
  ): Promise<HealthIndicatorResult<Key>> {
    const check = this.healthIndicatorService.check(key);
    const startedAt = Date.now();

    try {
      const reply = await withDeadline(
        this.redis.ping(),
        this.timeoutMs,
        'Redis PING',
      );
      const responseTimeMs = Date.now() - startedAt;

      // ioredis resolves PING even while the client is queueing commands during
      // a reconnect, so verify the reply itself rather than trusting resolution.
      if (reply !== 'PONG') {
        return check.down({
          responseTimeMs,
          message: `Unexpected PING reply: ${reply}`,
        });
      }

      return check.up({ responseTimeMs });
    } catch (err) {
      return check.down({ message: describeError(err) });
    }
  }
}
