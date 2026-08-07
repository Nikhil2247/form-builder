'use client';

import React, { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
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
      cell: (form) => form.views.toLocaleString(),
    },
    {
      id: 'submissions',
      header: 'Responses',
      numeric: true,
      width: 'w-28',
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
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="fill-submissions" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="fill-views" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-3)" stopOpacity={0.18} />
                    <stop offset="100%" stopColor="var(--chart-3)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>

                <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  // A 365-day range would otherwise print 365 overlapping labels.
                  interval={Math.max(0, Math.floor(chartData.length / 8) - 1)}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={44}
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                />
                <Tooltip
                  cursor={{ stroke: 'var(--border-strong)' }}
                  contentStyle={{
                    background: 'var(--popover)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    fontSize: 12,
                    color: 'var(--popover-foreground)',
                  }}
                  labelStyle={{ color: 'var(--muted-foreground)', marginBottom: 4 }}
                />
                <Area
                  type="monotone"
                  dataKey="views"
                  name="Views"
                  stroke="var(--chart-3)"
                  fill="url(#fill-views)"
                  strokeWidth={1.5}
                />
                <Area
                  type="monotone"
                  dataKey="submissions"
                  name="Responses"
                  stroke="var(--chart-1)"
                  fill="url(#fill-submissions)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
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
