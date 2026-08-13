import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '../../config/bullmq.config';

/**
 * Read-only Queue handles for observability.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Two consumers need to talk to every queue without producing or consuming
 * jobs: the readiness probe (is the queue's Redis reachable?) and the depth
 * gauges (how far behind is the worker?). Both are declared here rather than in
 * their own modules because of how `BullModule.registerQueue` scopes providers.
 *
 * A queue provider belongs to the dynamic module that registered it, and Nest
 * keys a dynamic module by a hash of its definition. Two modules registering
 * the same queue with different argument lists therefore get two *different*
 * `Queue` objects — and each `Queue` opens its own ioredis socket, because
 * BullMQ builds a connection per instance from the plain options object in
 * `bullmq.config.ts`. (That is already true today: SubmissionsModule and
 * WebhooksModule both register WEBHOOKS.) Registering once here and exporting
 * the dynamic module means health and metrics share three sockets rather than
 * opening six.
 *
 * Passing the shared ioredis client from RedisService instead was the obvious
 * alternative and is a trap: BullMQ v6 never sets its internal `shared` flag,
 * so `queue.close()` during shutdown calls `quit()` on whatever connection it
 * was handed — taking the application cache down with it.
 */
const OBSERVED_QUEUES = BullModule.registerQueue(
  { name: QUEUE_NAMES.SUBMISSIONS },
  { name: QUEUE_NAMES.WEBHOOKS },
  { name: QUEUE_NAMES.FILE_VERIFY },
);

@Module({
  imports: [OBSERVED_QUEUES],
  exports: [OBSERVED_QUEUES],
})
export class ObservedQueuesModule {}
