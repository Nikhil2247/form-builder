import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import {
  describeExportFilters,
  freezeExportFilters,
  hasRowFilters,
  rowSourceSupportsFilters,
} from './export-filters';
import {
  DEFAULT_RETENTION_DAYS,
  MAX_RETENTION_DAYS,
  MIN_RETENTION_DAYS,
  exportFilename,
  exportObjectKey,
  isRetentionExpired,
  resolveDownloadTtlSeconds,
  resolveRetentionDays,
  retentionExpiryFrom,
} from './export-policy';
import { ExportProgressMeter } from './export-progress';
import { ExportsService } from './exports.service';

/**
 * These cover the parts of async export that are decidable without a database,
 * a queue, or object storage — which is deliberately most of the parts that can
 * be wrong in a way nobody notices:
 *
 *   • FILTER FREEZING, because a frozen filter is the only record of what a
 *     finished file contains. If it normalises inconsistently, two identical
 *     requests produce two different descriptions of the same export.
 *   • RETENTION, because the expiry arithmetic decides when a full copy of a
 *     tenant's responses is deleted. Getting it wrong in one direction breaks
 *     downloads; getting it wrong in the other retains personal data.
 *   • ORG SCOPING, because a job id is a bearer reference to bulk response
 *     data and cross-tenant reachability is the worst bug available here.
 *   • PROGRESS COUNTING, because the counters read encoded output and have to
 *     survive quoted newlines and chunk boundaries.
 */

// ═══════════════════════════════════════════════════════════════════════════
describe('freezeExportFilters', () => {
  it('freezes an empty request as an empty object rather than nulls', () => {
    expect(freezeExportFilters(undefined)).toEqual({});
    expect(freezeExportFilters({ search: '   ', statuses: [] })).toEqual({});
  });

  it('normalises dates to ISO-8601 UTC', () => {
    const frozen = freezeExportFilters({
      from: '2026-01-01',
      to: '2026-02-01T12:30:00Z',
    });
    expect(frozen.from).toBe('2026-01-01T00:00:00.000Z');
    expect(frozen.to).toBe('2026-02-01T12:30:00.000Z');
  });

  /**
   * The whole point of freezing is that the stored value is comparable later.
   * Two requests that mean the same thing must produce byte-identical JSON, or
   * an audit diff lights up because the client happened to order a list
   * differently.
   */
  it('is deterministic: same meaning, same serialisation', () => {
    const a = freezeExportFilters(
      { statuses: ['REJECTED', 'SUBMITTED'], search: '  north  ' },
      ['b-form', 'a-form'],
    );
    const b = freezeExportFilters(
      { statuses: ['SUBMITTED', 'REJECTED', 'SUBMITTED'], search: 'north' },
      ['a-form', 'b-form', 'a-form'],
    );
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.statuses).toEqual(['REJECTED', 'SUBMITTED']);
    expect(a.formIds).toEqual(['a-form', 'b-form']);
  });

  it('accepts lowercase status names but freezes them canonically', () => {
    expect(freezeExportFilters({ statuses: ['submitted'] }).statuses).toEqual([
      'SUBMITTED',
    ]);
  });

  // An inverted range exports nothing and looks like a successful empty file.
  it('rejects an inverted date range', () => {
    expect(() =>
      freezeExportFilters({ from: '2026-02-01', to: '2026-01-01' }),
    ).toThrow(BadRequestException);
  });

  it('rejects an equal date range', () => {
    expect(() =>
      freezeExportFilters({ from: '2026-01-01', to: '2026-01-01' }),
    ).toThrow(BadRequestException);
  });

  it('rejects an unparseable date rather than freezing an Invalid Date', () => {
    expect(() => freezeExportFilters({ from: 'last tuesday' })).toThrow(
      BadRequestException,
    );
  });

  it('rejects a status it cannot honour instead of silently dropping it', () => {
    expect(() => freezeExportFilters({ statuses: ['DELETED'] })).toThrow(
      BadRequestException,
    );
    expect(() => freezeExportFilters({ statuses: ['ARCHIVED'] })).toThrow(
      BadRequestException,
    );
  });

  it('rejects an over-long search term', () => {
    expect(() => freezeExportFilters({ search: 'x'.repeat(201) })).toThrow(
      BadRequestException,
    );
  });

  it('separates row filters from form scoping', () => {
    expect(
      hasRowFilters(freezeExportFilters(undefined, ['form-a', 'form-b'])),
    ).toBe(false);
    expect(hasRowFilters(freezeExportFilters({ from: '2026-01-01' }))).toBe(
      true,
    );
    expect(
      hasRowFilters(freezeExportFilters({ statuses: ['SUBMITTED'] })),
    ).toBe(true);
    expect(hasRowFilters(freezeExportFilters({ search: 'abc' }))).toBe(true);
  });
});

