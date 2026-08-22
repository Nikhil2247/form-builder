import type Anthropic from '@anthropic-ai/sdk';
import type { PrismaService } from '../../../common/infra/prisma/prisma.service';
import type { AdminService } from '../../admin/admin.service';

export const CROSS_ORG_QUERY_TOOL: Anthropic.Tool = {
  name: 'cross_org_query',
  description:
    'Query aggregated data across ALL organizations (PMUs) on the platform — platform-wide totals, a per-organization breakdown (forms by status, submissions this month, member count, quota utilization), organizations approaching a quota limit, or a platform-wide daily submissions adoption trend. Every result is aggregated across organizations, never a single respondent\'s answers. "Cross-PMU" today means "cross-organization" — each PMU is one Organization, there is no separate program/geography model yet.',
  input_schema: {
    type: 'object',
    properties: {
      view: {
        type: 'string',
        enum: [
          'platform_summary',
          'org_breakdown',
          'quota_watch',
          'adoption_trend',
        ],
        description:
          'platform_summary: headline platform-wide counts (orgs, users, forms, submissions) plus the 5 most recently created orgs. org_breakdown: per-org stats (forms by status, submissions this month, members, quota utilization) for comparing organizations. quota_watch: only the organizations closest to or over a submission/AI-query quota. adoption_trend: platform-wide daily submission counts over time.',
      },
      limit: {
        type: 'number',
        description:
          'Only for view=org_breakdown or view=quota_watch — max organizations to return. Default 20, max 100.',
      },
      threshold: {
        type: 'number',
        description:
          'Only for view=quota_watch — minimum quota utilization (0-1) to include, e.g. 0.8 for "80% or more used". Default 0.8.',
      },
      days: {
        type: 'number',
        description:
          'Only for view=adoption_trend — how many days back to look. Default 30, max 180.',
      },
    },
    required: ['view'],
  },
};

interface CrossOrgQueryInput {
  view?: unknown;
  limit?: unknown;
  threshold?: unknown;
  days?: unknown;
}

interface OrgBreakdownRow {
  orgId: string;
  name: string;
  slug: string;
  isActive: boolean;
  members: number;
  totalForms: number;
  publishedForms: number;
  draftForms: number;
  submissionsThisMonth: number;
  maxSubmissionsMonth: number;
  submissionQuotaUtilization: number;
  aiQueriesThisMonth: number;
  maxAiQueriesMonth: number;
  aiQuotaUtilization: number;
}

function clampInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const n =
    typeof value === 'number' && Number.isFinite(value)
      ? Math.trunc(value)
      : fallback;
  return Math.min(max, Math.max(min, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function startOfMonthUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Shared by org_breakdown and quota_watch. Three bulk queries regardless of
 * how many orgs exist (findMany + two groupBys), not one query per org.
 */
async function loadOrgBreakdown(
  prisma: PrismaService,
  limit: number,
): Promise<OrgBreakdownRow[]> {
  const orgs = await prisma.reader.organization.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      name: true,
      slug: true,
      isActive: true,
      maxSubmissionsMonth: true,
      maxAiQueriesMonth: true,
      aiQueriesThisMonth: true,
      _count: { select: { members: true, forms: true } },
    },
  });
  if (orgs.length === 0) return [];

  const orgIds = orgs.map((org) => org.id);
  const monthStart = startOfMonthUtc();

  const [formStatusRows, submissionRows] = await Promise.all([
    prisma.reader.form.groupBy({
      by: ['organizationId', 'status'],
      where: { organizationId: { in: orgIds } },
      _count: { _all: true },
    }),
    prisma.reader.formSubmission.groupBy({
      by: ['organizationId'],
      where: {
        organizationId: { in: orgIds },
        occurredAt: { gte: monthStart },
        deletedAt: null,
      },
      _count: { _all: true },
    }),
  ]);

  const publishedByOrg = new Map<string, number>();
  const draftByOrg = new Map<string, number>();
  for (const row of formStatusRows) {
    if (!row.organizationId) continue;
    if (row.status === 'PUBLISHED')
      publishedByOrg.set(row.organizationId, row._count._all);
    if (row.status === 'DRAFT')
      draftByOrg.set(row.organizationId, row._count._all);
  }
  const submissionsByOrg = new Map(
    submissionRows
      .filter(
        (row): row is typeof row & { organizationId: string } =>
          !!row.organizationId,
      )
      .map((row) => [row.organizationId, row._count._all]),
  );

  return orgs.map((org) => {
    const submissionsThisMonth = submissionsByOrg.get(org.id) ?? 0;
    return {
      orgId: org.id,
      name: org.name,
      slug: org.slug,
      isActive: org.isActive,
      members: org._count.members,
      totalForms: org._count.forms,
      publishedForms: publishedByOrg.get(org.id) ?? 0,
      draftForms: draftByOrg.get(org.id) ?? 0,
      submissionsThisMonth,
      maxSubmissionsMonth: org.maxSubmissionsMonth,
      submissionQuotaUtilization:
        org.maxSubmissionsMonth > 0
          ? round2(submissionsThisMonth / org.maxSubmissionsMonth)
          : 0,
      aiQueriesThisMonth: org.aiQueriesThisMonth,
      maxAiQueriesMonth: org.maxAiQueriesMonth,
      aiQuotaUtilization:
        org.maxAiQueriesMonth > 0
          ? round2(org.aiQueriesThisMonth / org.maxAiQueriesMonth)
          : 0,
    };
  });
}

