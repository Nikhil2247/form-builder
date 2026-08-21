'use client';

import { useState } from 'react';
import { Building2, Coins, Gauge, MessagesSquare } from 'lucide-react';

import {
  PageHeader,
  PageShell,
  DataTable,
  StatCard,
  StatGrid,
  EmptyState,
  ErrorState,
  FilterSelect,
  type DataTableColumn,
} from '@/components/shared';
import { formatCompact, formatCost } from '@/components/shared/formatters';
import { usePlatformAssistantUsage, type AssistantUsageRow } from '@/hooks/use-assistant';

/**
 * Cross-org AI assistant usage — AI_ASSISTANT_IMPROVEMENT_PLAN.md §3.8.
 *
 * Visibility only: which orgs are using the assistant, and how much it costs
 * in tokens and dollars. There is no spend ceiling here — the org explicitly
 * chose observability over enforcement (see the plan's §6 decision 3).
 */

const RANGE_OPTIONS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
];

export default function PlatformAssistantUsagePage() {
  const [days, setDays] = useState('30');
  const { data: rows, isLoading, error, refetch } = usePlatformAssistantUsage(Number(days));

  const totals = (rows ?? []).reduce(
    (acc, row) => ({
      queries: acc.queries + row.totalQueries,
      inputTokens: acc.inputTokens + row.inputTokens,
      outputTokens: acc.outputTokens + row.outputTokens,
      costUsd: acc.costUsd + row.costUsd,
    }),
    { queries: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
  );

  return (
    <PageShell>
      <PageHeader
        title="Assistant usage"
        description="Token volume and cost across every organization, sorted by spend."
        actions={
          <FilterSelect
            label="Date range"
            value={days}
            onChange={setDays}
            options={RANGE_OPTIONS}
          />
        }
      />

      {error && !rows ? (
        <ErrorState title="Could not load usage" error={error} onRetry={() => refetch()} />
      ) : (
        <>
          <StatGrid>
            <StatCard
              label="Total queries"
              icon={MessagesSquare}
              isLoading={isLoading}
              value={formatCompact(totals.queries)}
            />
            <StatCard
              label="Input tokens"
              icon={Gauge}
              isLoading={isLoading}
              value={formatCompact(totals.inputTokens)}
            />
            <StatCard
              label="Output tokens"
              icon={Gauge}
              isLoading={isLoading}
              value={formatCompact(totals.outputTokens)}
            />
            <StatCard
              label="Total cost"
              icon={Coins}
              isLoading={isLoading}
              value={formatCost(totals.costUsd)}
            />
          </StatGrid>

          <UsageTable rows={rows ?? []} isLoading={isLoading} />
        </>
      )}
    </PageShell>
  );
}

function UsageTable({ rows, isLoading }: { rows: AssistantUsageRow[]; isLoading: boolean }) {
  const columns: DataTableColumn<AssistantUsageRow>[] = [
    {
      id: 'organization',
      header: 'Organization',
      isRowHeader: true,
      cell: (row) => (
        <div className="flex items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Building2 className="size-4" strokeWidth={1.5} />
          </span>
          <span className="min-w-0 truncate font-medium text-foreground">
            {row.organizationName}
          </span>
        </div>
      ),
    },
    {
      id: 'queries',
      header: 'Queries',
      numeric: true,
      width: 'w-24',
      cell: (row) => row.totalQueries.toLocaleString(),
    },
    {
      id: 'inputTokens',
      header: 'Input tokens',
      numeric: true,
      width: 'w-32',
      hideBelow: 'md',
      cell: (row) => formatCompact(row.inputTokens),
    },
    {
      id: 'outputTokens',
      header: 'Output tokens',
      numeric: true,
      width: 'w-32',
      hideBelow: 'md',
      cell: (row) => formatCompact(row.outputTokens),
    },
    {
      id: 'cacheHitRate',
      header: 'Cache hit rate',
      numeric: true,
      width: 'w-32',
      hideBelow: 'lg',
      cell: (row) =>
        row.cacheHitRate === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          `${Math.round(row.cacheHitRate * 100)}%`
        ),
    },
    {
      id: 'cost',
      header: 'Cost',
      numeric: true,
      width: 'w-28',
      cell: (row) => <span className="font-medium">{formatCost(row.costUsd)}</span>,
    },
  ];

  return (
    <DataTable
      caption="Assistant usage by organization"
      columns={columns}
      data={rows}
      getRowId={(row) => row.organizationId ?? 'platform'}
      isLoading={isLoading}
      skeletonRows={6}
      empty={
        <EmptyState
          variant="inline"
          icon={MessagesSquare}
          title="No assistant activity"
          description="No organization asked the assistant anything in this window."
        />
      }
    />
  );
}
