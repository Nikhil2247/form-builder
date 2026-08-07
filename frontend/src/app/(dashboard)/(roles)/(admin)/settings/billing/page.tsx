'use client';

import React from 'react';
import { Database, FileBox, Inbox, Users } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/shared';
import { formatBytes } from '@/components/shared/formatters';
import { useOrganizationDetail } from '@/hooks/use-organization';
import { useOrgSummary } from '@/hooks/use-analytics';

/**
 * Plan and quota usage.
 *
 * Every number here comes from the API. The previous version fell back to
 * invented figures — `orgData?.forms?.length || 12`, `submissionsThisMonth ||
 * 4521`, `storageUsedBytes || 1.2GB` — using `||`, so a genuine zero was
 * replaced by the fake value. A brand-new organization was shown 12 forms and
 * 4,521 responses it did not have.
 */
export default function BillingSettingsPage() {
  const org = useOrganizationDetail();
  const summary = useOrgSummary(30);

  if (org.error) {
    return <ErrorState title="Could not load your plan" error={org.error} onRetry={() => org.refetch()} />;
  }

  const isLoading = org.isLoading || summary.isLoading;
  const data = org.data;

  const quotas = [
    {
      label: 'Forms',
      icon: FileBox,
      used: summary.data?.forms.total,
      limit: numberOrNull(data?.maxForms),
      format: (value: number) => value.toLocaleString(),
    },
    {
      label: 'Responses this month',
      icon: Inbox,
      used: summary.data?.submissions.window,
      limit: numberOrNull(data?.maxSubmissionsMonth),
      format: (value: number) => value.toLocaleString(),
    },
    {
      label: 'Members',
      icon: Users,
      used: numberOrNull(data?._count?.members),
      limit: numberOrNull(data?.maxMembers),
      format: (value: number) => value.toLocaleString(),
    },
    {
      label: 'Storage',
      icon: Database,
      // BigInt columns are serialised as strings.
      used: numberOrNull(summary.data?.storage.usedBytes),
      limit: numberOrNull(summary.data?.storage.quotaBytes),
      format: formatBytes,
    },
  ];

  return (
    <div className="space-y-5">
      {/* Organization has no `plan` column, so there is no plan to display.
          The previous card showed "Free" for every organization — a `??`
          fallback on a field the API never returned. Quotas are the real,
          per-organization limits, so those are what this page reports. */}
      <Card className="overflow-hidden p-0">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold">Usage</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Against the quotas configured for this organization.
          </p>
        </div>

        <div className="divide-y divide-border">
          {quotas.map((quota) => (
            <QuotaRow key={quota.label} isLoading={isLoading} {...quota} />
          ))}
        </div>
      </Card>

      <p className="text-xs text-muted-foreground">
        Self-service plan changes are not available on this deployment. Contact your account
        administrator to adjust quotas.
      </p>
    </div>
  );
}

function QuotaRow({
  label,
  icon: Icon,
  used,
  limit,
  format,
  isLoading,
}: {
  label: string;
  icon: React.ElementType;
  used: number | null | undefined;
  limit: number | null;
  format: (value: number) => string;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="space-y-2 px-5 py-4">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-1.5 w-full" />
      </div>
    );
  }

  const hasUsage = typeof used === 'number' && Number.isFinite(used);
  const percent = hasUsage && limit ? Math.min(100, (used / limit) * 100) : null;

  return (
    <div className="space-y-2 px-5 py-4">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="flex items-center gap-2">
          <Icon className="size-3.5 text-muted-foreground" strokeWidth={1.5} />
          {label}
        </span>
        <span className="tabular text-muted-foreground">
          {hasUsage ? format(used) : '—'}
          {limit ? ` / ${format(limit)}` : ''}
        </span>
      </div>

      {percent !== null && (
        <div
          role="progressbar"
          aria-valuenow={Math.round(percent)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${label} usage`}
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        >
          <div
            className={cn(
              'h-full rounded-full transition-[width]',
              percent >= 90 ? 'bg-destructive' : percent >= 75 ? 'bg-warning' : 'bg-foreground/70',
            )}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
    </div>
  );
}

/** Accepts the string-encoded BigInts the API returns without silently NaN-ing. */
function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
