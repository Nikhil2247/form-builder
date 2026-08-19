'use client';

import React, { useState } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  PageHeader,
  PageShell,
  DataTable,
  EmptyState,
  ConfirmDialog,
  RelativeTime,
  type DataTableColumn,
} from '@/components/shared';
import { useTrashedForms, useRestoreForm, type Form } from '@/hooks/use-forms';
import { richTextToPlainText } from '@/lib/rich-text';

/** Matches the API's soft-delete retention window. */
const RETENTION_DAYS = 30;

function daysRemaining(deletedAt: string | null | undefined): number | null {
  if (!deletedAt) return null;
  const deleted = new Date(deletedAt).getTime();
  if (!Number.isFinite(deleted)) return null;
  const elapsedDays = (Date.now() - deleted) / 86_400_000;
  return Math.max(0, Math.ceil(RETENTION_DAYS - elapsedDays));
}

export default function TrashPage() {
  const { data: forms, isLoading, error, refetch } = useTrashedForms();
  const restoreForm = useRestoreForm();
  const [restoreTarget, setRestoreTarget] = useState<Form | null>(null);

  const columns: DataTableColumn<Form>[] = [
    {
      id: 'title',
      header: 'Form',
      isRowHeader: true,
      className: 'max-w-0',
      cell: (form) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-foreground">{form.title}</div>
          <div className="truncate text-xs text-muted-foreground">
            {richTextToPlainText(form.description) || 'No description'}
          </div>
        </div>
      ),
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
      id: 'deletedAt',
      header: 'Deleted',
      width: 'w-40',
      hideBelow: 'sm',
      cell: (form) => (
        <span className="text-muted-foreground">
          <RelativeTime value={form.deletedAt} />
        </span>
      ),
    },
    {
      id: 'expires',
      header: 'Auto-deletes in',
      width: 'w-36',
      hideBelow: 'md',
      cell: (form) => {
        const remaining = daysRemaining(form.deletedAt);
        if (remaining === null) return <span className="text-muted-foreground">—</span>;
        return (
          <span className={remaining <= 3 ? 'text-destructive' : 'text-muted-foreground'}>
            {remaining === 0 ? 'Today' : `${remaining} day${remaining === 1 ? '' : 's'}`}
          </span>
        );
      },
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      width: 'w-28',
      className: 'text-right',
      headerClassName: 'text-right',
      cell: (form) => (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => setRestoreTarget(form)}
        >
          <RotateCcw className="size-3.5" />
          Restore
        </Button>
      ),
    },
  ];

  return (
    <PageShell>
      <PageHeader
        title="Trash"
        description={`Deleted forms are kept for ${RETENTION_DAYS} days, then removed permanently along with their responses.`}
      />

      <DataTable
        caption="Deleted forms"
        columns={columns}
        data={forms}
        getRowId={(form) => form.id}
        isLoading={isLoading}
        error={error}
        onRetry={() => refetch()}
        empty={
          <EmptyState
            variant="inline"
            icon={Trash2}
            title="Trash is empty"
            description="Forms you delete will appear here, and can be restored for 30 days."
          />
        }
      />

      <ConfirmDialog
        open={!!restoreTarget}
        onOpenChange={(open) => !open && setRestoreTarget(null)}
        title="Restore form"
        description={
          <>
            &ldquo;{restoreTarget?.title}&rdquo; will return to your forms list as a draft. It will
            not be live until you publish it again.
          </>
        }
        confirmLabel="Restore"
        variant="default"
        isPending={restoreForm.isPending}
        onConfirm={async () => {
          if (!restoreTarget) return;
          try {
            await restoreForm.mutateAsync(restoreTarget.id);
            toast.success(`Restored "${restoreTarget.title}"`);
            setRestoreTarget(null);
          } catch {
            // Reported globally.
          }
        }}
      />
    </PageShell>
  );
}
