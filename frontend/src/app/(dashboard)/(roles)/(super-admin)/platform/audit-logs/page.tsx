'use client';

import React from 'react';
import { PageHeader, PageShell, AuditLogTable } from '@/components/shared';
import { usePagination } from '@/hooks/use-pagination';
import { useGlobalAudit } from '@/hooks/use-audit';

/**
 * Same data as /global-audit, reached from the platform section's own
 * navigation. Both routes exist in the nav, so both are kept rather than one
 * silently 404ing.
 */
export default function PlatformAuditLogsPage() {
  const pager = usePagination();

  const { data, isLoading, isFetching, error, refetch } = useGlobalAudit({
    page: pager.page,
    limit: pager.pageSize,
  });

  return (
    <PageShell>
      <PageHeader
        title="Audit logs"
        description="Immutable record of platform and organization activity."
      />

      <AuditLogTable
        logs={data?.logs}
        isLoading={isLoading || isFetching}
        error={error}
        onRetry={() => refetch()}
        showOrganization
        pagination={pager.paginationProps(data?.pagination?.total ?? 0, 'entries')}
      />
    </PageShell>
  );
}
