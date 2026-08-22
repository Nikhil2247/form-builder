import type Anthropic from '@anthropic-ai/sdk';
import type { PrismaService } from '../../../common/infra/prisma/prisma.service';

export const QUERY_SUBMISSIONS_TOOL: Anthropic.Tool = {
  name: 'query_submissions',
  description:
    "Count a form's submissions within a date range, optionally grouped by status or by Form App reporting period. Returns aggregate counts only — never individual response content — so use get_form_analytics first for anything a daily rollup already answers, and reach for this only when you need a dimension get_form_analytics doesn't have (status breakdown, a specific period-by-period comparison, a custom date range).",
  input_schema: {
    type: 'object',
    properties: {
      formId: {
        type: 'string',
        description: 'The form to count submissions for.',
      },
      groupBy: {
        type: 'string',
        enum: ['none', 'status', 'period'],
        description:
          '"status" breaks the count down by submission status. "period" breaks it down by Form App reporting period (only meaningful for a form that is a Form App step). "none" (default) returns a single total.',
      },
      from: {
        type: 'string',
        description:
          'ISO date, inclusive lower bound on when the submission occurred.',
      },
      to: {
        type: 'string',
        description:
          'ISO date, exclusive upper bound on when the submission occurred.',
      },
    },
    required: ['formId'],
  },
};

interface QuerySubmissionsInput {
  formId?: unknown;
  groupBy?: unknown;
  from?: unknown;
  to?: unknown;
}

export async function querySubmissions(
  prisma: PrismaService,
  orgId: string,
  rawInput: QuerySubmissionsInput,
): Promise<string> {
  const formId =
    typeof rawInput.formId === 'string' ? rawInput.formId : undefined;
  if (!formId) return 'A formId is required.';

  const form = await prisma.reader.form.findFirst({
    where: { id: formId, organizationId: orgId },
    select: { id: true, title: true },
  });
  if (!form)
    return `No form with id "${formId}" was found in this organization.`;

  const occurredAt: { gte?: Date; lt?: Date } = {};
  if (typeof rawInput.from === 'string') {
    const from = new Date(rawInput.from);
    if (!Number.isNaN(from.getTime())) occurredAt.gte = from;
  }
  if (typeof rawInput.to === 'string') {
    const to = new Date(rawInput.to);
    if (!Number.isNaN(to.getTime())) occurredAt.lt = to;
  }

  const where = {
    formId: form.id,
    organizationId: orgId,
    deletedAt: null,
    ...(occurredAt.gte || occurredAt.lt ? { occurredAt } : {}),
  };

  const groupBy =
    typeof rawInput.groupBy === 'string' ? rawInput.groupBy : 'none';

  if (groupBy === 'status') {
    const rows = await prisma.reader.formSubmission.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    });
    return JSON.stringify({
      form: form.title,
      groupedBy: 'status',
      rows: rows.map((row) => ({ status: row.status, count: row._count._all })),
    });
  }

  if (groupBy === 'period') {
    const rows = await prisma.reader.formSubmission.groupBy({
      by: ['periodId'],
      where,
      _count: { _all: true },
    });
    const periodIds = rows
      .map((row) => row.periodId)
      .filter((id): id is string => !!id);
    const periods = periodIds.length
      ? await prisma.reader.formAppPeriod.findMany({
          where: { id: { in: periodIds } },
          select: { id: true, label: true, startsAt: true, endsAt: true },
        })
      : [];
    const periodById = new Map(periods.map((period) => [period.id, period]));

    return JSON.stringify({
      form: form.title,
      groupedBy: 'period',
      rows: rows.map((row) => ({
        period: row.periodId ? (periodById.get(row.periodId) ?? null) : null,
        count: row._count._all,
      })),
    });
  }

  const total = await prisma.reader.formSubmission.count({ where });
  return JSON.stringify({ form: form.title, total });
}
