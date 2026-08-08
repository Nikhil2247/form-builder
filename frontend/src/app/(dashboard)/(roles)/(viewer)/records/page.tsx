'use client';

import React, { useMemo } from 'react';
import { Boxes, Contact } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  ButtonLink,
  DataTable,
  EmptyState,
  FilterSelect,
  PageHeader,
  PageShell,
  RelativeTime,
  SearchInput,
  Toolbar,
  type DataTableColumn,
} from '@/components/shared';
import { DataAppsDisabled } from '@/components/apps/DataAppsGate';
import { formatAttributeValue, humanizeKey } from '@/components/apps/AttributeList';
import { FEATURES, useFeature } from '@/hooks/use-features';
import { usePagination } from '@/hooks/use-pagination';
import { useSubjectTypes, useSubjects, type Subject } from '@/hooks/use-subjects';

/**
 * Every record in the organization, across record types.
 *
 * Search and the type filter are both sent to the server. Filtering the loaded
 * page locally — the pattern the forms list started with — means a record on
 * page 3 is invisible unless you happen to be standing on page 3.
 */
export default function RecordsPage() {
  const appsEnabled = useFeature(FEATURES.FORM_APPS);
  const pager = usePagination({ filterKeys: ['type'] });

  const subjectTypes = useSubjectTypes({ enabled: appsEnabled });

  const { data, isLoading, isFetching, error, refetch } = useSubjects(
    {
      page: pager.page,
      limit: pager.pageSize,
      subjectTypeId: pager.filters.type,
      search: pager.search,
    },
    { enabled: appsEnabled },
  );

  const typeOptions = useMemo(
    () => [
      { value: 'ALL', label: 'All record types' },
      ...(subjectTypes.data ?? []).map((type) => ({ value: type.id, label: type.name })),
    ],
    [subjectTypes.data],
  );

  if (!appsEnabled) return <DataAppsDisabled title="Records" />;

  const subjects = data?.subjects ?? [];
  const total = data?.pagination?.total ?? 0;
  const isFiltered = !!pager.search || !!pager.filters.type;

  const columns: DataTableColumn<Subject>[] = [
    {
      id: 'displayName',
      header: 'Record',
      isRowHeader: true,
      className: 'max-w-0',
      cell: (subject) => (
        <div className="flex items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Contact className="size-4" strokeWidth={1.5} />
          </span>
          <div className="min-w-0">
            <div className="truncate font-medium text-foreground">{subject.displayName}</div>
            <div className="truncate text-xs text-muted-foreground">
              {subject.externalId || 'No external id'}
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'subjectType',
      header: 'Record type',
      width: 'w-44',
      hideBelow: 'sm',
      cell: (subject) => (
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Boxes className="size-3.5 shrink-0" />
          <span className="truncate">{subject.subjectType?.name ?? '—'}</span>
        </span>
      ),
    },
    {
      id: 'attributes',
      header: 'Attributes',
      hideBelow: 'lg',
      className: 'max-w-0',
      cell: (subject) => {
        const entries = Object.entries(subject.attributes ?? {});
        if (entries.length === 0) return <span className="text-muted-foreground">—</span>;
        return (
          <span className="truncate text-xs text-muted-foreground">
            {entries
              .slice(0, 3)
              .map(([key, value]) => `${humanizeKey(key)}: ${formatAttributeValue(value)}`)
              .join(' · ')}
          </span>
        );
      },
    },
    {
      id: 'createdAt',
      header: 'Added',
      width: 'w-40',
      cell: (subject) => (
        <span className="text-muted-foreground">
          <RelativeTime value={subject.createdAt} />
        </span>
      ),
    },
  ];

  return (
    <PageShell>
      <PageHeader
        title="Records"
        description="Every subject record collected across your record types."
        actions={
          <ButtonLink variant="outline" size="sm" href="/apps">
            Go to apps
          </ButtonLink>
        }
      />

      <Toolbar>
        <SearchInput
          value={pager.search}
          onChange={pager.setSearch}
          placeholder="Search records…"
          aria-label="Search records"
        />
        <FilterSelect
          label="Record type"
          value={pager.filters.type ?? 'ALL'}
          onChange={(value) => pager.setFilter('type', value === 'ALL' ? null : value)}
          options={typeOptions}
        />
      </Toolbar>

      <DataTable
        caption="Records in your organization"
        columns={columns}
        data={subjects}
        getRowId={(subject) => subject.id}
        isLoading={isLoading || isFetching}
        error={error}
        onRetry={() => refetch()}
        rowHref={(subject) => `/records/${subject.id}`}
        pagination={pager.paginationProps(total, 'records')}
        empty={
          <EmptyState
            variant="inline"
            icon={Contact}
            title={isFiltered ? 'No records match your filters' : 'No records yet'}
            description={
              isFiltered
                ? 'Search matches the record name and its external id. Try a different term or clear the type filter.'
                : 'Records are created when someone completes a registration form. Set one up on a record type to start collecting them.'
            }
            action={
              isFiltered ? (
                <Button variant="outline" size="sm" onClick={pager.reset}>
                  Clear filters
                </Button>
              ) : (
                <ButtonLink variant="outline" size="sm" href="/record-types">
                  Manage record types
                </ButtonLink>
              )
            }
          />
        }
      />
    </PageShell>
  );
}
