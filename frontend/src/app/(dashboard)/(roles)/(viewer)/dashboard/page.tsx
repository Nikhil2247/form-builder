'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {
  ArrowRight,
  BarChart2,
  CheckCircle2,
  Clock,
  Eye,
  FileBox,
  Inbox,
  Plus,
  Radio,
} from 'lucide-react';

import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  PageHeader,
  PageShell,
  StatCard,
  StatGrid,
  StatusBadge,
  EmptyState,
  ErrorState,
  RelativeTime,
  DataTable,
  FilterSelect,
  type DataTableColumn,
  ButtonLink,
} from '@/components/shared';
import { formatCompact, formatDuration } from '@/components/shared/formatters';
import { Can } from '@/components/auth/RoleGuard';
import { useUser, usePermissions } from '@/hooks/use-auth';
import { useOrgSummary, useOrgTimeseries, useTopForms, type TopForm } from '@/hooks/use-analytics';
import { useForms, type Form } from '@/hooks/use-forms';

/**
 * `recharts` is the heaviest thing on this route and nothing above the chart
 * needs it, so the summary tiles paint without waiting on it. Rendered only
 * once there is activity to plot, which also means an empty organization never
 * downloads a charting library at all.
 */
const ActivityChart = dynamic(() => import('@/components/analytics/ActivityChart'), {
  loading: () => <Skeleton className="h-64 w-full" />,
});

const RANGE_OPTIONS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
];

export default function DashboardPage() {
  const { data: session } = useUser();
  const { can } = usePermissions();
  const [range, setRange] = useState('30');
  const days = Number(range);

  const summary = useOrgSummary(30);
  const series = useOrgTimeseries(days);
  const topForms = useTopForms(5);
  // Five most recently edited forms. Sorting is done server-side; the previous
  // version fetched page 1 unsorted and called it "Recent".
  const recent = useForms({ page: 1, limit: 5, sort: 'updatedAt', direction: 'desc' });

  const firstName = session?.user?.firstName;
  const orgName = session?.activeOrganization?.name;

  const s = summary.data;

  /**
   * The API returns rows only for days that saw activity. Charting those
   * directly compressed a month of data into three bars and drew a straight
   * line between them, implying activity that did not happen. Fill the gaps
   * with explicit zeroes.
   */
  const chartData = useMemo(() => {
    const byDate = new Map<string, { submissions: number; views: number }>();
    for (const row of series.data ?? []) {
      const key = new Date(row.date).toISOString().slice(0, 10);
      byDate.set(key, { submissions: row.submissions ?? 0, views: row.views ?? 0 });
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

  return (
    <PageShell>
      <PageHeader
        title={firstName ? `Welcome back, ${firstName}` : 'Dashboard'}
        description={
          orgName ? `Activity across ${orgName} over the last 30 days.` : 'Your organization at a glance.'
        }
        actions={
          <Can permission="form:create">
            <ButtonLink size="sm" className="gap-2" href="/forms/builder">
              <Plus className="size-4" /> Create form
            </ButtonLink>
          </Can>
        }
      />

      {summary.error ? (
        <ErrorState
          title="Could not load your dashboard"
          error={summary.error}
          onRetry={() => summary.refetch()}
        />
      ) : (
        <StatGrid>
          <StatCard
            label="Forms"
            icon={FileBox}
            isLoading={summary.isLoading}
            value={formatCompact(s?.forms.total)}
            hint={
              s ? `${s.forms.published} published · ${s.forms.draft} draft` : undefined
            }
          />
          <StatCard
            label="Responses"
            icon={Inbox}
            isLoading={summary.isLoading}
            value={formatCompact(s?.submissions.total)}
            // Null rather than a fabricated "+12%" when there is no prior
            // period to compare against.
            delta={s?.submissions.changePercent ?? null}
            hint={s ? `${formatCompact(s.submissions.window)} in the last 30 days` : undefined}
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
                ? `${formatCompact(s.engagement.starts)} people started a form`
                : 'No form starts recorded yet'
            }
          />
          <StatCard
            label="Average time to complete"
            icon={Clock}
            isLoading={summary.isLoading}
            value={
              s?.engagement.avgCompletionMs != null
                ? formatDuration(s.engagement.avgCompletionMs)
                : '—'
            }
            hint={
              s?.engagement.views
                ? `${formatCompact(s.engagement.views)} form views`
                : undefined
            }
          />
        </StatGrid>
      )}

      <Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Activity</h2>
            <p className="text-xs text-muted-foreground">
              Daily views and responses across your organization&apos;s forms.
            </p>
          </div>
          <FilterSelect
            label="Date range"
            value={range}
            onChange={(value) => value && setRange(value)}
            options={RANGE_OPTIONS}
          />
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

      <div className="grid gap-5 lg:grid-cols-5">
        <section className="space-y-3 lg:col-span-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Recently edited</h2>
            <ButtonLink variant="link" size="sm" className="gap-1" href="/forms">
              All forms <ArrowRight className="size-3" />
            </ButtonLink>
          </div>

          <DataTable
            caption="Recently edited forms"
            columns={RECENT_COLUMNS}
            data={recent.data?.forms}
            getRowId={(form) => form.id}
            isLoading={recent.isLoading}
            error={recent.error}
            onRetry={() => recent.refetch()}
            rowHref={(form) => `/forms/${form.id}`}
            skeletonRows={5}
            empty={
              <EmptyState
                variant="inline"
                icon={FileBox}
                title="No forms yet"
                description="Create your first form to start collecting responses."
                action={
                  can('form:create') ? (
                    <ButtonLink size="sm" className="gap-2" href="/forms/builder">
                      <Plus className="size-4" /> Create form
                    </ButtonLink>
                  ) : undefined
                }
              />
            }
          />
        </section>

        <section className="space-y-3 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Most responses</h2>
            <ButtonLink variant="link" size="sm" className="gap-1" href="/submissions">
              Responses <ArrowRight className="size-3" />
            </ButtonLink>
          </div>

          <Card className="overflow-hidden p-0">
            {topForms.isLoading ? (
              <div className="space-y-3 p-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-9" />
                ))}
              </div>
            ) : (topForms.data?.length ?? 0) === 0 ? (
              <EmptyState
                variant="inline"
                icon={BarChart2}
                title="No responses yet"
                description="Publish a form and share its link to start collecting data."
              />
            ) : (
              <ul className="divide-y divide-border">
                {topForms.data!.map((form, index) => (
                  <TopFormRow key={form.id} form={form} rank={index + 1} />
                ))}
              </ul>
            )}
          </Card>
        </section>
      </div>
    </PageShell>
  );
}

