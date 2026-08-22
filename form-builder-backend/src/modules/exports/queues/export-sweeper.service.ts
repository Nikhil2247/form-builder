import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../common/infra/prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { deleteExportObject } from '../logic/export-uploader';
import { resolveRetentionDays, resolveStaleRunningMs } from '../logic/export-policy';

/**
 * Retention sweeper for finished exports.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHY A SWEEPER AND NOT JUST A BUCKET LIFECYCLE RULE:
 *  A lifecycle rule deletes the object. It knows nothing about the row that
 *  points at it, so with only a lifecycle rule the dashboard keeps offering a
 *  download button for a file that no longer exists, and the user finds out by
 *  clicking it and getting an opaque storage error. The sweeper is what keeps
 *  the two in step: object gone, status EXPIRED, UI says "expired, run it
 *  again".
 *
 * WHY A BUCKET LIFECYCLE RULE AND NOT JUST A SWEEPER:
 *  Because a sweeper is code, and code stops running. A worker deployment
 *  scaled to zero, a Redis flush that drops the schedule, a queue renamed in a
 *  refactor — none of those raise an alarm, and the visible symptom is nothing
 *  at all. Meanwhile every export ever run is still sitting in the bucket:
 *  complete copies of every tenant's response data, indefinitely, which is
 *  precisely the outcome the retention window exists to prevent. The lifecycle
 *  rule is the layer that does not depend on this process being alive. See
 *  WIRING-exports.md for the rule the operator must configure.
 *
 * WHY A BULLMQ REPEATABLE JOB RATHER THAN @nestjs/schedule:
 *  1. @nestjs/schedule fires in-process on EVERY replica. Three worker pods
 *     means three sweeps starting at the same instant, racing to delete the
 *     same objects and to flip the same rows — the deletes are idempotent, but
 *     the work is triplicated and the logs become useless. BullMQ's job
 *     scheduler is keyed in Redis, so the tick is claimed by exactly one worker
 *     however many are running.
 *  2. It is one more dependency for a capability the codebase already has.
 *     Every other background task here is a BullMQ job; a second, unrelated
 *     scheduling mechanism means two places to look when something does not run.
 *  3. The schedule survives restarts and deploys because it lives in Redis, not
 *     in a process's memory. An in-process cron that has never fired since the
 *     last deploy looks identical to one that is working.
 */
@Injectable()
export class ExportSweeper {
  private readonly logger = new Logger(ExportSweeper.name);

  /**
   * Rows per sweep.
   *
   * Bounded because each row is a network round trip to object storage. An
   * unbounded sweep after a long outage would hold the worker for however long
   * the backlog takes and block every queued export behind it; the sweep runs
   * hourly, so a backlog simply drains over several ticks.
   */
  private static readonly BATCH_SIZE = 200;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async sweep(
    now: Date = new Date(),
  ): Promise<{ expired: number; reaped: number }> {
    const expired = await this.expireCompleted(now);
    const reaped = await this.failStaleRunning(now);

    if (expired || reaped) {
      this.logger.log(
        `Export sweep: expired ${expired} stored export(s), failed ${reaped} stale job(s).`,
      );
    }
    return { expired, reaped };
  }

  /** Delete objects past retention and mark their rows EXPIRED. */
  private async expireCompleted(now: Date): Promise<number> {
    const due = await this.prisma.reader.exportJob.findMany({
      where: { status: 'COMPLETED', expiresAt: { lte: now } },
      select: { id: true, organizationId: true, objectKey: true, bytes: true },
      // Matches @@index([status, expiresAt]).
      orderBy: { expiresAt: 'asc' },
      take: ExportSweeper.BATCH_SIZE,
    });

    let swept = 0;

    for (const job of due) {
      if (job.objectKey) {
        try {
          await deleteExportObject(job.objectKey);
        } catch (err) {
          // Storage refused the delete for a reason other than "already gone"
          // (deleteExportObject treats absence as success). Leave the row
          // COMPLETED so the next tick tries again — flipping it to EXPIRED
          // here would mean the object is never revisited and lives forever,
          // which is the exact failure this job exists to prevent.
          this.logger.warn(
            `Could not delete expired export object ${job.objectKey}: ${(err as Error).message}`,
          );
          continue;
        }
      }

      // Status is part of the WHERE clause, not just the WHERE id: if the row
      // moved on between the read above and here, this writes nothing rather
      // than resurrecting a stale state.
      const { count } = await this.prisma.writer.exportJob.updateMany({
        where: { id: job.id, status: 'COMPLETED' },
        data: { status: 'EXPIRED' },
      });
      if (count === 0) continue;

      swept++;

      // Retention deletion of tenant data is an auditable event in its own
      // right — "where did that file go?" must be answerable without reading
      // worker logs that have long since rotated.
      this.audit.log({
        organizationId: job.organizationId,
        action: 'export.expired',
        resource: 'export_job',
        resourceId: job.id,
        metadata: {
          objectKey: job.objectKey,
          bytes: job.bytes === null ? null : Number(job.bytes),
          retentionDays: resolveRetentionDays(),
        },
      });
    }

    return swept;
  }

  /**
   * Fail jobs that have been RUNNING implausibly long.
   *
   * A worker killed mid-upload — OOM, node drain, SIGKILL — never runs its
   * failure handler, so the row stays RUNNING forever and the dashboard shows a
   * progress bar that will never move again. BullMQ will have long since given
   * up on the job itself; nothing else will ever touch this row.
   */
  private async failStaleRunning(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - resolveStaleRunningMs());

    const { count } = await this.prisma.writer.exportJob.updateMany({
      where: { status: 'RUNNING', startedAt: { lt: cutoff } },
      data: {
        status: 'FAILED',
        error:
          'This export stopped unexpectedly and did not finish. Please run it again.',
      },
    });

    return count;
  }
}
