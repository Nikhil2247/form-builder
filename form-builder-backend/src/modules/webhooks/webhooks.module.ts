import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { WebhooksProcessor } from './queues/webhooks.processor';
import { QUEUE_NAMES } from '../../config/bullmq.config';
import { isWorkerMode } from '../../config/runtime.config';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.WEBHOOKS })],
  controllers: [WebhooksController],
  providers: [WebhooksService, ...(isWorkerMode() ? [WebhooksProcessor] : [])],
  exports: [WebhooksService],
})
export class WebhooksModule {}
