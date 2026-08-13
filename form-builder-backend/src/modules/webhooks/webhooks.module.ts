import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { WebhooksProcessor } from './queues/webhooks.processor';
import { QUEUE_NAMES } from '../../config/bullmq.config';
import { isWorkerMode } from '../../config/runtime.config';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  // NotificationsModule is imported unconditionally even though only the
  // processor uses it, because `imports` cannot depend on which providers were
  // registered — and an import that is present in one PROCESS_ROLE and absent
  // in another is exactly the kind of asymmetry that boots fine in dev
  // (`combined`) and fails at startup on the worker deployment.
  imports: [
    BullModule.registerQueue({ name: QUEUE_NAMES.WEBHOOKS }),
    NotificationsModule,
  ],
  controllers: [WebhooksController],
  providers: [WebhooksService, ...(isWorkerMode() ? [WebhooksProcessor] : [])],
  exports: [WebhooksService],
})
export class WebhooksModule {}
