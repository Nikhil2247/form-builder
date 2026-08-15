'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BookTemplate, LayoutGrid, Layers, List, Loader2, TrendingUp } from 'lucide-react';
import { toastError } from '@/lib/errors';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ButtonLink,
  PageHeader,
  PageShell,
  DataTable,
  DataTablePagination,
  StatusBadge,
  EmptyState,
  ErrorState,
  Toolbar,
  SearchInput,
  FilterSelect,
  type DataTableColumn,
} from '@/components/shared';
import { Can } from '@/components/auth/RoleGuard';
import { usePermissions } from '@/hooks/use-auth';
import { usePagination } from '@/hooks/use-pagination';
import { useTemplates, useTemplateCategories, useCreateFromTemplate, type Template } from '@/hooks/use-templates';

export default function TemplatesPage() {
  const router = useRouter();
  const { can } = usePermissions();

  const pager = usePagination({ filterKeys: ['category'] });
  const [usingId, setUsingId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const { data, isLoading, isFetching, error, refetch } = useTemplates({
    page: pager.page,
    limit: pager.pageSize,
    category: pager.filters.category,
    search: pager.search,
  });
  const categories = useTemplateCategories();
  const createFromTemplate = useCreateFromTemplate();

  const templates = data?.templates ?? [];
  const total = data?.pagination?.total ?? 0;

  async function useTemplate(template: Template) {
    setUsingId(template.id);
    try {
      const form = await createFromTemplate.mutateAsync(template.id);
      const formId = (form as any)?.id ?? (form as any)?.form?.id;
      if (!formId) throw new Error('The API did not return the new form');
      router.push(`/forms/builder?id=${formId}`);
    } catch (err) {
      // Reported here rather than left to the global handler, because the
      // `throw` above fires AFTER the mutation resolved — a 2xx that carried no
      // form id is not a mutation error and the MutationCache never sees it.
      // The fallback matches the mutation's own `meta.errorFallback`, so on the
      // paths where both fire they collapse into one toast.
      toastError(err, 'Could not create a form from this template');
    } finally {
      setUsingId(null);
    }
  }

  const categoryOptions = [
    { value: 'ALL', label: 'All categories' },
    ...(categories.data ?? []).map((category) => ({ value: category, label: category })),
  ];

  const emptyState = (
    <EmptyState
      icon={BookTemplate}
      variant="inline"
      title={pager.search || pager.filters.category ? 'No templates match' : 'No templates available'}
      description={
        pager.search || pager.filters.category
          ? 'Try a different search term or category.'
          : 'Templates published for your organization will appear here.'
      }
      action={
        pager.search || pager.filters.category ? (
          <Button variant="outline" size="sm" onClick={pager.reset}>
            Clear filters
          </Button>
        ) : undefined
      }
    />
  );

  const templateColumns: DataTableColumn<Template>[] = [
    {
      id: 'name',
      header: 'Template',
      isRowHeader: true,
      className: 'max-w-0',
      cell: (template) => (
        <div className="flex items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <BookTemplate className="size-4" strokeWidth={1.5} />
          </span>
          <div className="min-w-0">
            <div className="truncate font-medium text-foreground">{template.name}</div>
            <div className="truncate text-xs text-muted-foreground">
              {template.description || 'No description'}
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'category',
      header: 'Category',
      width: 'w-36',
      hideBelow: 'sm',
      cell: (template) =>
        template.category ? (
          <StatusBadge status={template.category} label={template.category} tone="neutral" />
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: 'usageCount',
      header: 'Used',
      numeric: true,
      width: 'w-28',
      hideBelow: 'sm',
      cell: (template) => (template.usageCount ?? 0).toLocaleString(),
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      width: 'w-40',
      className: 'text-right',
      headerClassName: 'text-right',
      cell: (template) =>
        can('template:use') && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => useTemplate(template)}
            disabled={usingId !== null}
          >
            {usingId === template.id && <Loader2 className="size-3.5 animate-spin" />}
            {usingId === template.id ? 'Creating…' : 'Use template'}
          </Button>
        ),
    },
  ];

  return (
    <PageShell>
      <PageHeader
        title="Templates"
        description="Start from a pre-built form and adapt it."
        actions={
          <Can permission="form:create">
            <ButtonLink variant="outline" size="sm" className="gap-2" href="/forms/builder">
              <Layers className="size-4" /> Blank form
            </ButtonLink>
          </Can>
        }
      />

      <Toolbar
        end={
          <div
            role="group"
            aria-label="View mode"
            className="flex items-center gap-1 rounded-lg border border-border p-0.5"
          >
            {(
              [
                ['list', List, 'Table view'],
                ['grid', LayoutGrid, 'Card view'],
              ] as const
            ).map(([mode, Icon, label]) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                aria-label={label}
                aria-pressed={viewMode === mode}
                className={`rounded-md p-1.5 transition-colors ${
                  viewMode === mode
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="size-4" />
              </button>
            ))}
          </div>
        }
      >
        <SearchInput
          value={pager.search}
          onChange={pager.setSearch}
          placeholder="Search templates…"
          aria-label="Search templates"
        />
        {categoryOptions.length > 1 && (
          <FilterSelect
            label="Category"
            value={pager.filters.category ?? 'ALL'}
            onChange={(value) => pager.setFilter('category', value === 'ALL' ? null : value)}
            options={categoryOptions}
          />
        )}
      </Toolbar>

      {viewMode === 'list' ? (
        <DataTable
          caption="Templates available to your organization"
          columns={templateColumns}
          data={templates}
          getRowId={(template) => template.id}
          isLoading={isLoading || isFetching}
          error={error}
          onRetry={() => refetch()}
          empty={emptyState}
          pagination={pager.paginationProps(total, 'templates')}
        />
      ) : error ? (
        <ErrorState title="Could not load templates" error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : templates.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-strong bg-card">
          {emptyState}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {templates.map((template) => (
              <Card
                key={template.id}
                className="flex min-h-44 flex-col justify-between p-5 transition-colors hover:border-border-strong"
              >
                <div className="min-w-0">
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      <BookTemplate className="size-4" strokeWidth={1.5} />
                    </span>
                    {template.category && (
                      <StatusBadge status={template.category} label={template.category} tone="neutral" />
                    )}
                  </div>

                  <h3 className="line-clamp-1 text-sm font-medium text-foreground">
                    {template.name}
                  </h3>
                  {template.description && (
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {template.description}
                    </p>
                  )}
                  {!!template.usageCount && (
                    <p className="tabular mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                      <TrendingUp className="size-3" />
                      Used {template.usageCount.toLocaleString()} times
                    </p>
                  )}
                </div>

                {can('template:use') && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-4 w-full gap-1.5"
                    onClick={() => useTemplate(template)}
                    disabled={usingId !== null}
                  >
                    {usingId === template.id && <Loader2 className="size-3.5 animate-spin" />}
                    {usingId === template.id ? 'Creating…' : 'Use template'}
                  </Button>
                )}
              </Card>
            ))}
          </div>

          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <DataTablePagination
              {...pager.paginationProps(total, 'templates')}
              isLoading={isFetching}
              className="border-t-0"
            />
          </div>
        </div>
      )}
    </PageShell>
  );
}
