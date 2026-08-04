import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { WebhooksProcessor } from './queues/webhooks.processor';
import { PrismaService } from '../../common/prisma/prisma.service';
import { QUEUE_NAMES } from '../../config/bullmq.config';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_NAMES.WEBHOOKS }),
  ],
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhooksProcessor, PrismaService],
  exports: [WebhooksService],
})
export class WebhooksModule {}
