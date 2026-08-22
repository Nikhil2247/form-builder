import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ExportJob } from '@prisma/client';
import { PrismaService } from '../../common/infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FormsService } from '../forms/forms.service';
import {
  paginated,
  parsePagination,
  type Pagination,
} from '../../common/http/pagination/pagination';
import { CreateExportDto } from './dto/create-export.dto';
import { ListExportsQueryDto } from './dto/list-exports-query.dto';
import {
  describeExportFilters,
  freezeExportFilters,
  hasRowFilters,
  rowSourceSupportsFilters,
  type FrozenExportFilters,
} from './logic/export-filters';
import {
  exportContentType,
  exportFilename,
  isRetentionExpired,
  resolveDownloadTtlSeconds,
  resolveRetentionDays,
} from './logic/export-policy';
import { presignExportDownload } from './logic/export-uploader';
import { ExportProducer } from './queues/export.producer';

/**
 * Ceiling on exports a single org may have in flight.
 *
 * Each running export holds a reader connection and streams the whole
 * submissions table for its forms. Without a ceiling, one impatient user
 * clicking "export" repeatedly — which is exactly what a user does when a job
 * does not finish instantly — queues twenty full-table scans against the same
 * database that is serving everyone else's forms. Three is enough that a
 * legitimate "export these four forms" is not blocked, and low enough that the
 * queue cannot be used as a self-inflicted denial of service.
 */
function maxConcurrentPerOrg(): number {
  const parsed = Number.parseInt(
    process.env.EXPORT_MAX_CONCURRENT_PER_ORG ?? '',
    10,
  );
  return Number.isFinite(parsed) ? Math.min(20, Math.max(1, parsed)) : 3;
}

@Injectable()
export class ExportsService {
  private readonly logger = new Logger(ExportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly producer: ExportProducer,
  ) {}

