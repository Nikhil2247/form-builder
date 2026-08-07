'use client';

import React from 'react';
import { PageHeader, PageShell, AuditLogTable } from '@/components/shared';
import { usePagination } from '@/hooks/use-pagination';
import { useOrgId } from '@/hooks/use-auth';
import { useOrgAudit } from '@/hooks/use-audit';

export default function OrgAuditPage() {
  const orgId = useOrgId();
  const pager = usePagination();

  const { data, isLoading, isFetching, error, refetch } = useOrgAudit(orgId, {
    page: pager.page,
    limit: pager.pageSize,
  });

  return (
    <PageShell>
      <PageHeader
        title="Audit log"
        description="A record of every action taken in this organization. Entries are immutable."
      />

      <AuditLogTable
        logs={data?.logs}
        isLoading={isLoading || isFetching}
        error={error}
        onRetry={() => refetch()}
        pagination={pager.paginationProps(data?.pagination?.total ?? 0, 'entries')}
      />
    </PageShell>
  );
}
