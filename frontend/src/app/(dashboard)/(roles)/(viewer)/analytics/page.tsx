'use client';

import React, { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { BarChart2, CheckCircle2, Clock, Eye, Inbox } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  PageHeader,
  PageShell,
  StatCard,
  StatGrid,
  EmptyState,
  ErrorState,
  Toolbar,
  FilterSelect,
  DataTable,
  StatusBadge,
  type DataTableColumn,
} from '@/components/shared';
import { formatCompact, formatDuration } from '@/components/shared/formatters';
import { useOrgSummary, useOrgTimeseries, useTopForms, type TopForm } from '@/hooks/use-analytics';

/**
 * `recharts` is the heaviest thing on this route and nothing above the chart
 * needs it, so the summary tiles paint without waiting on it. Rendered only
 * once there is activity to plot, which also means an empty organization never
 * downloads a charting library at all. Same skeleton as the loading state, so
 * arrival is not a layout jump.
 */
const ActivityChart = dynamic(() => import('@/components/analytics/ActivityChart'), {
  loading: () => <Skeleton className="h-64 w-full" />,
});

const RANGE_OPTIONS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '365', label: 'Last 12 months' },
];

export default function AnalyticsPage() {
  const [range, setRange] = useState('30');
  const days = Number(range);

  const summary = useOrgSummary(days);
  const series = useOrgTimeseries(days);
  const topForms = useTopForms(10);

  /**
   * The API returns rows only for days that saw activity. Charting those
   * directly compressed a month of data into three bars and drew a straight
   * line between them, implying activity that did not happen. Fill the gaps
   * with explicit zeroes.
   */
  const chartData = useMemo(() => {
    const byDate = new Map<string, { submissions: number; views: number; starts: number }>();
    for (const row of series.data ?? []) {
      const key = new Date(row.date).toISOString().slice(0, 10);
      byDate.set(key, {
        submissions: row.submissions ?? 0,
        views: row.views ?? 0,
        starts: row.starts ?? 0,
      });
    }

    const points: Array<{ date: string; label: string; submissions: number; views: number }> = [];
    const cursor = new Date();
    cursor.setUTCHours(0, 0, 0, 0);
    cursor.setUTCDate(cursor.getUTCDate() - (days - 1));

    for (let i = 0; i < days; i += 1) {
      const key = cursor.toISOString().slice(0, 10);
      const entry = byDate.get(key);
      points.push({
        date: key,
        label: cursor.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
        submissions: entry?.submissions ?? 0,
        views: entry?.views ?? 0,
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return points;
  }, [series.data, days]);

  const hasActivity = chartData.some((point) => point.submissions > 0 || point.views > 0);
  const s = summary.data;

  const topFormColumns: DataTableColumn<TopForm>[] = [
    {
      id: 'title',
      header: 'Form',
      isRowHeader: true,
      className: 'max-w-0',
      cell: (form) => <span className="truncate font-medium">{form.title}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      width: 'w-32',
      hideBelow: 'sm',
      cell: (form) => <StatusBadge status={form.status} dot />,
    },
    {
      id: 'views',
      header: 'Views',
      numeric: true,
      width: 'w-28',
      hideBelow: 'sm',
      cell: (form) => form.views.toLocaleString(),
    },
    {
      id: 'submissions',
      header: 'Responses',
      numeric: true,
      width: 'w-28',
      hideBelow: 'sm',
      cell: (form) => form.submissions.toLocaleString(),
    },
    {
      id: 'rate',
      header: 'Conversion',
      numeric: true,
      width: 'w-28',
      hideBelow: 'md',
      cell: (form) =>
        form.views > 0 ? `${Math.min((form.submissions / form.views) * 100, 100).toFixed(1)}%` : '—',
    },
  ];

  return (
    <PageShell>
      <PageHeader
        title="Analytics"
        description="Views, starts, and responses across your organization's forms."
      />

      <Toolbar>
        <FilterSelect
          label="Date range"
          value={range}
          onChange={(value) => value && setRange(value)}
          options={RANGE_OPTIONS}
        />
      </Toolbar>

      {summary.error ? (
        <ErrorState error={summary.error} onRetry={() => summary.refetch()} />
      ) : (
        <StatGrid>
          <StatCard
            label="Responses"
            icon={Inbox}
            isLoading={summary.isLoading}
            value={formatCompact(s?.submissions.window)}
            delta={s?.submissions.changePercent ?? null}
            hint={`${formatCompact(s?.submissions.total)} all time`}
          />
          <StatCard
            label="Views"
            icon={Eye}
            isLoading={summary.isLoading}
            value={formatCompact(s?.engagement.views)}
            hint="All time"
          />
          <StatCard
            label="Completion rate"
            icon={CheckCircle2}
            isLoading={summary.isLoading}
            value={
              s?.engagement.completionRate != null
                ? `${s.engagement.completionRate.toFixed(1)}%`
                : '—'
            }
            hint={
              s?.engagement.starts
                ? `${formatCompact(s.engagement.starts)} starts`
                : 'No starts recorded'
            }
          />
          <StatCard
            label="Average time"
            icon={Clock}
            isLoading={summary.isLoading}
            value={
              s?.engagement.avgCompletionMs != null
                ? formatDuration(s.engagement.avgCompletionMs)
                : '—'
            }
            hint="Per completed response"
          />
        </StatGrid>
      )}

      <Card className="space-y-4 p-5">
        <div>
          <h2 className="text-sm font-semibold">Activity</h2>
          <p className="text-xs text-muted-foreground">
            Daily views and responses over the selected range.
          </p>
        </div>

        {series.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : series.error ? (
          <ErrorState error={series.error} onRetry={() => series.refetch()} variant="inline" />
        ) : !hasActivity ? (
          <EmptyState
            variant="inline"
            icon={BarChart2}
            title="No activity in this period"
            description="Publish a form and share its link — views and responses will appear here."
          />
        ) : (
          <ActivityChart data={chartData} />
        )}
      </Card>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Forms by responses</h2>
        <DataTable
          caption="Forms ranked by total responses"
          columns={topFormColumns}
          data={topForms.data}
          getRowId={(form) => form.id}
          isLoading={topForms.isLoading}
          error={topForms.error}
          onRetry={() => topForms.refetch()}
          rowHref={(form) => `/forms/${form.id}`}
          skeletonRows={5}
          empty={
            <EmptyState
              variant="inline"
              icon={BarChart2}
              title="No form activity yet"
              description="Once forms start receiving views and responses they will be ranked here."
            />
          }
        />
      </section>
    </PageShell>
  );
}
