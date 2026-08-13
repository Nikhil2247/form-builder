import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  EXPORTS_QUEUE,
  EXPORT_RUN_JOB,
  EXPORT_SWEEP_JOB,
  EXPORT_SWEEP_SCHEDULER_ID,
} from './export-queue.constants';

export interface ExportJobPayload {
  /** Primary key of the ExportJob row. Everything else is read from it. */
  exportJobId: string;
  /** Denormalised purely so worker log lines identify the tenant without a query. */
  organizationId: string;
}

/**
 * Default retry policy for an export run.
 *
 * Fewer attempts than `defaultJobOptions` (5) and a much longer backoff. An
 * export that fails is usually failing for a reason that a fast retry cannot
 * fix — the database is under load, or object storage is refusing writes — and
 * each attempt re-reads every row from the beginning and re-uploads every byte.
 * Retrying that five times in six seconds turns one struggling export into five
 * simultaneous full-table scans.
 */
const EXPORT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 30_000 },
  // Keep completions briefly for operational visibility, keep failures until
  // someone looks at them — the ExportJob row already carries the user-facing
  // outcome, so the BullMQ record exists for operators, not for the dashboard.
  removeOnComplete: { count: 200 },
  removeOnFail: false,
};

@Injectable()
export class ExportProducer implements OnModuleInit {
  private readonly logger = new Logger(ExportProducer.name);

  constructor(@InjectQueue(EXPORTS_QUEUE) private readonly queue: Queue) {}

  /**
   * Register the retention sweep schedule.
   *
   * Runs on every process that has the queue, not only workers, and that is
   * safe: `upsertJobScheduler` is keyed by scheduler id, so N pods calling it
   * converge on one schedule rather than N. Doing it here rather than only in
   * the worker means the schedule exists as soon as *anything* boots — a
   * deployment that scaled its workers to zero overnight still has a sweep
   * waiting when they come back, instead of silently retaining response data
   * until someone notices.
   */
  async onModuleInit(): Promise<void> {
    const pattern = process.env.EXPORT_SWEEP_CRON ?? '17 * * * *';

    try {
      await this.queue.upsertJobScheduler(
        EXPORT_SWEEP_SCHEDULER_ID,
        { pattern },
        {
          name: EXPORT_SWEEP_JOB,
          data: {},
          opts: {
            // One attempt. The sweep is idempotent and runs again within the
            // hour; retrying a failed sweep immediately just means two of them
            // race over the same objects for no benefit.
            attempts: 1,
            removeOnComplete: { count: 24 },
            removeOnFail: { count: 24 },
          },
        },
      );
      this.logger.log(`Export retention sweep scheduled (${pattern}).`);
    } catch (err) {
      // Never fatal. Redis may legitimately be unavailable during a rolling
      // start, and an API pod that cannot register a schedule must still serve
      // traffic — the next pod to boot, or the next restart, upserts it again.
      this.logger.warn(
        `Could not register the export retention sweep schedule: ${(err as Error).message}`,
      );
    }
  }

  async enqueue(payload: ExportJobPayload): Promise<void> {
    await this.queue.add(EXPORT_RUN_JOB, payload, {
      ...EXPORT_JOB_OPTIONS,
      // The ExportJob row id is the natural idempotency key: a double-submitted
      // POST that somehow produced one row must never produce two uploads of
      // the same file into the same object key.
      jobId: `export:${payload.exportJobId}`,
    });
  }
}
