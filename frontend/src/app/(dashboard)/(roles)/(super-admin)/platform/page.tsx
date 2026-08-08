'use client';

import React from 'react';
import { Activity, ArrowRight, BarChart2, Building2, FileBox, Shield, Users } from 'lucide-react';

import { Card } from '@/components/ui/card';
import {
  ButtonLink,
  PageHeader,
  PageShell,
  StatCard,
  StatGrid,
  ErrorState,
} from '@/components/shared';
import { formatCompact } from '@/components/shared/formatters';
import { useAdminDashboard, type AdminDashboard } from '@/hooks/use-admin';

/**
 * The admin dashboard payload has been returned both flat and under `stats`.
 * Read both rather than showing an em dash on one of them.
 */
function metric(data: AdminDashboard | undefined, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = data?.stats?.[key] ?? data?.[key];
    if (typeof value === 'number') return value;
  }
  return undefined;
}

const QUICK_LINKS = [
  {
    href: '/platform/organizations',
    icon: Building2,
    label: 'Organizations',
    description: 'Review tenants, suspend accounts, and inspect quota usage.',
  },
  {
    href: '/platform/users',
    icon: Users,
    label: 'Users',
    description: 'Browse every account, its role, and its security posture.',
  },
  {
    href: '/platform/audit-logs',
    icon: Shield,
    label: 'Audit logs',
    description: 'Immutable trail of platform and organization activity.',
  },
  {
    href: '/platform/system',
    icon: Activity,
    label: 'System',
    // Not in the sidebar navigation, so this card is how it is found.
    description: 'Dependency probes, queue depth, database and Redis statistics.',
  },
];

export default function PlatformOverviewPage() {
  const { data, isLoading, error, refetch } = useAdminDashboard();

  return (
    <PageShell>
      <PageHeader
        title="Platform"
        description="Deployment-wide totals and administration."
      />

      {error ? (
        <ErrorState
          title="Could not load platform metrics"
          error={error}
          onRetry={() => refetch()}
        />
      ) : (
        <StatGrid>
          <StatCard
            label="Organizations"
            icon={Building2}
            isLoading={isLoading}
            value={formatCompact(metric(data, 'totalOrgs', 'totalOrganizations'))}
            hint={
              metric(data, 'activeOrgs') !== undefined
                ? `${formatCompact(metric(data, 'activeOrgs'))} active`
                : undefined
            }
          />
          <StatCard
            label="Users"
            icon={Users}
            isLoading={isLoading}
            value={formatCompact(metric(data, 'totalUsers'))}
          />
          <StatCard
            label="Forms"
            icon={FileBox}
            isLoading={isLoading}
            value={formatCompact(metric(data, 'totalForms'))}
          />
          <StatCard
            label="Responses"
            icon={BarChart2}
            isLoading={isLoading}
            value={formatCompact(metric(data, 'totalSubmissions'))}
          />
        </StatGrid>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Administration</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {QUICK_LINKS.map((link) => {
            const Icon = link.icon;
            return (
              <Card key={link.href} className="flex flex-col justify-between gap-4 p-5">
                <div>
                  <span className="mb-3 flex size-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <Icon className="size-4" strokeWidth={1.5} />
                  </span>
                  <h3 className="text-sm font-medium">{link.label}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{link.description}</p>
                </div>
                <ButtonLink
                  variant="outline"
                  size="sm"
                  className="w-full gap-1.5"
                 href={link.href}>
                  Open <ArrowRight className="size-3.5" />
                </ButtonLink>
              </Card>
            );
          })}
        </div>
      </section>
    </PageShell>
  );
}