describe('rowSourceSupportsFilters', () => {
  // Fails closed: an unfiltered row source means filtered requests are refused,
  // never quietly widened into "everything".
  it('is false for the three-parameter row source', () => {
    expect(
      rowSourceSupportsFilters((_a: any, _b: any, _c: any) => undefined),
    ).toBe(false);
  });

  it('is true once the row source declares a filters parameter', () => {
    expect(
      rowSourceSupportsFilters(
        (_a: any, _b: any, _c: any, _d?: any) => undefined,
      ),
    ).toBe(true);
  });
});

describe('describeExportFilters', () => {
  it('says so plainly when nothing was narrowed', () => {
    expect(describeExportFilters({})).toBe('all responses');
  });

  it('describes a full request from the frozen value alone', () => {
    const frozen = freezeExportFilters(
      {
        from: '2026-01-01',
        to: '2026-02-01',
        statuses: ['SUBMITTED'],
        search: 'north',
      },
      ['f1'],
    );
    expect(describeExportFilters(frozen)).toBe(
      'submitted 2026-01-01 to 2026-02-01, status SUBMITTED, matching "north", 1 form',
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('retention', () => {
  it('defaults to the documented window', () => {
    expect(resolveRetentionDays(undefined)).toBe(DEFAULT_RETENTION_DAYS);
  });

  // A typo'd env var must not produce an Invalid Date *after* the file has
  // already been uploaded — the most expensive possible place to fail.
  it('falls back rather than producing NaN for unparseable configuration', () => {
    expect(resolveRetentionDays('')).toBe(DEFAULT_RETENTION_DAYS);
    expect(resolveRetentionDays('seven')).toBe(DEFAULT_RETENTION_DAYS);
  });

  it('clamps configuration into a defensible range', () => {
    expect(resolveRetentionDays('0')).toBe(MIN_RETENTION_DAYS);
    expect(resolveRetentionDays('-30')).toBe(MIN_RETENTION_DAYS);
    expect(resolveRetentionDays('3650')).toBe(MAX_RETENTION_DAYS);
    expect(resolveRetentionDays('14')).toBe(14);
  });

  // Measured from completion, not creation: a job queued behind a larger one
  // must not arrive with its retention already partly spent.
  it('measures the window from completion', () => {
    const completedAt = new Date('2026-08-13T09:00:00.000Z');
    expect(retentionExpiryFrom(completedAt, 7).toISOString()).toBe(
      '2026-08-20T09:00:00.000Z',
    );
    expect(retentionExpiryFrom(completedAt, 1).toISOString()).toBe(
      '2026-08-14T09:00:00.000Z',
    );
  });

  it('treats the expiry instant itself as expired', () => {
    const at = new Date('2026-08-20T09:00:00.000Z');
    expect(isRetentionExpired(at, new Date('2026-08-20T08:59:59.999Z'))).toBe(
      false,
    );
    expect(isRetentionExpired(at, at)).toBe(true);
    expect(isRetentionExpired(null, at)).toBe(false);
  });

  it('clamps the download link TTL', () => {
    expect(resolveDownloadTtlSeconds(undefined)).toBe(300);
    expect(resolveDownloadTtlSeconds('nonsense')).toBe(300);
    expect(resolveDownloadTtlSeconds('1')).toBe(30);
    expect(resolveDownloadTtlSeconds('999999')).toBe(3600);
  });
});

describe('object naming', () => {
  /**
   * Exports must not share a prefix with respondent uploads: the bucket
   * lifecycle rule that is the second layer of retention enforcement can only
   * target a prefix, and uploads are kept for the life of the submission.
   */
  it('keeps exports under their own prefix, partitioned by org', () => {
    expect(exportObjectKey('org-1', 'job-9', 'CSV')).toBe(
      'exports/org_org-1/job-9.csv',
    );
    expect(exportObjectKey('org-1', 'job-9', 'JSON')).toBe(
      'exports/org_org-1/job-9.json',
    );
    expect(
      exportObjectKey('org-1', 'job-9', 'CSV').startsWith('uploads/'),
    ).toBe(false);
  });

  it('slugs the download filename and never leaves it empty', () => {
    const day = new Date('2026-08-13T00:00:00.000Z');
    expect(exportFilename('Q3 Monitoring / Nagaland', day, 'CSV')).toBe(
      'q3-monitoring-nagaland-2026-08-13.csv',
    );
    expect(exportFilename('!!!', day, 'JSON')).toBe('export-2026-08-13.json');
    expect(exportFilename(null, day, 'CSV')).toBe('export-2026-08-13.csv');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('ExportProgressMeter', () => {
  it('counts CSV rows, not lines', () => {
    const meter = new ExportProgressMeter('CSV');
    meter.push('"Submission ID","Answer"');
    // A free-text answer with two line breaks inside a quoted cell is ONE row.
    meter.push('\r\n"sub-1","line one\r\nline two\r\nline three"');
    meter.push('\r\n"sub-2","plain"');
    expect(meter.records).toBe(2);
  });

  it('handles an escaped quote adjacent to a row terminator', () => {
    const meter = new ExportProgressMeter('CSV');
    meter.push('"h"');
    meter.push('\r\n"say ""hi"""\r\n"second"');
    expect(meter.records).toBe(2);
  });

  // Chunks are produced a batch at a time and can split anywhere, including
  // inside a quoted cell or between the two characters of an escaped quote.
  it('survives a chunk boundary inside a quoted cell', () => {
    const whole = '"h"\r\n"a\r\nb"\r\n"c"';
    for (let split = 1; split < whole.length; split++) {
      const meter = new ExportProgressMeter('CSV');
      meter.push(whole.slice(0, split));
      meter.push(whole.slice(split));
      expect(meter.records).toBe(2);
    }
  });

  it('counts JSON array elements, not braces', () => {
    const meter = new ExportProgressMeter('JSON');
    meter.push('[');
    meter.push('{"id":"a","answers":{"q1":{"nested":1},"q2":[1,2,3]}}');
    meter.push(',{"id":"b","answers":{}}');
    meter.push(']');
    expect(meter.records).toBe(2);
  });

  it('ignores braces and brackets inside JSON strings', () => {
    const meter = new ExportProgressMeter('JSON');
    meter.push('[{"id":"a","answers":{"q1":"a { b [ c \\" d"}}]');
    expect(meter.records).toBe(1);
  });

  it('counts bytes for everything, records only for row-source output', () => {
    const meter = new ExportProgressMeter('CSV');
    meter.push('"h"');
    meter.pushRaw('\r\n"# Form: X"\r\n'); // section banner, not a submission
    meter.push('\r\n"sub-1"');
    expect(meter.records).toBe(1);
    expect(meter.bytes).toBe(
      BigInt(Buffer.byteLength('"h"\r\n"# Form: X"\r\n\r\n"sub-1"')),
    );
  });

  it('counts multi-byte characters as bytes, not as code units', () => {
    const meter = new ExportProgressMeter('CSV');
    meter.push('"नागालैंड"');
    expect(meter.bytes).toBe(BigInt(Buffer.byteLength('"नागालैंड"', 'utf8')));
  });

  it('does not rewrite the same progress number twice', () => {
    const meter = new ExportProgressMeter('CSV');
    meter.push('"h"\r\n"a"');
    expect(meter.shouldFlush(10_000)).toBe(true);
    meter.markFlushed(10_000);
    // Nothing new arrived, so there is nothing worth an UPDATE.
    expect(meter.shouldFlush(99_000)).toBe(false);
    meter.push('\r\n"b"');
    expect(meter.shouldFlush(10_500)).toBe(false); // too soon
    expect(meter.shouldFlush(12_000)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
/**
 * Tenancy. Every one of these asserts a 404 rather than a 403: telling a caller
 * "that export exists but is not yours" turns the endpoint into an oracle for
 * enumerating another organisation's job ids.
 */
describe('ExportsService org scoping', () => {
  const OTHER_ORG_JOB = {
    id: 'job-1',
    organizationId: 'org-a',
    formId: 'form-1',
    status: 'COMPLETED',
    format: 'CSV',
    filters: {},
    rowsWritten: 10,
    rowsTotal: 10,
    objectKey: 'exports/org_org-a/job-1.csv',
    bytes: 1_024n,
    error: null,
    expiresAt: new Date('2030-01-01T00:00:00.000Z'),
    startedAt: new Date(),
    completedAt: new Date(),
    createdAt: new Date(),
    form: { title: 'Form One' },
  };

  function prismaWith(overrides: any = {}) {
    return {
      reader: {
        exportJob: {
          // The real client applies the WHERE; the stand-in has to as well, or
          // the test proves nothing about scoping.
          findFirst: jest.fn(({ where }: any) =>
            Promise.resolve(
              where.id === OTHER_ORG_JOB.id &&
                where.organizationId === OTHER_ORG_JOB.organizationId
                ? OTHER_ORG_JOB
                : null,
            ),
          ),
          count: jest.fn().mockResolvedValue(0),
          findMany: jest.fn().mockResolvedValue([]),
        },
        form: {
          findFirst: jest.fn(({ where }: any) =>
            Promise.resolve(
              where.organizationId === 'org-a' && where.id === 'form-1'
                ? { id: 'form-1', title: 'Form One' }
                : null,
            ),
          ),
          findMany: jest.fn().mockResolvedValue([{ id: 'form-1' }]),
        },
        ...overrides.reader,
      },
      writer: {
        exportJob: {
          create: jest.fn(({ data }: any) =>
            Promise.resolve({
              ...OTHER_ORG_JOB,
              ...data,
              id: 'job-new',
              status: 'QUEUED',
              rowsWritten: 0,
              rowsTotal: null,
              objectKey: null,
              bytes: null,
              expiresAt: null,
              startedAt: null,
              completedAt: null,
              createdAt: new Date(),
            }),
          ),
          update: jest.fn().mockResolvedValue({}),
        },
        ...overrides.writer,
      },
    };
  }

  function service(
    prisma: any,
    producer: any = { enqueue: jest.fn().mockResolvedValue(undefined) },
  ) {
    return new ExportsService(prisma, { log: jest.fn() } as any, producer);
  }

  it('does not return another org’s job', async () => {
    await expect(
      service(prismaWith()).getExport('org-b', 'job-1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('does not issue a download URL for another org’s job', async () => {
    await expect(
      service(prismaWith()).downloadExport('org-b', 'job-1', 'user-1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('does not create a form-scoped export against another org’s form', async () => {
    await expect(
      service(prismaWith()).createExport('org-b', 'user-1', {
        formId: 'form-1',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('refuses to download a job whose retention has passed, even before the sweeper runs', async () => {
    const prisma = prismaWith();
    prisma.reader.exportJob.findFirst = jest.fn().mockResolvedValue({
      ...OTHER_ORG_JOB,
      expiresAt: new Date('2000-01-01T00:00:00.000Z'),
    });
    await expect(
      service(prisma).downloadExport('org-a', 'job-1', 'user-1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('explains an EXPIRED job instead of returning a dead link', async () => {
    const prisma = prismaWith();
    prisma.reader.exportJob.findFirst = jest
      .fn()
      .mockResolvedValue({ ...OTHER_ORG_JOB, status: 'EXPIRED' });
    await expect(
      service(prisma).downloadExport('org-a', 'job-1', 'user-1'),
    ).rejects.toThrow(/retention/i);
  });

  it('refuses to download a job that has not finished', async () => {
    const prisma = prismaWith();
    prisma.reader.exportJob.findFirst = jest.fn().mockResolvedValue({
      ...OTHER_ORG_JOB,
      status: 'RUNNING',
      objectKey: null,
    });
    await expect(
      service(prisma).downloadExport('org-a', 'job-1', 'user-1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('freezes the filters onto the created row', async () => {
    const prisma = prismaWith();
    await service(prisma).createExport('org-a', 'user-1', {
      formId: 'form-1',
      format: 'JSON',
    });

    const { data } = prisma.writer.exportJob.create.mock.calls[0][0];
    expect(data).toMatchObject({
      organizationId: 'org-a',
      formId: 'form-1',
      requestedById: 'user-1',
      status: 'QUEUED',
      format: 'JSON',
      filters: {},
    });
  });

  it('freezes the org’s form ids onto an org-wide export', async () => {
    const prisma = prismaWith();
    prisma.reader.form.findMany = jest
      .fn()
      .mockResolvedValue([{ id: 'form-2' }, { id: 'form-1' }]);

    await service(prisma).createExport('org-a', 'user-1', {});

    const { data } = prisma.writer.exportJob.create.mock.calls[0][0];
    expect(data.formId).toBeNull();
    // Resolved and frozen at creation: a form added while the job sits in the
    // queue must not appear in a file nobody asked for.
    expect(data.filters).toEqual({ formIds: ['form-1', 'form-2'] });
  });

  /**
   * This test used to assert the OPPOSITE — that a filtered export was rejected.
   *
   * That was correct at the time: `FormsService.exportSubmissions` had no
   * filters parameter, `rowSourceSupportsFilters()` therefore reported false,
   * and rejecting was the only honest option. Accepting would have produced a
   * file stating a date range it did not honour, which is worse than an error.
   *
   * The row source has since gained a 4th `filters?` parameter and threads it
   * into the shared `exportableSubmissions()` predicate — covered by
   * modules/forms/export-filters.spec.ts, including the rule that a caller
   * cannot widen it back to include soft-deleted rows. So the capability probe
   * now reports true and the request must succeed.
   *
   * The fail-closed behaviour itself is still asserted by the
   * `rowSourceSupportsFilters` block above: it is a property of the probe, and
   * belongs there rather than being re-tested through the service.
   */
  it('accepts row filters now that the row source can honour them', async () => {
    const prisma = prismaWith();

    await service(prisma).createExport('org-a', 'user-1', {
      formId: 'form-1',
      filters: { from: '2026-01-01' },
    });

    const { data } = prisma.writer.exportJob.create.mock.calls[0][0];
    // Frozen onto the job, so a finished export can always say what it contains.
    expect(data.filters).toMatchObject({ from: expect.any(String) });
  });

  it('caps how many exports one org can have in flight', async () => {
    const prisma = prismaWith();
    prisma.reader.exportJob.count = jest.fn().mockResolvedValue(3);
    await expect(
      service(prisma).createExport('org-a', 'user-1', { formId: 'form-1' }),
    ).rejects.toThrow(ForbiddenException);
  });

  /**
   * A row nobody will ever pick up must not sit at QUEUED forever showing a
   * spinner — the dashboard has no other way to learn the queue rejected it.
   */
  it('marks the job FAILED when it cannot be enqueued', async () => {
    const prisma = prismaWith();
    const producer = {
      enqueue: jest.fn().mockRejectedValue(new Error('ECONNREFUSED 6379')),
    };

    await expect(
      service(prisma, producer).createExport('org-a', 'user-1', {
        formId: 'form-1',
      }),
    ).rejects.toThrow();

    expect(prisma.writer.exportJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED' }),
      }),
    );
    // The message reaches the dashboard verbatim, so it must not carry the
    // Redis address that actually failed.
    const { data } = prisma.writer.exportJob.update.mock.calls[0][0];
    expect(data.error).not.toMatch(/6379|ECONNREFUSED/);
  });
});