  /**
   * Accept an export request and hand it to a worker.
   * ═══════════════════════════════════════════════════════════════════════
   *
   * Everything that can be decided synchronously IS decided synchronously —
   * tenancy, form existence, filter validity, quota — because the caller gets a
   * 202 and then stops looking. A validation failure discovered by the worker
   * ten minutes later surfaces as a red row in a list the user has already
   * navigated away from, which is a far worse way to learn that a date was
   * typed wrong than a 400 while the form is still on screen.
   */
  async createExport(
    orgId: string,
    userId: string,
    dto: CreateExportDto,
    ipAddress?: string,
  ) {
    const format = dto.format ?? 'CSV';

    // ── Resolve scope ──────────────────────────────────────────────────────
    let formIdsInScope: string[] | undefined;
    let label: string;

    if (dto.formId) {
      const form = await this.prisma.reader.form.findFirst({
        where: { id: dto.formId, organizationId: orgId, deletedAt: null },
        select: { id: true, title: true },
      });
      // Not "form not in this org" — the distinction between "does not exist"
      // and "exists but belongs to someone else" is itself a tenancy leak: it
      // turns this endpoint into an oracle for probing another org's form ids.
      if (!form) throw new NotFoundException('Form not found');
      label = form.title;
    } else {
      const forms = await this.prisma.reader.form.findMany({
        where: { organizationId: orgId, deletedAt: null },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      });
      if (forms.length === 0) {
        throw new BadRequestException(
          'This organization has no forms to export.',
        );
      }
      formIdsInScope = forms.map((f) => f.id);
      label = 'all-forms';
    }

    // ── Freeze the filters ─────────────────────────────────────────────────
    const filters = freezeExportFilters(dto.filters, formIdsInScope);

    // The row source is FormsService.exportSubmissions, reused rather than
    // copied so that soft-delete exclusion (and anything else that query grows)
    // applies to async exports for free. The price of not owning the query is
    // that row-level filters can only be honoured if that method has somewhere
    // to receive them — and an export that quietly ignores its own stated date
    // range is not an acceptable failure mode, so this fails closed.
    if (
      hasRowFilters(filters) &&
      // Referenced unbound ON PURPOSE: `rowSourceSupportsFilters` only reads
      // `Function.length` to learn whether the method declares a filters
      // parameter. It is never invoked, so there is no `this` to lose.
      // eslint-disable-next-line @typescript-eslint/unbound-method
      !rowSourceSupportsFilters(FormsService.prototype.exportSubmissions)
    ) {
      throw new BadRequestException(
        'Date, status and search filters are not available for asynchronous exports yet. ' +
          'Export the whole form, or use the synchronous export for a filtered subset.',
      );
    }

    // ── Per-org concurrency ────────────────────────────────────────────────
    const inFlight = await this.prisma.reader.exportJob.count({
      where: { organizationId: orgId, status: { in: ['QUEUED', 'RUNNING'] } },
    });
    if (inFlight >= maxConcurrentPerOrg()) {
      throw new ForbiddenException(
        `This organization already has ${inFlight} exports running. Wait for one to finish before starting another.`,
      );
    }

    const job = await this.prisma.writer.exportJob.create({
      data: {
        organizationId: orgId,
        formId: dto.formId ?? null,
        requestedById: userId,
        status: 'QUEUED',
        format,
        filters: filters as any,
      },
    });

    try {
      await this.producer.enqueue({
        exportJobId: job.id,
        organizationId: orgId,
      });
    } catch (err) {
      // The row exists but nothing will ever pick it up. Leaving it QUEUED
      // would show the user a spinner that never resolves; marking it FAILED
      // here is the only way the dashboard can tell the truth about it.
      await this.prisma.writer.exportJob.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          error:
            'The export could not be started. Please try again in a few minutes.',
        },
      });
      this.logger.error(
        `Failed to enqueue export ${job.id} for org ${orgId}`,
        err instanceof Error ? err.stack : String(err),
      );
      throw new ServiceUnavailableException(
        'The export service is temporarily unavailable.',
      );
    }

    this.audit.log({
      organizationId: orgId,
      userId,
      action: 'export.requested',
      resource: 'export_job',
      resourceId: job.id,
      // The frozen filters go into the audit entry too. An export is a bulk
      // extraction of personal data; "who pulled what, and when" is the whole
      // reason this log exists, and "what" is not answerable from the job id
      // alone once the row is swept.
      metadata: {
        format,
        formId: dto.formId ?? null,
        filters,
        scope: dto.formId ? 'form' : 'organization',
      },
      ipAddress,
    });

    return {
      ...this.toSummary(job, label),
      // Told up front, not discovered later. A user who knows the file lives
      // for a week behaves differently from one who assumes it is permanent.
      retentionDays: resolveRetentionDays(),
    };
  }

  /** This org's exports, newest first. */
  async listExports(
    orgId: string,
    query: ListExportsQueryDto,
    pagination: Pagination = parsePagination(),
  ) {
    const where = {
      organizationId: orgId,
      ...(query.formId ? { formId: query.formId } : {}),
      ...(query.status ? { status: query.status as ExportJob['status'] } : {}),
    };

    const [jobs, total] = await Promise.all([
      this.prisma.reader.exportJob.findMany({
        where,
        skip: pagination.skip,
        take: pagination.take,
        // Matches @@index([organizationId, createdAt DESC]) exactly.
        orderBy: { createdAt: 'desc' },
        include: { form: { select: { title: true } } },
      }),
      this.prisma.reader.exportJob.count({ where }),
    ]);

    return paginated(
      'exports',
      jobs.map((job) => this.toSummary(job, job.form?.title ?? 'all-forms')),
      pagination,
      total,
    );
  }

  /** Status and progress for one job. */
  async getExport(orgId: string, id: string) {
    const job = await this.findScoped(orgId, id);
    return this.toSummary(job.job, job.label);
  }

  /**
   * Issue a short-lived presigned URL for a finished export.
   * ═══════════════════════════════════════════════════════════════════════
   *
   * The bytes are NOT proxied through the API. Streaming a 300 MB file back
   * through a Node process would put it right back behind the load-balancer
   * timeout that this entire feature exists to escape, and would hold an API
   * slot for the duration on top. The client talks to object storage directly;
   * the API's only job is to decide whether it is allowed to.
   */
  async downloadExport(
    orgId: string,
    id: string,
    userId: string,
    ipAddress?: string,
  ) {
    const { job, label } = await this.findScoped(orgId, id);

    if (job.status === 'EXPIRED') {
      throw new NotFoundException(
        `This export was deleted after its ${resolveRetentionDays()}-day retention period. Run it again to get a fresh copy.`,
      );
    }
    if (job.status === 'FAILED') {
      throw new NotFoundException(
        'This export failed and has no file to download.',
      );
    }
    if (job.status !== 'COMPLETED' || !job.objectKey) {
      throw new NotFoundException('This export is not finished yet.');
    }
    // The sweeper runs on a schedule, so there is a window in which a row is
    // still COMPLETED but its retention has passed. Checking the timestamp as
    // well as the status closes it — otherwise the answer to "can I download
    // this?" depends on how recently the sweeper happened to run.
    if (isRetentionExpired(job.expiresAt)) {
      throw new NotFoundException(
        'This export has passed its retention period. Run it again to get a fresh copy.',
      );
    }

    const ttl = resolveDownloadTtlSeconds();
    const filename = exportFilename(label, job.createdAt, job.format);
    const url = await presignExportDownload(
      job.objectKey,
      filename,
      exportContentType(job.format),
      ttl,
    );

    this.audit.log({
      organizationId: orgId,
      userId,
      action: 'export.downloaded',
      resource: 'export_job',
      resourceId: job.id,
      metadata: {
        objectKey: job.objectKey,
        bytes: job.bytes ? Number(job.bytes) : null,
      },
      ipAddress,
    });

    return {
      downloadUrl: url,
      filename,
      expiresIn: ttl,
      /** When the LINK dies — distinct from when the FILE dies. */
      urlExpiresAt: new Date(Date.now() + ttl * 1000),
      /** When the file itself is swept from the bucket. */
      fileExpiresAt: job.expiresAt,
    };
  }

  /**
   * Load a job, enforcing tenancy.
   *
   * `organizationId` is part of the WHERE clause rather than checked after the
   * read. Fetch-then-compare works right up until someone adds an early return,
   * and the failure is silent cross-tenant disclosure; making it a query
   * predicate means a job id from another org simply does not exist here.
   */
  private async findScoped(orgId: string, id: string) {
    const job = await this.prisma.reader.exportJob.findFirst({
      where: { id, organizationId: orgId },
      include: { form: { select: { title: true } } },
    });
    if (!job) throw new NotFoundException('Export not found');
    return { job, label: job.form?.title ?? 'all-forms' };
  }

  /** Shape the dashboard consumes. */
  private toSummary(job: ExportJob, label: string) {
    const filters = (job.filters ?? {}) as FrozenExportFilters;

    return {
      id: job.id,
      status: job.status,
      format: job.format,
      formId: job.formId,
      scope: job.formId ? ('form' as const) : ('organization' as const),
      label,
      filters,
      /** Pre-rendered so every surface describes a given export identically. */
      filtersDescription: describeExportFilters(filters),
      rowsWritten: job.rowsWritten,
      rowsTotal: job.rowsTotal,
      // rowsTotal is counted before the export starts and does not replicate
      // the export's own row filters, so it is an upper bound. Clamping here
      // means the UI can never render 118%.
      progress:
        job.status === 'COMPLETED'
          ? 1
          : job.rowsTotal && job.rowsTotal > 0
            ? Math.min(1, job.rowsWritten / job.rowsTotal)
            : null,
      bytes: job.bytes === null ? null : Number(job.bytes),
      error: job.error,
      expiresAt: job.expiresAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      createdAt: job.createdAt,
    };
  }
}
