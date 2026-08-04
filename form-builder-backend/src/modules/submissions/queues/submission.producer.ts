import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES, defaultJobOptions } from '../../../config/bullmq.config';

export interface SubmissionPayload {
  submissionId: string;
  formId: string;
  answers: Record<string, any>;
  completionTimeMs: number;
  respondentIp: string;
  userAgent?: string;
  respondentId?: string;
  submittedAt: string;
}

@Injectable()
export class SubmissionProducer {
  constructor(@InjectQueue(QUEUE_NAMES.SUBMISSIONS) private readonly queue: Queue<SubmissionPayload>) {}

  async enqueue(payload: SubmissionPayload): Promise<void> {
    await this.queue.add('process-submission', payload, {
      ...defaultJobOptions,
      jobId: payload.submissionId, // Idempotent job ID prevents duplicate processing
    });
  }
}
