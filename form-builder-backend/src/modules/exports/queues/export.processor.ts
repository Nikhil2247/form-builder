import { Processor, WorkerHost } from '@nestjs/bullmq';
import { HttpException, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { Readable } from 'node:stream';
import type { ExportJob } from '@prisma/client';
import { PrismaService } from '../../../common/infra/prisma/prisma.service';
import { FormsService } from '../../forms/forms.service';
import { ExportProgressMeter } from '../export-progress';
import type { FrozenExportFilters } from '../export-filters';
import {
  exportContentType,
  exportObjectKey,
  retentionExpiryFrom,
  resolveRetentionDays,
} from '../export-policy';
import { deleteExportObject, uploadExportStream } from '../export-uploader';
import { ExportSweeper } from './export-sweeper.service';
import {
  EXPORTS_QUEUE,
  EXPORT_RUN_JOB,
  EXPORT_SWEEP_JOB,
} from './export-queue.constants';
import type { ExportJobPayload } from './export.producer';

/**
 * The row source. Structurally identical to `FormsService.exportSubmissions`
 * today, with an optional fourth parameter for row-level filters that the
 * method does not yet declare.
 *
 * Declared this way rather than by calling the method directly because filter
 * push-down is landing separately. `rowSourceSupportsFilters` probes for the
 * parameter at request time and rejects filtered requests until it exists, so
 * the extra argument here is either honoured or harmlessly ignored — it can
 * never produce a file that disagrees with its own frozen filters.
 */
type ExportRowSource = (
  orgId: string,
  formId: string,
  format: 'csv' | 'json',
  filters?: FrozenExportFilters,
) => Promise<AsyncGenerator<string>>;

/**
 * ExportProcessor
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Streams an export into object storage, out of band from any HTTP request.
 *
 * WHAT THIS FIXES:
 *  `GET /forms/:id/export` streams with a keyset cursor, so it no longer buffers
 *  the result set — but it still occupies one HTTP connection, one Node slot and
 *  one database cursor for the entire export. Load balancers do not care how
 *  efficient the stream is; a 60-second idle timeout cuts it off mid-row, and
 *  the client is left with a CSV that opens, parses, and is missing everything
 *  after the cut. Nothing about a truncated CSV announces itself.
 *
 * THE TWO INVARIANTS:
 *  1. NOTHING IS BUFFERED. The generator's chunks go into a Readable and
 *     straight out to a multipart upload. The worker's memory footprint is one
 *     batch of rows plus one upload part, whether the export is 200 rows or
 *     2 000 000.
 *  2. THE ROWS COME FROM THE EXISTING GENERATOR. `FormsService.exportSubmissions`
 *     is called, not reimplemented. That generator is where soft-deleted
 *     submissions are excluded and where the CSV encoding lives; a private copy
 *     here would be correct on the day it was written and silently wrong the
 *     first time either changed. If this ever stops reusing it, the async export
 *     and the synchronous one start disagreeing about what a form contains.
 *
 * Concurrency is low on purpose. Each running export holds a reader connection
 * and walks a whole submissions table; three at once already means three
 * concurrent large scans against a database that is also serving the API.
 */
@Processor(EXPORTS_QUEUE, { concurrency: 3 })
export class ExportProcessor extends WorkerHost {
  private readonly logger = new Logger(ExportProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly forms: FormsService,
    private readonly sweeper: ExportSweeper,
  ) {
    super();
  }

  async process(job: Job<ExportJobPayload>): Promise<void> {
    switch (job.name) {
      case EXPORT_RUN_JOB:
        await this.runExport(job);
        return;
      case EXPORT_SWEEP_JOB:
        await this.sweeper.sweep();
        return;
      default:
        // A job name this worker does not know cannot be retried into working.
        // Logging and returning drops it rather than filling the failed set.
        this.logger.warn(
          `Ignoring unknown job "${job.name}" on ${EXPORTS_QUEUE}.`,
        );
    }
  }

  private async runExport(job: Job<ExportJobPayload>): Promise<void> {
    const { exportJobId } = job.data;

    const exportJob = await this.prisma.reader.exportJob.findUnique({
      where: { id: exportJobId },
      include: { form: { select: { id: true, title: true } } },
    });

    if (!exportJob) {
      // The org, the form, or the job itself was deleted while queued. There is
      // nothing to produce and nothing to report to.
      this.logger.warn(`Export job ${exportJobId} no longer exists; dropping.`);
      return;
    }

    // Idempotence. A retry after a successful upload, or a duplicate delivery,
    // must not upload the file a second time or reset a completed row back to
    // RUNNING — the user may already be downloading it.
    if (exportJob.status === 'COMPLETED' || exportJob.status === 'EXPIRED') {
      this.logger.log(
        `Export ${exportJobId} is already ${exportJob.status}; nothing to do.`,
      );
      return;
    }

    const forms = await this.resolveFormsInScope(exportJob);
    if (forms.length === 0) {
      await this.markFailed(
        exportJobId,
        'The forms this export covers no longer exist. Nothing was exported.',
      );
      return;
    }

    await this.prisma.writer.exportJob.update({
      where: { id: exportJobId },
      data: {
        status: 'RUNNING',
        startedAt: exportJob.startedAt ?? new Date(),
        error: null,
      },
    });

    // Best-effort total for the progress bar. Deliberately NOT a copy of the
    // export's own predicate — that predicate lives in the row source and is
    // not exposed — so this is an upper bound, and the API clamps progress to
    // 100% rather than letting it read 118%.
    const rowsTotal = await this.prisma.reader.formSubmission.count({
      where: { formId: { in: forms.map((f) => f.id) } },
    });
    await this.prisma.writer.exportJob.update({
      where: { id: exportJobId },
      data: { rowsTotal },
    });

    const objectKey = exportObjectKey(
      exportJob.organizationId,
      exportJob.id,
      exportJob.format,
    );
    const meter = new ExportProgressMeter(exportJob.format);

    try {
      // objectMode: false is what makes this a byte stream rather than a stream
      // of JS strings. In object mode the S3 uploader receives strings it cannot
      // length-count and the MinIO client rejects the chunk outright.
      const body = Readable.from(this.encodedExport(exportJob, forms, meter), {
        objectMode: false,
      });

      const { bucket, provider } = await uploadExportStream(
        objectKey,
        exportContentType(exportJob.format),
        body,
      );

      const completedAt = new Date();
      const expiresAt = retentionExpiryFrom(completedAt);

      await this.prisma.writer.exportJob.update({
        where: { id: exportJobId },
        data: {
          status: 'COMPLETED',
          objectKey,
          provider,
          bytes: meter.bytes,
          rowsWritten: meter.records,
          completedAt,
          expiresAt,
          error: null,
        },
      });

      this.logger.log(
        `Export ${exportJobId} completed: ${meter.records} rows, ${meter.bytes} bytes → ${bucket}/${objectKey}`,
      );

      await this.notifyRequester(exportJob, meter.records, expiresAt);
    } catch (err) {
      await this.handleFailure(job, exportJob, objectKey, err);
      throw err;
    }
  }

  /**
   * Which forms this job covers.
   *
   * For an org-wide export the list was resolved and frozen at creation time,
   * so a form created after the request was accepted does not sneak into a file
   * the user did not ask for. The frozen ids are re-checked against the org
   * here — not to narrow the scope, but because a job id must never be able to
   * name a form outside its own tenant, whatever is in its JSON column.
   */
  private async resolveFormsInScope(
    exportJob: ExportJob & { form?: { id: string; title: string } | null },
  ) {
    if (exportJob.formId) {
      return exportJob.form ? [exportJob.form] : [];
    }

    const filters = (exportJob.filters ?? {}) as FrozenExportFilters;
    return this.prisma.reader.form.findMany({
      where: {
        organizationId: exportJob.organizationId,
        deletedAt: null,
        ...(filters.formIds?.length ? { id: { in: filters.formIds } } : {}),
      },
      select: { id: true, title: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * The encoded file, one chunk at a time.
   *
   * Everything the row source yields passes through untouched — this generator
   * only adds the structure needed to hold several forms in one file, and only
   * for an org-wide export.
   *
   * ORG-WIDE CSV is sectioned rather than merged. Two forms have different
   * questions, so there is no single header row that describes both; merging
   * them means either dropping every answer column or emitting a sparse union
   * of every question in the organisation. A section per form — a banner row
   * naming the form, that form's own header, its rows, then a blank line —
   * keeps every answer, opens in Excel, and is trivially splittable by script.
   *
   * ORG-WIDE JSON nests the row source's array inside a per-form envelope,
   * which composes without parsing anything the generator produced.
   */
  private async *encodedExport(
    exportJob: ExportJob,
    forms: { id: string; title: string }[],
    meter: ExportProgressMeter,
  ): AsyncGenerator<string> {
    const format = exportJob.format === 'JSON' ? 'json' : 'csv';
    const orgWide = !exportJob.formId;
    const filters = (exportJob.filters ?? {}) as FrozenExportFilters;

    if (orgWide && format === 'json') {
      yield this.raw(meter, '{"forms":[');
    }

    let index = 0;
    for (const form of forms) {
      if (orgWide) {
        yield this.raw(
          meter,
          format === 'json'
            ? `${index > 0 ? ',' : ''}{"formId":${JSON.stringify(form.id)},"title":${JSON.stringify(form.title)},"submissions":`
            : `${index > 0 ? '\r\n\r\n' : ''}${csvBannerRow(form)}\r\n`,
        );
      }

      // Taken unbound and re-bound explicitly on the next line with
      // `.call(this.forms, …)`. The cast is what lets the optional 4th filters
      // parameter be passed through a narrower declared type; the `this` is
      // never lost.
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const rowSource = this.forms
        .exportSubmissions as unknown as ExportRowSource;
      const chunks = await rowSource.call(
        this.forms,
        exportJob.organizationId,
        form.id,
        format,
        filters,
      );

      for await (const chunk of chunks) {
        meter.push(chunk);
        yield chunk;
        await this.flushProgress(exportJob.id, meter);
      }

      if (orgWide && format === 'json') {
        yield this.raw(meter, '}');
      }
      index++;
    }

    if (orgWide && format === 'json') {
      yield this.raw(meter, ']}');
    }

    // One last write so the finished row does not sit one flush interval behind
    // the file it describes.
    await this.flushProgress(exportJob.id, meter, true);
  }

  /** Emit a chunk this module produced itself: counted in bytes, not in rows. */
  private raw(meter: ExportProgressMeter, chunk: string): string {
    meter.pushRaw(chunk);
    return chunk;
  }

  /**
   * Persist progress, at most once every couple of seconds.
   *
   * Rate-limited rather than per-row because `rowsWritten` is a progress bar
   * and nothing else reads it: an UPDATE per row would multiply the write load
   * of an export by its own row count, for a number a human looks at maybe
   * twice. Failures here are swallowed — losing a progress update is a cosmetic
   * problem, and throwing would abort a perfectly good export over one.
   */
  private async flushProgress(
    exportJobId: string,
    meter: ExportProgressMeter,
    force = false,
  ): Promise<void> {
    if (!force && !meter.shouldFlush()) return;
    meter.markFlushed();

    try {
      await this.prisma.writer.exportJob.updateMany({
        where: { id: exportJobId, status: 'RUNNING' },
        data: { rowsWritten: meter.records },
      });
    } catch (err) {
      this.logger.debug(
        `Progress update for export ${exportJobId} failed: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Notify the requester that their file is ready.
   *
   * Written directly with Prisma rather than through NotificationsService,
   * which is being built in parallel. TODO (see WIRING-exports.md): swap this
   * for `notifications.create(...)` once that service exists, so notification
   * shape and delivery rules live in one place.
   *
   * Never allowed to fail the job: the export succeeded, the file is in the
   * bucket and the row says COMPLETED. Throwing here would retry the whole
   * export — re-reading every row and re-uploading every byte — to fix a missing
   * dashboard badge.
   */
  private async notifyRequester(
    exportJob: ExportJob,
    rows: number,
    expiresAt: Date,
  ): Promise<void> {
    try {
      await this.prisma.writer.notification.create({
        data: {
          userId: exportJob.requestedById,
          type: 'export_ready',
          title: 'Your export is ready',
          body:
            `${rows.toLocaleString()} response${rows === 1 ? '' : 's'} exported as ` +
            `${exportJob.format}. The download expires on ${expiresAt.toISOString().slice(0, 10)}.`,
          metadata: {
            exportJobId: exportJob.id,
            formId: exportJob.formId,
            format: exportJob.format,
            expiresAt: expiresAt.toISOString(),
          },
        },
      });
    } catch (err) {
      this.logger.warn(
        `Export ${exportJob.id} completed but its notification could not be written: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Failure path.
   *
   * Two things have to happen and they are independent:
   *
   *  • The partial object must go. A multipart upload that threw mid-flight can
   *    leave a truncated object behind (MinIO) or orphan parts (S3, though
   *    `leavePartsOnError: false` handles that case). A truncated CSV sitting at
   *    the key a later successful run would use is the worst artefact this
   *    system can produce, so it is removed before anything else.
   *
   *  • The row is only marked FAILED once BullMQ has exhausted its retries.
   *    Flipping it on the first attempt shows the user a red "failed" that then
   *    silently turns green two minutes later, which trains them to distrust
   *    the status entirely.
   */
  private async handleFailure(
    job: Job<ExportJobPayload>,
    exportJob: ExportJob,
    objectKey: string,
    err: unknown,
  ): Promise<void> {
    this.logger.error(
      `Export ${exportJob.id} failed on attempt ${job.attemptsMade + 1}`,
      err instanceof Error ? err.stack : String(err),
    );

    await deleteExportObject(objectKey).catch(() => {
      /* Nothing was written, or storage is the thing that is broken. */
    });

    const attemptsAllowed = job.opts?.attempts ?? 1;
    if (job.attemptsMade + 1 < attemptsAllowed) return;

    await this.markFailed(exportJob.id, userSafeError(err));
  }

  private async markFailed(
    exportJobId: string,
    message: string,
  ): Promise<void> {
    await this.prisma.writer.exportJob.updateMany({
      where: { id: exportJobId, status: { in: ['QUEUED', 'RUNNING'] } },
      data: { status: 'FAILED', error: message, completedAt: new Date() },
    });
  }
}

/**
 * A CSV row naming the form a section belongs to.
 *
 * Quoted with the same rules the row source uses so a form titled
 * `Q3 "pilot", revised` cannot break the section header into three cells — but
 * written here rather than imported, because `csvCell` is module-private to
 * FormsService and this is one banner row, not a second copy of the encoder.
 * The leading `#` is a convention, not CSV syntax; the value is a normal quoted
 * cell that any parser reads as a single-column row.
 */
function csvBannerRow(form: { id: string; title: string }): string {
  const value = `# Form: ${form.title} (${form.id})`;
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Turn a failure into something safe to show in the dashboard.
 *
 * `ExportJob.error` is rendered verbatim to the user, so a raw driver message
 * would put connection strings, table names and stack frames on a tenant's
 * screen. Client-class HttpExceptions are already written for users — "this
 * form has 80 000 submissions, which exceeds…" is exactly what the person needs
 * to read — so those pass through. Everything else collapses to one sentence.
 */
function userSafeError(err: unknown): string {
  if (err instanceof HttpException) {
    const status = err.getStatus();
    if (status >= 400 && status < 500) return err.message;
  }
  return (
    'The export could not be completed. This is usually temporary — please try again, ' +
    `or narrow the export if the form is very large. Exports are kept for ${resolveRetentionDays()} days once they succeed.`
  );
}