const RECENT_COLUMNS: DataTableColumn<Form>[] = [
  {
    id: 'title',
    header: 'Form',
    isRowHeader: true,
    className: 'max-w-0',
    cell: (form) => (
      <div className="min-w-0">
        <div className="truncate font-medium text-foreground">{form.title}</div>
        <div className="truncate text-xs text-muted-foreground">
          <RelativeTime value={form.updatedAt} />
        </div>
      </div>
    ),
  },
  {
    id: 'status',
    header: 'Status',
    width: 'w-28',
    cell: (form) => <StatusBadge status={form.status} dot />,
  },
  {
    id: 'submissions',
    header: 'Responses',
    numeric: true,
    width: 'w-24',
    cell: (form) => (form._count?.submissions ?? 0).toLocaleString(),
  },
];

function TopFormRow({ form, rank }: { form: TopForm; rank: number }) {
  return (
    <li>
      <Link
        href={`/forms/${form.id}`}
        className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/60"
      >
        <span className="tabular flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">
          {rank}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{form.title}</p>
          <p className="tabular flex items-center gap-2.5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Inbox className="size-3" />
              {formatCompact(form.submissions)}
            </span>
            <span className="flex items-center gap-1">
              <Eye className="size-3" />
              {formatCompact(form.views)}
            </span>
          </p>
        </div>
        {form.status === 'PUBLISHED' && (
          <Radio className="size-3.5 shrink-0 text-success" aria-label="Live" />
        )}
      </Link>
    </li>
  );
}
