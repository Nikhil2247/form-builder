import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

/** Clamp a caller-supplied window so a huge value cannot scan the whole table. */
function normaliseDays(days: number | undefined): number {
  if (!Number.isFinite(days) || !days) return 30;
  return Math.min(Math.max(Math.floor(days), 1), 365);
}

function startOfDayUtc(daysAgo: number): Date {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date;
}

export interface OrgSummary {
  forms: { total: number; published: number; draft: number; closed: number; archived: number };
  submissions: { total: number; window: number; previousWindow: number; changePercent: number | null };
  engagement: {
    views: number;
    starts: number;
    /** submissions / starts, as a percentage. Null when nobody started. */
    completionRate: number | null;
    /** Mean completion time in ms. Null when nothing has been submitted. */
    avgCompletionMs: number | null;
  };
  storage: { usedBytes: string; quotaBytes: string | null };
  windowDays: number;
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Per-day rows for a single form.
   */
  async getFormAnalytics(orgId: string, formId: string, days?: number) {
    const form = await this.prisma.reader.form.findFirst({
      where: { id: formId, organizationId: orgId },
      select: { id: true },
    });

    if (!form) {
      throw new NotFoundException('Form not found in this organization.');
    }

    const since = startOfDayUtc(normaliseDays(days));

    // Previously unbounded: a form with two years of history returned ~730 rows
    // to render a 30-day chart.
    return this.prisma.reader.formAnalytics.findMany({
      where: { formId, date: { gte: since } },
      orderBy: { date: 'asc' },
    });
  }

  /**
   * Per-day totals across every form in the organization.
   */
  async getGlobalAnalytics(orgId: string, days?: number) {
    const since = startOfDayUtc(normaliseDays(days));

    const rows = await this.prisma.reader.formAnalytics.groupBy({
      by: ['date'],
      where: { form: { organizationId: orgId }, date: { gte: since } },
      _sum: { submissions: true, views: true, starts: true },
      orderBy: { date: 'asc' },
    });

    // Flatten Prisma's `_sum` nesting — the frontend charted `_sum.submissions`
    // through a bespoke accessor in every consumer.
    return rows.map((row) => ({
      date: row.date,
      submissions: row._sum.submissions ?? 0,
      views: row._sum.views ?? 0,
      starts: row._sum.starts ?? 0,
    }));
  }

  /**
   * Organization-wide headline numbers for the dashboard.
   *
   * Added because the dashboard was deriving its "Total forms" and "Total
   * submissions" tiles from whichever page of the forms list happened to be
   * loaded — with a page size of 5, an organization with 200 forms and 40,000
   * responses displayed "5" and the sum of five forms' counts.
   *
   * Everything here is a single aggregate query against indexed columns; no
   * row-by-row work and no per-form fan-out.
   */
  async getOrgSummary(orgId: string, days?: number): Promise<OrgSummary> {
    const windowDays = normaliseDays(days);
    const windowStart = startOfDayUtc(windowDays);
    const previousStart = startOfDayUtc(windowDays * 2);

    const [formCounts, analytics, windowRows, previousRows, org] = await Promise.all([
      this.prisma.reader.form.groupBy({
        by: ['status'],
        where: { organizationId: orgId, deletedAt: null },
        _count: { _all: true },
      }),

      // Lifetime engagement totals, plus the sum needed for a true mean
      // completion time (see `sumCompletionMs` — `avgCompletionMs` alone is a
      // per-day average and cannot be averaged again without weighting).
      this.prisma.reader.formAnalytics.aggregate({
        where: { form: { organizationId: orgId } },
        _sum: {
          submissions: true,
          views: true,
          starts: true,
          sumCompletionMs: true,
        },
      }),

      this.prisma.reader.formAnalytics.aggregate({
        where: { form: { organizationId: orgId }, date: { gte: windowStart } },
        _sum: { submissions: true },
      }),

      this.prisma.reader.formAnalytics.aggregate({
        where: {
          form: { organizationId: orgId },
          date: { gte: previousStart, lt: windowStart },
        },
        _sum: { submissions: true },
      }),

      this.prisma.reader.organization.findUnique({
        where: { id: orgId },
        select: { storageUsedBytes: true, storageQuotaBytes: true },
      }),
    ]);

    const byStatus = (status: string) =>
      formCounts.find((row) => row.status === status)?._count._all ?? 0;

    const totalSubmissions = analytics._sum.submissions ?? 0;
    const windowSubmissions = windowRows._sum.submissions ?? 0;
    const previousSubmissions = previousRows._sum.submissions ?? 0;

    const starts = analytics._sum.starts ?? 0;
    const sumCompletionMs = analytics._sum.sumCompletionMs ?? BigInt(0);

    return {
      forms: {
        total: formCounts.reduce((sum, row) => sum + row._count._all, 0),
        published: byStatus('PUBLISHED'),
        draft: byStatus('DRAFT'),
        closed: byStatus('CLOSED'),
        archived: byStatus('ARCHIVED'),
      },
      submissions: {
        total: totalSubmissions,
        window: windowSubmissions,
        previousWindow: previousSubmissions,
        // Growth from zero is undefined, not "+100%".
        changePercent:
          previousSubmissions > 0
            ? ((windowSubmissions - previousSubmissions) / previousSubmissions) * 100
            : null,
      },
      engagement: {
        views: analytics._sum.views ?? 0,
        starts,
        // A "completion" is a persisted submission; there is no separate
        // counter, so the rate is submissions/starts. It can exceed 100% only
        // if starts were under-recorded, so clamp for display sanity.
        completionRate: starts > 0 ? Math.min((totalSubmissions / starts) * 100, 100) : null,
        avgCompletionMs:
          totalSubmissions > 0 ? Math.round(Number(sumCompletionMs) / totalSubmissions) : null,
      },
      storage: {
        // BigInt does not survive JSON.stringify; send it as a string and let
        // the client format it.
        usedBytes: (org?.storageUsedBytes ?? BigInt(0)).toString(),
        quotaBytes: org?.storageQuotaBytes ? org.storageQuotaBytes.toString() : null,
      },
      windowDays,
    };
  }

  /**
   * The organization's busiest forms, for the dashboard's "top forms" list.
   */
  async getTopForms(orgId: string, limit = 5) {
    const bounded = Math.min(Math.max(limit, 1), 25);

    const grouped = await this.prisma.reader.formAnalytics.groupBy({
      by: ['formId'],
      where: { form: { organizationId: orgId, deletedAt: null } },
      _sum: { submissions: true, views: true },
      orderBy: { _sum: { submissions: 'desc' } },
      take: bounded,
    });

    if (grouped.length === 0) return [];

    const forms = await this.prisma.reader.form.findMany({
      where: { id: { in: grouped.map((row) => row.formId) } },
      select: { id: true, title: true, slug: true, status: true },
    });

    const byId = new Map(forms.map((form) => [form.id, form]));

    return grouped
      .map((row) => {
        const form = byId.get(row.formId);
        if (!form) return null;
        return {
          ...form,
          submissions: row._sum.submissions ?? 0,
          views: row._sum.views ?? 0,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);
  }
}
