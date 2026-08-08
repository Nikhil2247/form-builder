'use client';

import React from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Database,
  Layers,
  MemoryStick,
  Plug,
  RefreshCw,
  Server,
  Timer,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  PageHeader,
  PageShell,
  DataTable,
  StatCard,
  StatGrid,
  StatusBadge,
  EmptyState,
  ErrorState,
  RelativeTime,
  type DataTableColumn,
  type StatusTone,
} from '@/components/shared';
import { formatBytes, formatCompact, formatDuration } from '@/components/shared/formatters';
import { cn } from '@/lib/utils';
import {
  useSystemOverview,
  type DatabaseTableStat,
  type DependencyProbe,
  type ProbeStatus,
  type QueueStat,
  type RedisStats,
  type SystemProcess,
} from '@/hooks/use-admin';

/**
 * Infrastructure health.
 *
 * This is the page an operator opens when something is wrong, so it is built to
 * survive things being wrong: every section renders from whatever the API
 * managed to collect, and a dependency that failed says which one and why
 * rather than collapsing the whole view into one red box.
 *
 * The figures under "Runtime" describe the ONE process that answered this
 * request. In a multi-pod deployment that is whichever pod the load balancer
 * picked — labelled as such, because a memory number that silently means
 * "one of five pods" is worse than no number.
 */

const POLL_MS = 15_000;

const PROBE_TONE: Record<ProbeStatus, StatusTone> = {
  up: 'success',
  degraded: 'warning',
  down: 'danger',
};

const PROBE_LABEL: Record<ProbeStatus, string> = {
  up: 'Operational',
  degraded: 'Degraded',
  down: 'Down',
};

const BANNER_HEADLINE: Record<ProbeStatus, string> = {
  up: 'All dependencies responding',
  degraded: 'Running, but slower than expected',
  down: 'One or more dependencies are down',
};

const BANNER_CLASS: Record<ProbeStatus, string> = {
  up: 'border-success/20 bg-success/5 text-success',
  degraded: 'border-warning/25 bg-warning/5 text-warning',
  down: 'border-destructive/20 bg-destructive/5 text-destructive',
};

