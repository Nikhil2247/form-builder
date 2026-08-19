'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Clock,
  Copy,
  Edit,
  FileBox,
  Inbox,
  LayoutGrid,
  List,
  MoreHorizontal,
  Plus,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  PageHeader,
  PageShell,
  DataTable,
  DataTablePagination,
  StatusBadge,
  EmptyState,
  Toolbar,
  SearchInput,
  FilterSelect,
  RelativeTime,
  Modal,
  ModalActions,
  ConfirmDialog,
  type DataTableColumn,
  ButtonLink,
} from '@/components/shared';
import { Can } from '@/components/auth/RoleGuard';
import { usePermissions } from '@/hooks/use-auth';
import { usePagination } from '@/hooks/use-pagination';
import { useForms, useCreateForm, useDeleteForm, useCloneForm, type Form } from '@/hooks/use-forms';
import { richTextToPlainText } from '@/lib/rich-text';

const STATUS_OPTIONS = [
  { value: 'ALL', label: 'All statuses' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'PUBLISHED', label: 'Published' },
  { value: 'CLOSED', label: 'Closed' },
  { value: 'ARCHIVED', label: 'Archived' },
];

export default function FormsListPage() {
  const router = useRouter();
  const { can } = usePermissions();

  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Form | null>(null);

  const pager = usePagination({ filterKeys: ['status'] });

  const { data, isLoading, isFetching, error, refetch } = useForms({
    page: pager.page,
    limit: pager.pageSize,
    status: pager.filters.status,
    search: pager.search,
    sort: pager.sort,
    direction: pager.direction,
  });

  const createForm = useCreateForm();
  const deleteForm = useDeleteForm();
  const cloneForm = useCloneForm();

  const forms = data?.forms ?? [];
  const total = data?.pagination?.total ?? 0;

  async function handleClone(form: Form) {
    try {
      const clone = await cloneForm.mutateAsync(form.id);
      toast.success(`Copied "${form.title}"`);
      if (clone?.id) router.push(`/forms/builder?id=${clone.id}`);
    } catch {
      // Reported globally.
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteForm.mutateAsync(deleteTarget.id);
      toast.success('Moved to trash');
      setDeleteTarget(null);
    } catch {
      // Reported globally; the confirm dialog stays open.
    }
  }

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
      id: 'status',
      header: 'Status',
      width: 'w-32',
      hideBelow: 'sm',
      cell: (form) => <StatusBadge status={form.status} dot />,
    },
    {
      id: 'submissions',
      header: 'Responses',
      numeric: true,
      width: 'w-28',
      hideBelow: 'sm',
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
      width: 'w-12',
      className: 'text-right',
      headerClassName: 'text-right',
      cell: (form) => <RowActions form={form} onClone={handleClone} onDelete={setDeleteTarget} />,
    },
  ];

  const emptyState = (
    <EmptyState
      icon={FileBox}
      variant="inline"
      title={pager.search || pager.filters.status ? 'No forms match your filters' : 'No forms yet'}
      description={
        pager.search || pager.filters.status
          ? 'Try a different search term or clear the status filter.'
          : 'Create a form from scratch, or start from a template.'
      }
      action={
        pager.search || pager.filters.status ? (
          <Button variant="outline" size="sm" onClick={pager.reset}>
            Clear filters
          </Button>
        ) : (
          <Can permission="form:create">
            <Button size="sm" className="gap-2" onClick={() => setIsCreateOpen(true)}>
              <Plus className="size-4" /> Create form
            </Button>
          </Can>
        )
      }
    />
  );

  return (
    <PageShell>
      <PageHeader
        title="Forms"
        description="Every form in your organization."
        actions={
          <>
            <ButtonLink variant="outline" size="sm" className="gap-2" href="/templates">
              <FileBox className="size-4" /> Templates
            </ButtonLink>
            <Can permission="form:create">
              <Button size="sm" className="gap-2" onClick={() => setIsCreateOpen(true)}>
                <Plus className="size-4" /> Create form
              </Button>
            </Can>
          </>
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

      {viewMode === 'list' ? (
        <DataTable
          caption="Forms in your organization"
          columns={columns}
          data={forms}
          getRowId={(form) => form.id}
          isLoading={isLoading || isFetching}
          error={error}
          onRetry={() => refetch()}
          empty={emptyState}
          rowHref={(form) => `/forms/${form.id}`}
          sort={pager.sort ? { key: pager.sort, direction: pager.direction } : undefined}
          onSortChange={pager.setSort}
          pagination={pager.paginationProps(total, 'forms')}
        />
      ) : (
        <div className="space-y-4">
          {isLoading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-40 rounded-xl" />
              ))}
            </div>
          ) : forms.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border-strong bg-card">
              {emptyState}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {can('form:create') && (
                  <button
                    onClick={() => setIsCreateOpen(true)}
                    className="group flex min-h-40 flex-col items-center justify-center rounded-xl border
                               border-dashed border-border-strong bg-card p-6 text-center transition-colors
                               hover:border-foreground/30 hover:bg-muted/40"
                  >
                    <span className="mb-3 flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors group-hover:bg-foreground group-hover:text-background">
                      <Plus className="size-4" />
                    </span>
                    <span className="text-sm font-medium">New form</span>
                    <span className="mt-0.5 text-xs text-muted-foreground">Start from scratch</span>
                  </button>
                )}
                {forms.map((form) => (
                  <FormCard
                    key={form.id}
                    form={form}
                    onClone={handleClone}
                    onDelete={setDeleteTarget}
                  />
                ))}
              </div>

              <div className="overflow-hidden rounded-xl border border-border bg-card">
                <DataTablePagination
                  {...pager.paginationProps(total, 'forms')}
                  isLoading={isFetching}
                  className="border-t-0"
                />
              </div>
            </>
          )}
        </div>
      )}

      <CreateFormModal
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        isPending={createForm.isPending}
        onCreate={async (values) => {
          try {
            const created = await createForm.mutateAsync(values);
            setIsCreateOpen(false);
            router.push(`/forms/builder?id=${created.id}`);
          } catch {
            // Reported globally; the dialog stays open with the title typed.
          }
        }}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Move to trash"
        description={
          <>
            &ldquo;{deleteTarget?.title}&rdquo; will be moved to trash. Its responses are kept and
            it can be restored for 30 days.
          </>
        }
        confirmLabel="Move to trash"
        onConfirm={handleDelete}
        isPending={deleteForm.isPending}
      />
    </PageShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function RowActions({
  form,
  onClone,
  onDelete,
}: {
  form: Form;
  onClone: (form: Form) => void;
  onDelete: (form: Form) => void;
}) {
  const { can } = usePermissions();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Actions for ${form.title}`}
        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {/* Base UI composes via `render`, not Radix's `asChild`. */}
        <DropdownMenuItem render={<Link href={`/forms/${form.id}`} />} className="cursor-pointer">
          <Inbox className="mr-2 size-3.5" /> Responses
        </DropdownMenuItem>
        {can('form:edit') && (
          <DropdownMenuItem
            render={<Link href={`/forms/builder?id=${form.id}`} />}
            className="cursor-pointer"
          >
            <Edit className="mr-2 size-3.5" /> Edit
          </DropdownMenuItem>
        )}
        {can('form:create') && (
          <DropdownMenuItem onClick={() => onClone(form)} className="cursor-pointer">
            <Copy className="mr-2 size-3.5" /> Duplicate
          </DropdownMenuItem>
        )}
        {can('form:delete') && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onDelete(form)}
              className="cursor-pointer text-destructive focus:bg-destructive/10 focus:text-destructive"
            >
              <Trash2 className="mr-2 size-3.5" /> Move to trash
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FormCard({
  form,
  onClone,
  onDelete,
}: {
  form: Form;
  onClone: (form: Form) => void;
  onDelete: (form: Form) => void;
}) {
  return (
    <Card className="flex min-h-40 flex-col justify-between p-4 transition-colors hover:border-border-strong">
      <div className="min-w-0">
        <div className="mb-3 flex items-start justify-between gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <FileBox className="size-4" strokeWidth={1.5} />
          </span>
          <div className="flex items-center gap-1.5">
            <StatusBadge status={form.status} />
            <RowActions form={form} onClone={onClone} onDelete={onDelete} />
          </div>
        </div>

        <Link href={`/forms/${form.id}`} className="block rounded-sm">
          <h3 className="line-clamp-2 text-sm font-medium text-foreground hover:underline">
            {form.title}
          </h3>
        </Link>
        {form.description && (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
            {richTextToPlainText(form.description)}
          </p>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
        <span className="tabular flex items-center gap-1.5">
          <Inbox className="size-3" />
          {(form._count?.submissions ?? 0).toLocaleString()}
        </span>
        <span className="flex items-center gap-1.5">
          <Clock className="size-3" />
          <RelativeTime value={form.updatedAt} />
        </span>
      </div>
    </Card>
  );
}

function CreateFormModal({
  open,
  onOpenChange,
  onCreate,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (values: { title: string; description?: string }) => void;
  isPending: boolean;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  React.useEffect(() => {
    if (open) {
      setTitle('');
      setDescription('');
    }
  }, [open]);

  const submit = () => {
    if (!title.trim()) return;
    onCreate({ title: title.trim(), description: description.trim() || undefined });
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Create a form"
      description="You can rename it any time."
      footer={
        <ModalActions
          onCancel={() => onOpenChange(false)}
          confirmLabel="Create and open builder"
          onConfirm={submit}
          isPending={isPending}
          disabled={!title.trim()}
        />
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="form-title">Title</Label>
          <Input
            id="form-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="Customer feedback survey"
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="form-description">Description (optional)</Label>
          <Input
            id="form-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="Shown to respondents under the title"
          />
        </div>
      </div>
    </Modal>
  );
}
