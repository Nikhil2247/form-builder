'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Inbox, User } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  ButtonLink,
  PageHeader,
  PageShell,
  DataTable,
  StatusBadge,
  EmptyState,
  Toolbar,
  SearchInput,
  RelativeTime,
  Duration,
  type DataTableColumn,
} from '@/components/shared';
import { SubmissionDetailsDialog } from '@/components/submissions/SubmissionDetailsDialog';
import { usePagination } from '@/hooks/use-pagination';
import { useOrgSubmissions, type Submission } from '@/hooks/use-submissions';

export default function OrgSubmissionsPage() {
  const pager = usePagination();
  const [selected, setSelected] = useState<Submission | null>(null);

  const { data, isLoading, isFetching, error, refetch } = useOrgSubmissions({
    page: pager.page,
    limit: pager.pageSize,
    search: pager.search,
  });

  const submissions = data?.submissions ?? [];
  const total = data?.pagination?.total ?? 0;

  const columns: DataTableColumn<Submission>[] = [
    {
      id: 'respondent',
      header: 'Respondent',
      isRowHeader: true,
      className: 'max-w-0',
      cell: (submission) => {
        const respondent = submission.respondent;
        const name = respondent
          ? `${respondent.firstName ?? ''} ${respondent.lastName ?? ''}`.trim()
          : '';

        return (
          <div className="flex items-center gap-2.5">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <User className="size-3.5" strokeWidth={1.5} />
            </span>
            <div className="min-w-0">
              <div className="truncate font-medium text-foreground">
                {name || respondent?.email || 'Anonymous'}
              </div>
              {name && respondent?.email && (
                <div className="truncate text-xs text-muted-foreground">{respondent.email}</div>
              )}
            </div>
          </div>
        );
      },
    },
    {
      id: 'form',
      header: 'Form',
      hideBelow: 'sm',
      className: 'max-w-0',
      cell: (submission) =>
        submission.form ? (
          <Link
            href={`/forms/${submission.form.id}`}
            className="truncate underline-offset-2 hover:underline"
            // The row is itself clickable; keep the two actions distinct.
            onClick={(e) => e.stopPropagation()}
          >
            {submission.form.title}
          </Link>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: 'status',
      header: 'Status',
      width: 'w-32',
      hideBelow: 'md',
      cell: (submission) => <StatusBadge status={submission.status ?? 'SUBMITTED'} dot />,
    },
    {
      id: 'completionTimeMs',
      header: 'Time taken',
      numeric: true,
      width: 'w-28',
      hideBelow: 'lg',
      // The API reports milliseconds. The old page divided by 1000 and appended
      // "s", so a four-minute response read "247s".
      cell: (submission) => <Duration ms={submission.completionTimeMs} />,
    },
    {
      id: 'submittedAt',
      header: 'Submitted',
      width: 'w-40',
      cell: (submission) => (
        <span className="text-muted-foreground">
          <RelativeTime value={submission.submittedAt} />
        </span>
      ),
    },
  ];

  return (
    <PageShell>
      <PageHeader
        title="Responses"
        description="Every response collected across your organization's forms."
      />

      <Toolbar>
        <SearchInput
          value={pager.search}
          onChange={pager.setSearch}
          placeholder="Search responses…"
          aria-label="Search responses"
        />
      </Toolbar>

      <DataTable
        caption="All responses"
        columns={columns}
        data={submissions}
        getRowId={(submission) => submission.id}
        isLoading={isLoading || isFetching}
        error={error}
        onRetry={() => refetch()}
        onRowClick={setSelected}
        pagination={pager.paginationProps(total, 'responses')}
        empty={
          <EmptyState
            variant="inline"
            icon={Inbox}
            title={pager.search ? 'No responses match your search' : 'No responses yet'}
            description={
              pager.search
                ? 'Try a different search term.'
                : 'Once someone completes one of your published forms, it will appear here.'
            }
            action={
              pager.search ? (
                <Button variant="outline" size="sm" onClick={pager.reset}>
                  Clear search
                </Button>
              ) : (
                <ButtonLink variant="outline" size="sm" href="/forms">
                  Go to forms
                </ButtonLink>
              )
            }
          />
        }
      />

      <SubmissionDetailsDialog
        submission={selected}
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </PageShell>
  );
}
