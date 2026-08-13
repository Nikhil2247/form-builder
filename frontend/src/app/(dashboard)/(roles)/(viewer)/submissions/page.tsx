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
import { SubmissionDetailPanel } from '@/components/submissions/SubmissionDetailPanel';
import { SubmissionBulkActions } from '@/components/submissions/SubmissionBulkActions';
import { usePagination } from '@/hooks/use-pagination';
import { usePermissions } from '@/hooks/use-auth';
import { useOrgSubmissions, type Submission } from '@/hooks/use-submissions';

/**
 * Rows rendered at once by the virtualizer's viewport, before scrolling.
 *
 * The table is virtualized because the page size goes up to 100 and this list
 * is the one place in the product where an operator genuinely wants a long
 * page — triaging spam means scanning, not paging. See the note on
 * `DataTableVirtualization` for why it is opt-in rather than the default.
 */
const TABLE_VIEWPORT = 'min(38rem, calc(100vh - 22rem))';
/** px. Two lines of text plus the avatar and the row padding. */
const ROW_HEIGHT = 57;

export default function OrgSubmissionsPage() {
  const pager = usePagination();
  const { atLeast } = usePermissions();
  const [detailId, setDetailId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Mirrors the API's `@RequiredRole('EDITOR')` on the annotate, delete and
  // bulk routes. Checked with the role ladder rather than a capability because
  // that is exactly what the server checks — a capability that mapped to a
  // different set of roles would show controls that 403.
  const canModerate = atLeast('EDITOR');

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
        onRowClick={(submission) => setDetailId(submission.id)}
        pagination={pager.paginationProps(total, 'responses')}
        // Only offered to a role that can act on a selection. Ticking rows with
        // nothing to do with them is a dead end, and the bulk API would 403.
        selection={
          canModerate
            ? {
                selectedIds,
                onChange: setSelectedIds,
                selectAllLabel: 'Select all responses on this page',
                rowLabel: (submission) =>
                  `Select response from ${submission.respondent?.email ?? 'anonymous respondent'}`,
              }
            : undefined
        }
        virtual={{ height: TABLE_VIEWPORT, estimateRowHeight: ROW_HEIGHT }}
        toolbar={
          selectedIds.length > 0 ? (
            <SubmissionBulkActions
              selectedIds={selectedIds}
              onClear={() => setSelectedIds([])}
            />
          ) : undefined
        }
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

      <SubmissionDetailPanel
        submissionId={detailId}
        open={!!detailId}
        onOpenChange={(open) => !open && setDetailId(null)}
        canModerate={canModerate}
        // A deleted row is gone from the next page of results, so leaving it
        // ticked would arm the bulk bar with an id the server will now reject —
        // and, because the bulk API is all-or-nothing, that would block every
        // other row in the selection too.
        onDeleted={(id) => setSelectedIds((ids) => ids.filter((value) => value !== id))}
      />
    </PageShell>
  );
}
