import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SubmissionsController } from './submissions.controller';
import { SubmissionsService } from './submissions.service';
import { SubmissionProducer } from './queues/submission.producer';
import { SubmissionProcessor } from './queues/submission.processor';
import { AnswerValidatorService } from './answer-validator.service';
import { QUEUE_NAMES } from '../../config/bullmq.config';
import { isWorkerMode } from '../../config/runtime.config';
import { ChoiceListsModule } from '../choice-lists/choice-lists.module';

/**
 * Queue processors are only registered when this process runs in worker mode
 * (or in the combined mode used for local development). API-only pods must not
 * pull jobs off the queue — otherwise a submission burst starves HTTP handling
 * on the same event loop and ingest capacity cannot scale independently.
 */
@Module({
  imports: [
    // Membership + cascade validation of list-backed answers, and the metadata
    // that lookup() reads. Imported rather than duplicated here so tenancy
    // rules for lists live in exactly one place.
    ChoiceListsModule,
    BullModule.registerQueue(
      { name: QUEUE_NAMES.SUBMISSIONS },
      { name: QUEUE_NAMES.WEBHOOKS },
      { name: QUEUE_NAMES.FILE_VERIFY },
    ),
  ],
  controllers: [SubmissionsController],
  providers: [
    SubmissionsService,
    SubmissionProducer,
    AnswerValidatorService,
    ...(isWorkerMode() ? [SubmissionProcessor] : []),
  ],
  // SubmissionProducer is exported so the form-app session submit can enqueue
  // post-processing for the submissions it creates, without a second queue.
  exports: [SubmissionsService, AnswerValidatorService, SubmissionProducer],
})
export class SubmissionsModule {}