export default function PlatformSystemPage() {
  const { data, isLoading, isFetching, error, refetch, dataUpdatedAt } = useSystemOverview({
    refetchInterval: POLL_MS,
  });

  const health = data?.health;
  const queues = data?.queues ?? [];
  const database = data?.database;
  const redis = data?.redis;
  const runtime = data?.process;

  const failedJobs = queues.reduce((sum, queue) => sum + queue.failed, 0);

  return (
    <PageShell>
      <PageHeader
        title="System"
        description={`Dependency probes, queue depth, and infrastructure statistics. Refreshes every ${POLL_MS / 1000} seconds.`}
        actions={
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              {dataUpdatedAt ? (
                <>
                  Last checked <RelativeTime value={health?.checkedAt ?? dataUpdatedAt} />
                </>
              ) : (
                'Not checked yet'
              )}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={cn('size-3.5', isFetching && 'animate-spin')} />
              Refresh
            </Button>
          </div>
        }
      />

      {error && !data ? (
        <ErrorState
          title="Could not reach the platform API"
          error={error}
          onRetry={() => refetch()}
        />
      ) : (
        <>
          <HealthBanner health={health?.status} checkedAt={health?.checkedAt} isLoading={isLoading} />

          {error && data && (
            <p className="rounded-lg border border-warning/25 bg-warning/5 px-3 py-2 text-xs text-warning">
              The last refresh failed. The figures below are from{' '}
              <RelativeTime value={dataUpdatedAt} />.
            </p>
          )}

          <StatGrid>
            <StatCard
              label="Failed jobs"
              icon={AlertTriangle}
              isLoading={isLoading}
              value={formatCompact(failedJobs)}
              hint={failedJobs > 0 ? 'Retained until cleared — inspect the queues' : 'Nothing to clear'}
            />
            <StatCard
              label="Database size"
              icon={Database}
              isLoading={isLoading}
              value={database?.size ?? '—'}
              hint={
                database?.reachable
                  ? `${database.connections.active} active / ${database.connections.total} connections`
                  : 'Unreachable'
              }
            />
            <StatCard
              label="Redis memory"
              icon={MemoryStick}
              isLoading={isLoading}
              value={redis?.reachable ? redis.usedMemory : '—'}
              hint={redis?.reachable ? `Peak ${redis.peakMemory}` : 'Unreachable'}
            />
            <StatCard
              label="Process uptime"
              icon={Timer}
              isLoading={isLoading}
              value={
                runtime ? formatDuration(runtime.uptimeSeconds * 1000) : '—'
              }
              hint={runtime ? `${runtime.processRole} · ${runtime.environment}` : undefined}
            />
          </StatGrid>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold">Dependencies</h2>
            {isLoading && !health ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Card key={i} className="h-28 animate-pulse p-5" />
                ))}
              </div>
            ) : health && health.dependencies.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {health.dependencies.map((dependency) => (
                  <ProbeCard key={dependency.name} probe={dependency} />
                ))}
              </div>
            ) : (
              <EmptyState
                icon={Plug}
                title="No dependency probes reported"
                description="The API answered but listed no dependencies to check."
              />
            )}
          </section>

          <section className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold">Queues</h2>
              <span className="text-xs text-muted-foreground">
                Failures are retained, not discarded — a non-zero count needs attention.
              </span>
            </div>
            <QueueTable queues={queues} isLoading={isLoading} />
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <RuntimeCard runtime={runtime} isLoading={isLoading} />
            <RedisCard redis={redis} isLoading={isLoading} />
          </div>

          <section className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold">Database</h2>
              <span className="text-xs text-muted-foreground">
                Row counts are planner estimates, not exact counts.
              </span>
            </div>

            {database && !database.reachable ? (
              <ErrorState
                title="Database statistics unavailable"
                error="The statistics queries did not complete. The database may be unreachable from the API process."
                variant="inline"
              />
            ) : (
              <>
                <StatGrid>
                  <StatCard
                    label="Total size"
                    isLoading={isLoading}
                    value={database?.size ?? '—'}
                    hint={database ? formatBytes(database.sizeBytes) : undefined}
                  />
                  <StatCard
                    label="Connections"
                    isLoading={isLoading}
                    value={database ? database.connections.total.toLocaleString() : '—'}
                  />
                  <StatCard
                    label="Active"
                    isLoading={isLoading}
                    value={database ? database.connections.active.toLocaleString() : '—'}
                  />
                  <StatCard
                    label="Idle"
                    isLoading={isLoading}
                    value={database ? database.connections.idle.toLocaleString() : '—'}
                  />
                </StatGrid>

                <TableSizeTable tables={database?.tables ?? []} isLoading={isLoading} />
              </>
            )}
          </section>
        </>
      )}
    </PageShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function HealthBanner({
  health,
  checkedAt,
  isLoading,
}: {
  health: ProbeStatus | undefined;
  checkedAt: string | undefined;
  isLoading: boolean;
}) {
  if (isLoading && !health) {
    return <div className="h-20 animate-pulse rounded-xl border border-border bg-card" />;
  }
  if (!health) return null;

  const Icon = health === 'up' ? CheckCircle2 : AlertTriangle;

  return (
    <div
      role="status"
      className={cn(
        'flex flex-wrap items-center gap-4 rounded-xl border px-5 py-4',
        BANNER_CLASS[health],
      )}
    >
      <Icon className="size-6 shrink-0" strokeWidth={1.5} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{BANNER_HEADLINE[health]}</p>
        <p className="mt-0.5 text-xs text-foreground/70">
          Probed <RelativeTime value={checkedAt} />
        </p>
      </div>
      <StatusBadge status={health.toUpperCase()} tone={PROBE_TONE[health]} label={PROBE_LABEL[health]} dot />
    </div>
  );
}