/**
 * Deliberately no orgId parameter or filter anywhere in this file — this is
 * the one tool allowed to read across the tenant boundary. It must only ever
 * be registered on PlatformInsightsService's tool list; see
 * platform-insights.spec.ts.
 */
export async function crossOrgQuery(
  prisma: PrismaService,
  admin: AdminService,
  rawInput: CrossOrgQueryInput,
): Promise<string> {
  switch (rawInput.view) {
    case 'platform_summary': {
      const dashboard = await admin.getDashboard();
      return JSON.stringify(dashboard);
    }

    case 'org_breakdown': {
      const limit = clampInt(rawInput.limit, 20, 1, 100);
      const rows = await loadOrgBreakdown(prisma, limit);
      return JSON.stringify({ orgs: rows });
    }

    case 'quota_watch': {
      const limit = clampInt(rawInput.limit, 20, 1, 100);
      const threshold =
        typeof rawInput.threshold === 'number' &&
        rawInput.threshold >= 0 &&
        rawInput.threshold <= 1
          ? rawInput.threshold
          : 0.8;
      const rows = await loadOrgBreakdown(prisma, Math.max(limit, 100));
      const flagged = rows
        .filter(
          (row) =>
            row.submissionQuotaUtilization >= threshold ||
            row.aiQuotaUtilization >= threshold,
        )
        .sort(
          (a, b) =>
            Math.max(b.submissionQuotaUtilization, b.aiQuotaUtilization) -
            Math.max(a.submissionQuotaUtilization, a.aiQuotaUtilization),
        )
        .slice(0, limit);
      return JSON.stringify({ threshold, orgs: flagged });
    }

    case 'adoption_trend': {
      const days = clampInt(rawInput.days, 30, 1, 180);
      const since = new Date();
      since.setUTCDate(since.getUTCDate() - days);

      const rows = await prisma.reader.$queryRaw<
        Array<{ day: Date; count: bigint }>
      >`
        SELECT date_trunc('day', occurred_at) AS day, count(*)::bigint AS count
        FROM form_submissions
        WHERE occurred_at >= ${since} AND deleted_at IS NULL
        GROUP BY day
        ORDER BY day ASC
      `;

      return JSON.stringify({
        days,
        series: rows.map((row) => ({
          date: row.day.toISOString().slice(0, 10),
          submissions: Number(row.count),
        })),
      });
    }

    default:
      return 'Unknown view — must be one of "platform_summary", "org_breakdown", "quota_watch", "adoption_trend".';
  }
}
