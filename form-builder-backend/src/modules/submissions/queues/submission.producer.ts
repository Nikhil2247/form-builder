import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES, defaultJobOptions } from '../../../config/bullmq.config';

export interface SubmissionPayload {
  submissionId: string;
  formId: string;
  /** Bound at ingest time — the worker must not re-resolve "newest version". */
  formVersionId: string;
  organizationId: string;
  answers: Record<string, any>;
  completionTimeMs: number;
  /**
   * Daily-salted SHA-256 of the respondent IP. The raw IP is hashed at the edge
   * and never travels through the queue or reaches storage (GDPR).
   */
  respondentIpHash: string;
  userAgent?: string;
  respondentId?: string;
  submittedAt: string;
  /**
   * Record this entry belongs to. Already verified against the form's org and
   * subject type by SubmissionsService — the worker treats it as trusted.
   */
  subjectId?: string | null;
}

@Injectable()
export class SubmissionProducer {
  constructor(
    @InjectQueue(QUEUE_NAMES.SUBMISSIONS) private readonly queue: Queue<SubmissionPayload>,
  ) {}

  async enqueue(payload: SubmissionPayload): Promise<void> {
    await this.queue.add('process-submission', payload, {
      ...defaultJobOptions,
      jobId: payload.submissionId, // Idempotent job ID prevents duplicate processing
    });
  }
}