function ProbeCard({ probe }: { probe: DependencyProbe }) {
  return (
    <Card className="gap-3 p-5">
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-medium text-foreground" title={probe.name}>
          {probe.name}
        </span>
        <StatusBadge
          status={probe.status.toUpperCase()}
          tone={PROBE_TONE[probe.status]}
          label={PROBE_LABEL[probe.status]}
          dot
        />
      </div>

      <div className="tabular text-2xl font-semibold tracking-tight text-foreground">
        {probe.latencyMs === null ? '—' : `${probe.latencyMs} ms`}
      </div>

      <p
        className={cn(
          'text-xs',
          probe.error ? 'text-destructive' : 'text-muted-foreground',
        )}
      >
        {probe.error ?? probe.detail ?? 'No detail reported'}
      </p>
    </Card>
  );
}

function QueueTable({ queues, isLoading }: { queues: QueueStat[]; isLoading: boolean }) {
  const columns: DataTableColumn<QueueStat>[] = [
    {
      id: 'name',
      header: 'Queue',
      isRowHeader: true,
      cell: (queue) => (
        <div className="flex items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Layers className="size-4" strokeWidth={1.5} />
          </span>
          <div className="min-w-0">
            <div className="truncate font-medium text-foreground">{queue.name}</div>
            {!queue.reachable && (
              <div className="text-xs text-destructive">Counts unavailable</div>
            )}
          </div>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'State',
      width: 'w-32',
      cell: (queue) =>
        !queue.reachable ? (
          <StatusBadge status="UNREACHABLE" tone="danger" label="Unreachable" dot />
        ) : queue.paused ? (
          <StatusBadge status="PAUSED" tone="warning" label="Paused" dot />
        ) : (
          <StatusBadge status="RUNNING" tone="success" label="Running" dot />
        ),
    },
    {
      id: 'waiting',
      header: 'Waiting',
      numeric: true,
      width: 'w-24',
      cell: (queue) => queue.waiting.toLocaleString(),
    },
    {
      id: 'active',
      header: 'Active',
      numeric: true,
      width: 'w-24',
      cell: (queue) => queue.active.toLocaleString(),
    },
    {
      id: 'delayed',
      header: 'Delayed',
      numeric: true,
      width: 'w-24',
      hideBelow: 'md',
      cell: (queue) => queue.delayed.toLocaleString(),
    },
    {
      id: 'completed',
      header: 'Completed',
      numeric: true,
      width: 'w-28',
      hideBelow: 'lg',
      cell: (queue) => queue.completed.toLocaleString(),
    },
    {
      id: 'failed',
      header: 'Failed',
      numeric: true,
      width: 'w-24',
      // The one number on this table that means "go and do something".
      cell: (queue) => (
        <span
          className={cn(
            queue.failed > 0 && 'inline-flex items-center gap-1.5 font-semibold text-destructive',
          )}
        >
          {queue.failed > 0 && <AlertTriangle className="size-3.5" />}
          {queue.failed.toLocaleString()}
        </span>
      ),
    },
  ];

  return (
    <DataTable
      caption="Background queue depth"
      columns={columns}
      data={queues}
      getRowId={(queue) => queue.name}
      isLoading={isLoading}
      skeletonRows={3}
      empty={
        <EmptyState
          variant="inline"
          icon={Layers}
          title="No queues reported"
          description="The API process registered no background queues."
        />
      }
    />
  );
}

function TableSizeTable({
  tables,
  isLoading,
}: {
  tables: DatabaseTableStat[];
  isLoading: boolean;
}) {
  const columns: DataTableColumn<DatabaseTableStat>[] = [
    {
      id: 'name',
      header: 'Table',
      isRowHeader: true,
      cell: (table) => <span className="font-mono text-xs">{table.name}</span>,
    },
    {
      id: 'rows',
      header: 'Estimated rows',
      numeric: true,
      width: 'w-40',
      cell: (table) => table.estimatedRows.toLocaleString(),
    },
    {
      id: 'size',
      header: 'Size on disk',
      numeric: true,
      width: 'w-32',
      cell: (table) => table.size,
    },
  ];

  return (
    <DataTable
      caption="Largest tables by total relation size"
      columns={columns}
      data={tables}
      getRowId={(table) => table.name}
      isLoading={isLoading}
      skeletonRows={6}
      empty={
        <EmptyState
          variant="inline"
          icon={Database}
          title="No table statistics"
          description="The catalogue query returned no rows for the public schema."
        />
      }
    />
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-2 last:border-0">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="tabular min-w-0 truncate text-right text-sm text-foreground">{value}</dd>
    </div>
  );
}

function RuntimeCard({
  runtime,
  isLoading,
}: {
  runtime: SystemProcess | undefined;
  isLoading: boolean;
}) {
  return (
    <Card className="gap-4 p-5">
      <div className="flex items-center gap-2">
        <Server className="size-4 text-muted-foreground" strokeWidth={1.5} />
        <h2 className="text-sm font-semibold">Runtime</h2>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">
        Describes the single process that served this request, not the fleet.
      </p>

      {isLoading && !runtime ? (
        <div className="h-52 animate-pulse rounded-lg bg-muted" />
      ) : !runtime ? (
        <p className="text-sm text-muted-foreground">Not reported.</p>
      ) : (
        <dl>
          <Fact label="Environment" value={runtime.environment} />
          <Fact label="Process role" value={runtime.processRole} />
          <Fact label="Node" value={runtime.nodeVersion} />
          <Fact label="Platform" value={runtime.platform} />
          <Fact label="PID" value={runtime.pid} />
          <Fact label="Uptime" value={formatDuration(runtime.uptimeSeconds * 1000)} />
          <Fact
            label="Heap"
            value={`${runtime.memory.heapUsedMb} / ${runtime.memory.heapTotalMb} MB`}
          />
          <Fact label="RSS" value={`${runtime.memory.rssMb} MB`} />
          <Fact label="External" value={`${runtime.memory.externalMb} MB`} />
        </dl>
      )}
    </Card>
  );
}

function RedisCard({ redis, isLoading }: { redis: RedisStats | undefined; isLoading: boolean }) {
  return (
    <Card className="gap-4 p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Cpu className="size-4 text-muted-foreground" strokeWidth={1.5} />
          <h2 className="text-sm font-semibold">Redis</h2>
        </div>
        {redis && (
          <StatusBadge
            status={redis.reachable ? 'UP' : 'DOWN'}
            tone={redis.reachable ? 'success' : 'danger'}
            label={redis.reachable ? 'Reachable' : 'Unreachable'}
            dot
          />
        )}
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">
        Cache, rate limiting, and the BullMQ job store all share this instance.
      </p>

      {isLoading && !redis ? (
        <div className="h-52 animate-pulse rounded-lg bg-muted" />
      ) : !redis ? (
        <p className="text-sm text-muted-foreground">Not reported.</p>
      ) : !redis.reachable ? (
        <p className="text-sm text-destructive">
          Redis did not answer INFO. Queues, caching, and rate limiting are affected.
        </p>
      ) : (
        <dl>
          <Fact label="Version" value={redis.version} />
          <Fact label="Memory in use" value={redis.usedMemory} />
          <Fact label="Peak memory" value={redis.peakMemory} />
          <Fact label="Connected clients" value={redis.connectedClients.toLocaleString()} />
          <Fact label="Uptime" value={formatDuration(redis.uptimeSeconds * 1000)} />
          <Fact
            label="Operations / sec"
            value={
              <span className="inline-flex items-center gap-1.5">
                <Activity className="size-3.5 text-muted-foreground" />
                {redis.opsPerSecond.toLocaleString()}
              </span>
            }
          />
          <Fact
            label="Cache hit rate"
            value={
              // Null means no lookups yet — showing 0% would read as a broken cache.
              redis.hitRate === null ? (
                <span className="text-muted-foreground">No lookups yet</span>
              ) : (
                `${redis.hitRate}%`
              )
            }
          />
        </dl>
      )}
    </Card>
  );
}
