'use client';

import React from 'react';
import Link from 'next/link';
import { Download, Eye, FileBox, Inbox, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button, buttonVariants } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ButtonLink,
  PageHeader,
  PageShell,
  DataTable,
  EmptyState,
  Toolbar,
  SearchInput,
  FilterSelect,
  RelativeTime,
  type DataTableColumn,
} from '@/components/shared';
import { Can } from '@/components/auth/RoleGuard';
import { usePagination } from '@/hooks/use-pagination';
import { useForms, type Form } from '@/hooks/use-forms';
import { useExportSubmissions } from '@/hooks/use-submissions';
import { richTextToPlainText } from '@/lib/rich-text';

const STATUS_OPTIONS = [
  { value: 'ALL', label: 'All statuses' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'PUBLISHED', label: 'Published' },
  { value: 'CLOSED', label: 'Closed' },
  { value: 'ARCHIVED', label: 'Archived' },
];

/**
 * Every form in the organization, ranked by how many responses it has.
 *
 * This used to be a single flat table of every response across every form —
 * useful for nothing in particular, since a respondent's answer only means
 * something in the context of the form that asked it. Picking a form here
 * goes straight to that form's own Responses tab, where the answers actually
 * live.
 */
export default function OrgSubmissionsPage() {
  const pager = usePagination({ filterKeys: ['status'] });

  const { data, isLoading, isFetching, error, refetch } = useForms({
    page: pager.page,
    limit: pager.pageSize,
    status: pager.filters.status,
    search: pager.search,
    sort: pager.sort ?? 'updatedAt',
    direction: pager.direction,
  });

  const forms = data?.forms ?? [];
  const total = data?.pagination?.total ?? 0;

  const columns: DataTableColumn<Form>[] = [
    {
      id: 'title',
      header: 'Form',
      isRowHeader: true,
      sortable: true,
      sortKey: 'title',
      className: 'max-w-0',
      cell: (form) => (
        <div className="flex items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <FileBox className="size-4" strokeWidth={1.5} />
          </span>
          <div className="min-w-0">
            <div className="truncate font-medium text-foreground">{form.title}</div>
            <div className="truncate text-xs text-muted-foreground">
              {richTextToPlainText(form.description) || 'No description'}
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'submissions',
      header: 'Responses',
      numeric: true,
      width: 'w-28',
      cell: (form) => (form._count?.submissions ?? 0).toLocaleString(),
    },
    {
      id: 'updatedAt',
      header: 'Last edited',
      sortable: true,
      sortKey: 'updatedAt',
      width: 'w-40',
      hideBelow: 'md',
      cell: (form) => (
        <span className="text-muted-foreground">
          <RelativeTime value={form.updatedAt} />
        </span>
      ),
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      width: 'w-24',
      className: 'text-right',
      headerClassName: 'text-right',
      cell: (form) => <RowActions form={form} />,
    },
  ];

  return (
    <PageShell>
      <PageHeader
        title="Responses"
        description="Pick a form to see who responded and what they said."
      />

      <Toolbar>
        <SearchInput
          value={pager.search}
          onChange={pager.setSearch}
          placeholder="Search forms…"
          aria-label="Search forms"
        />
        <FilterSelect
          label="Status"
          value={pager.filters.status ?? 'ALL'}
          onChange={(value) => pager.setFilter('status', value === 'ALL' ? null : value)}
          options={STATUS_OPTIONS}
        />
      </Toolbar>

      <DataTable
        caption="Forms in your organization, with their response counts"
        columns={columns}
        data={forms}
        getRowId={(form) => form.id}
        isLoading={isLoading || isFetching}
        error={error}
        onRetry={() => refetch()}
        rowHref={(form) => `/forms/${form.id}`}
        sort={pager.sort ? { key: pager.sort, direction: pager.direction } : undefined}
        onSortChange={pager.setSort}
        pagination={pager.paginationProps(total, 'forms')}
        empty={
          <EmptyState
            variant="inline"
            icon={Inbox}
            title={
              pager.search || pager.filters.status
                ? 'No forms match your filters'
                : 'No forms yet'
            }
            description={
              pager.search || pager.filters.status
                ? 'Try a different search term or clear the status filter.'
                : 'Create a form and publish it to start collecting responses.'
            }
            action={
              pager.search || pager.filters.status ? undefined : (
                <ButtonLink variant="outline" size="sm" href="/forms">
                  Go to forms
                </ButtonLink>
              )
            }
          />
        }
      />
    </PageShell>
  );
}

/** View and export, right on the row — the two things anyone opening this page wants to do with a form's responses. */
function RowActions({ form }: { form: Form }) {
  const exportSubmissions = useExportSubmissions(form.id, form.title);
  const hasResponses = (form._count?.submissions ?? 0) > 0;

  async function handleExport(format: 'csv' | 'json') {
    try {
      const result = await exportSubmissions.mutateAsync(format);
      toast.success(`Downloaded ${result.filename}`);
    } catch {
      // Reported globally.
    }
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <Link
        href={`/forms/${form.id}`}
        title={`View responses to ${form.title}`}
        className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
      >
        <Eye className="size-4" />
        <span className="sr-only">View responses to {form.title}</span>
      </Link>

      <Can permission="submission:export">
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={!hasResponses || exportSubmissions.isPending}
            aria-label={`Export responses to ${form.title}`}
            render={
              <Button variant="ghost" size="icon-sm">
                {exportSubmissions.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Download className="size-4" />
                )}
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => handleExport('csv')} className="cursor-pointer">
              Download CSV
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleExport('json')} className="cursor-pointer">
              Download JSON
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Can>
    </div>
  );
}
