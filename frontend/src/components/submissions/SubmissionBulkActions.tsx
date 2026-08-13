'use client';

import React from 'react';
import { toast } from 'sonner';
import { Loader2, Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/shared/modal';
import {
  useBulkSubmissions,
  type ReviewableStatus,
} from '@/hooks/use-submission-detail';

/**
 * The action bar that appears once rows are selected.
 *
 * Shared by the org-wide and per-form response tables rather than written into
 * each, because the interesting part is not the buttons — it is that a bulk
 * action must clear the selection afterwards. A stale selection is genuinely
 * dangerous here: the ids stay ticked, the list refetches without them, and the
 * next click applies an action to rows the operator can no longer see. Clearing
 * happens in exactly one place, on success, for both pages.
 */

const STATUS_BUTTONS: Array<{ status: ReviewableStatus; label: string }> = [
  { status: 'SUBMITTED', label: 'Mark valid' },
  { status: 'FLAGGED_SPAM', label: 'Mark spam' },
  { status: 'REJECTED', label: 'Reject' },
];

export interface SubmissionBulkActionsProps {
  selectedIds: string[];
  onClear: () => void;
}

export function SubmissionBulkActions({ selectedIds, onClear }: SubmissionBulkActionsProps) {
  const bulk = useBulkSubmissions();
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);

  const count = selectedIds.length;
  if (count === 0) return null;

  async function apply(status: ReviewableStatus) {
    try {
      const result = await bulk.mutateAsync({ action: 'SET_STATUS', ids: selectedIds, status });
      toast.success(`${result.affected} ${plural(result.affected)} updated`);
      onClear();
    } catch {
      // Reported by the global mutation error handler. The selection is
      // deliberately left intact: the API is all-or-nothing, so nothing was
      // written and the operator can fix the problem and retry the same set.
    }
  }

  async function applyDelete() {
    try {
      const result = await bulk.mutateAsync({ action: 'DELETE', ids: selectedIds });
      toast.success(`${result.affected} ${plural(result.affected)} deleted`);
      setConfirmingDelete(false);
      onClear();
    } catch {
      /* See above. */
    }
  }

  return (
    <>
      <div
        // Announced when it appears, because it is the only feedback that
        // ticking a checkbox did anything for someone not looking at the table.
        role="status"
        className="flex flex-wrap items-center gap-2"
      >
        <span className="text-sm font-medium text-foreground">
          {count} {plural(count)} selected
        </span>

        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5"
          onClick={onClear}
          disabled={bulk.isPending}
        >
          <X className="size-3.5" />
          Clear
        </Button>

        <span aria-hidden className="h-4 w-px bg-border" />

        {STATUS_BUTTONS.map((action) => (
          <Button
            key={action.status}
            variant="outline"
            size="sm"
            disabled={bulk.isPending}
            onClick={() => apply(action.status)}
          >
            {bulk.isPending && <Loader2 className="mr-2 size-3.5 animate-spin" />}
            {action.label}
          </Button>
        ))}

        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 text-destructive hover:text-destructive"
          disabled={bulk.isPending}
          onClick={() => setConfirmingDelete(true)}
        >
          <Trash2 className="size-3.5" />
          Delete
        </Button>
      </div>

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={`Delete ${count} ${plural(count)}?`}
        description={
          `They will be removed from every list and export, and kept only for the audit trail. ` +
          `They still count towards the responses received this month.`
        }
        confirmLabel={`Delete ${count} ${plural(count)}`}
        isPending={bulk.isPending}
        onConfirm={applyDelete}
      />
    </>
  );
}

function plural(count: number): string {
  return count === 1 ? 'response' : 'responses';
}
