import { Global, Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { QueueMetricsCollector } from './queue-metrics.collector';
import { ObservedQueuesModule } from '../../infra/queues/observed-queues.module';
import { isWorkerMode } from '../../../config/runtime.config';

/**
 * MetricsModule
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * @Global for the same reason as RedisModule: MetricsService owns a registry
 * whose metric objects refuse to be constructed twice, and (in worker mode) an
 * HTTP listener bound to a fixed port. Listing it in a feature module's
 * `providers` would build a second instance and fail loudly at DI time. Import
 * it once in AppModule and inject MetricsService anywhere.
 *
 * The queue-depth collector is worker-only, mirroring the
 * `isWorkerMode() ? [Processor] : []` pattern the feature modules already use —
 * so ObservedQueuesModule and its three Redis connections are only pulled in on
 * the process that needs them. MetricsService itself, the /metrics endpoint and
 * the HTTP and Prisma metrics exist in every role.
 *
 * HttpMetricsInterceptor is intentionally NOT registered here as an
 * APP_INTERCEPTOR. Global interceptors run in registration order and the order
 * matters (see WIRING-observability.md), so it belongs in AppModule's providers
 * array where the whole chain is visible in one place, not hidden behind a
 * module import.
 */
@Global()
@Module({
  imports: [...(isWorkerMode() ? [ObservedQueuesModule] : [])],
  controllers: [MetricsController],
  providers: [
    MetricsService,
    ...(isWorkerMode() ? [QueueMetricsCollector] : []),
  ],
  exports: [MetricsService],
})
export class MetricsModule {}
