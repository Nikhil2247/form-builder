import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { ObservedQueuesModule } from '../queues/observed-queues.module';
import { RedisHealthIndicator } from './indicators/redis.health';
import { QueueHealthIndicator } from './indicators/queue.health';
import { StorageHealthIndicator } from './indicators/storage.health';

/**
 * RedisService needs no import — RedisModule is @Global. The queue handles do,
 * and come from ObservedQueuesModule so the readiness probe and the depth
 * gauges share one set of connections rather than opening their own; see the
 * note in that file for why registering them per-consumer is expensive.
 */
@Module({
  imports: [TerminusModule, PrismaModule, ObservedQueuesModule],
  controllers: [HealthController],
  providers: [
    RedisHealthIndicator,
    QueueHealthIndicator,
    StorageHealthIndicator,
  ],
})
export class HealthModule {}
