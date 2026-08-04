import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SubmissionsController } from './submissions.controller';
import { SubmissionsService } from './submissions.service';
import { SubmissionProducer } from './queues/submission.producer';
import { SubmissionProcessor } from './queues/submission.processor';
import { PrismaService } from '../../common/prisma/prisma.service';
import { QUEUE_NAMES } from '../../config/bullmq.config';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: QUEUE_NAMES.SUBMISSIONS },
      { name: QUEUE_NAMES.WEBHOOKS }
    ),
  ],
  controllers: [SubmissionsController],
  providers: [SubmissionsService, SubmissionProducer, SubmissionProcessor, PrismaService],
  exports: [SubmissionsService],
})
export class SubmissionsModule {}
