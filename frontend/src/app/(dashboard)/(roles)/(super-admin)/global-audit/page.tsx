'use client';

import React from 'react';
import { PageHeader, PageShell, AuditLogTable } from '@/components/shared';
import { usePagination } from '@/hooks/use-pagination';
import { useGlobalAudit } from '@/hooks/use-audit';

export default function GlobalAuditPage() {
  const pager = usePagination();

  const { data, isLoading, isFetching, error, refetch } = useGlobalAudit({
    page: pager.page,
    limit: pager.pageSize,
  });

  return (
    <PageShell>
      <PageHeader
        title="Platform audit log"
        description="Every audited action across every organization on this deployment."
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
