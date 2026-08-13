'use client';

import React from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Download, FileWarning, Loader2, ShieldAlert, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Modal, ConfirmDialog } from '@/components/shared/modal';
import { StatusBadge } from '@/components/shared/status-badge';
import { ErrorState } from '@/components/shared/empty-state';
import { FormattedDate, Duration, formatBytes } from '@/components/shared/formatters';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useSubmissionDetail,
  useReviewSubmission,
  useDeleteSubmission,
  type ReviewableStatus,
  type SubmissionAnswer,
  type SubmissionFile,
} from '@/hooks/use-submission-detail';

/**
 * The full detail of one response, with the review actions attached.
 *
 * A new component rather than an extension of `SubmissionDetailsDialog`,
 * because the two render different things from different sources.
 * `SubmissionDetailsDialog` takes a list row it already has in memory and
 * labels its raw `answers` bag using the questions of the form's CURRENT
 * version — which is fine for a quick peek but is exactly the relabelling
 * hazard that immutable form versions exist to prevent. This panel fetches
 * `GET /submissions/:id`, where the API has already resolved every answer
 * against the version the respondent actually filled in, and it is the only
 * place attached files, reviewer identity and the review actions appear.
 *
 * Imports are from module paths, not the `@/components/shared` barrel: pulling
 * the barrel in drags every shared component into this chunk, and this panel is
 * mounted by list pages that otherwise need almost none of them.
 */

const STATUS_ACTIONS: Array<{ status: ReviewableStatus; label: string }> = [
  { status: 'SUBMITTED', label: 'Mark as valid' },
  { status: 'FLAGGED_SPAM', label: 'Mark as spam' },
  { status: 'REJECTED', label: 'Reject' },
];

export interface SubmissionDetailPanelProps {
  submissionId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Whether the viewer may annotate or delete. Mirrors the API's
   * `@RequiredRole('EDITOR')` on those routes — a VIEWER gets the read-only
   * panel rather than buttons that would 403.
   */
  canModerate?: boolean;
  /** Called after a successful delete, so the list can clear its selection. */
  onDeleted?: (submissionId: string) => void;
}

export function SubmissionDetailPanel({
  submissionId,
  open,
  onOpenChange,
  canModerate = false,
  onDeleted,
}: SubmissionDetailPanelProps) {
  const detail = useSubmissionDetail(open ? submissionId : null);
  const review = useReviewSubmission();
  const remove = useDeleteSubmission();

  const [confirmingDelete, setConfirmingDelete] = React.useState(false);

  const busy = review.isPending || remove.isPending;

  async function setStatus(status: ReviewableStatus) {
    if (!submissionId) return;
    try {
      await review.mutateAsync({ submissionId, status });
      toast.success(`Response marked ${STATUS_LABELS[status]}`);
    } catch {
      /* Reported globally. */
    }
  }

  async function confirmDelete() {
    if (!submissionId) return;
    try {
      await remove.mutateAsync(submissionId);
      toast.success('Response deleted');
      setConfirmingDelete(false);
      onDeleted?.(submissionId);
      onOpenChange(false);
    } catch {
      /* Reported globally. */
    }
  }

  const data = detail.data;

  return (
    <>
      <Modal
        open={open}
        onOpenChange={onOpenChange}
        size="xl"
        title={
          <span className="flex items-center gap-2">
            Response detail
            {data && <StatusBadge status={data.status} dot />}
          </span>
        }
        description={
          data ? (
            <span>
              {data.form.title} · version {data.formVersion.version} ·{' '}
              <FormattedDate value={data.submittedAt} />
            </span>
          ) : undefined
        }
        footer={
          canModerate && data ? (
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="gap-2 text-destructive hover:text-destructive"
                disabled={busy}
                onClick={() => setConfirmingDelete(true)}
              >
                <Trash2 className="size-3.5" />
                Delete
              </Button>

              <div className="flex flex-wrap items-center gap-2">
                {STATUS_ACTIONS.filter((action) => action.status !== data.status).map(
                  (action) => (
                    <Button
                      key={action.status}
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => setStatus(action.status)}
                    >
                      {action.label}
                    </Button>
                  ),
                )}
              </div>
            </div>
          ) : undefined
        }
      >
        {detail.error ? (
          <ErrorState
            variant="inline"
            title="Could not load this response"
            error={detail.error}
            onRetry={() => detail.refetch()}
          />
        ) : detail.isLoading || !data ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-9 w-full" />
            ))}
          </div>
        ) : (
          <div className="space-y-6">
            <Metadata data={data} />

            <section aria-labelledby="answers-heading" className="space-y-1">
              <h3
                id="answers-heading"
                className="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
              >
                Answers
              </h3>
              <dl className="divide-y divide-border rounded-lg border border-border">
                {data.answers.map((answer) => (
                  <AnswerRow key={answer.questionId} answer={answer} />
                ))}
                {data.answers.length === 0 && (
                  <p className="px-3 py-4 text-sm text-muted-foreground">
                    This version had no questions.
                  </p>
                )}
              </dl>
            </section>

            {data.files.length > 0 && (
              <section aria-labelledby="files-heading" className="space-y-1">
                <h3
                  id="files-heading"
                  className="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
                >
                  Attachments
                </h3>
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {data.files.map((file) => (
                    <FileRow key={file.id} file={file} />
                  ))}
                </ul>
              </section>
            )}

            <section aria-labelledby="review-heading" className="space-y-2">
              <h3
                id="review-heading"
                className="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
              >
                Internal note
              </h3>

              {canModerate ? (
                <ReviewNoteEditor
                  // The key is what resets the draft. Seeding a `useState` from
                  // a prop inside an effect would also work and is worse: it
                  // renders once with the wrong value, and it fires on every
                  // background refetch, so a note the reviewer was halfway
                  // through typing would be silently replaced by the server's
                  // copy. Remounting on a genuinely different submission is
                  // both the correct trigger and the only one.
                  key={data.id}
                  submissionId={data.id}
                  initialNote={data.reviewNote ?? ''}
                  disabled={busy}
                  isSaving={review.isPending}
                  onSave={(reviewNote) => review.mutateAsync({ submissionId: data.id, reviewNote })}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {data.reviewNote || 'No note has been left on this response.'}
                </p>
              )}

              {data.reviewedAt && (
                <p className="text-xs text-muted-foreground">
                  Last reviewed by {actorName(data.reviewedBy)} on{' '}
                  <FormattedDate value={data.reviewedAt} />.
                </p>
              )}
            </section>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title="Delete this response?"
        description={
          // Says what actually happens rather than the reassuring version. The
          // response really does leave every list and every export, and the
          // quota really is not refunded — a reviewer deleting a batch of spam
          // should not be surprised by their monthly allowance later.
          'It will be removed from every list and export, and kept only for the audit trail. ' +
          'It still counts towards the responses received this month.'
        }
        confirmLabel="Delete response"
        isPending={remove.isPending}
        onConfirm={confirmDelete}
      />
    </>
  );
}

/**
 * The internal-note editor, as its own component so the parent can reset its
 * draft with a `key` rather than an effect. See the call site.
 */
function ReviewNoteEditor({
  initialNote,
  disabled,
  isSaving,
  onSave,
}: {
  submissionId: string;
  initialNote: string;
  disabled: boolean;
  isSaving: boolean;
  onSave: (reviewNote: string | null) => Promise<unknown>;
}) {
  const [note, setNote] = React.useState(initialNote);
  const changed = note.trim() !== initialNote.trim();

  async function save() {
    try {
      // An emptied box means "clear it", which the API models as an explicit
      // null. Sending '' would store an empty string, and every "does this
      // response have a note?" check in the UI would then read true.
      const trimmed = note.trim();
      await onSave(trimmed === '' ? null : trimmed);
      toast.success(trimmed === '' ? 'Note cleared' : 'Note saved');
    } catch {
      // Reported by the global mutation error handler. The draft is left in
      // the box so a failed save does not lose what was typed.
    }
  }

  return (
    <>
      <Textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        rows={3}
        maxLength={5000}
        placeholder="Visible only to your team. Never shown to the respondent."
        aria-label="Internal review note"
      />
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={disabled || !changed}>
          {isSaving && <Loader2 className="mr-2 size-3.5 animate-spin" />}
          Save note
        </Button>
        {changed && (
          <Button size="sm" variant="ghost" disabled={disabled} onClick={() => setNote(initialNote)}>
            Discard
          </Button>
        )}
      </div>
    </>
  );
}

const STATUS_LABELS: Record<ReviewableStatus, string> = {
  SUBMITTED: 'valid',
  FLAGGED_SPAM: 'spam',
  REJECTED: 'rejected',
};

function actorName(actor: { firstName: string | null; lastName: string | null; email: string } | null) {
  if (!actor) return 'someone who has since been removed';
  const name = `${actor.firstName ?? ''} ${actor.lastName ?? ''}`.trim();
  return name || actor.email;
}

function Metadata({
  data,
}: {
  data: NonNullable<ReturnType<typeof useSubmissionDetail>['data']>;
}) {
  const items: Array<{ label: string; value: React.ReactNode }> = [
    { label: 'Respondent', value: data.respondent ? actorName(data.respondent) : 'Anonymous' },
    {
      label: 'Form',
      value: (
        <Link href={`/forms/${data.form.id}`} className="underline-offset-2 hover:underline">
          {data.form.title}
        </Link>
      ),
    },
    // The version is shown because it is what the labels above were resolved
    // against. Without it, two responses to the same form displaying different
    // question labels looks like a bug rather than the record of an edit.
    { label: 'Version', value: `v${data.formVersion.version}` },
    { label: 'Submitted', value: <FormattedDate value={data.submittedAt} /> },
    { label: 'Time taken', value: <Duration ms={data.completionTimeMs} /> },
    { label: 'Country', value: data.country ?? '—' },
  ];

  if (data.subject) {
    items.push({
      label: 'Record',
      value: (
        <Link
          href={`/records/${data.subject.id}`}
          className="underline-offset-2 hover:underline"
        >
          {data.subject.displayName}
        </Link>
      ),
    });
  }

  if (data.maxQuizScore != null) {
    items.push({
      label: 'Score',
      value: `${data.quizScore ?? 0} / ${data.maxQuizScore}${
        data.isPassed == null ? '' : data.isPassed ? ' · passed' : ' · failed'
      }`,
    });
  }

  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd className="truncate text-sm text-foreground">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function AnswerRow({ answer }: { answer: SubmissionAnswer }) {
  return (
    <div className="grid gap-1 px-3 py-2.5 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:gap-4">
      <dt className="flex items-start gap-1.5 text-sm font-medium text-foreground">
        <span className="min-w-0 break-words">{answer.label}</span>
        {answer.orphaned && (
          // Stored data that this version's schema does not describe. Shown
          // rather than hidden: dropping it would mean the one screen that
          // displays a response silently omits part of it.
          <span
            title="Stored on this response but not present in the form version it was submitted against."
            className="shrink-0 text-warning"
          >
            <FileWarning className="size-3.5" aria-label="Not in this form version" />
          </span>
        )}
      </dt>
      <dd className="min-w-0 text-sm break-words whitespace-pre-wrap text-muted-foreground">
        {answer.answered ? renderValue(answer.value) : <span className="italic">Not answered</span>}
      </dd>
    </div>
  );
}

function FileRow({ file }: { file: SubmissionFile }) {
  return (
    <li className="flex items-center justify-between gap-3 px-3 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-sm text-foreground">{file.originalName}</p>
        <p className="text-xs text-muted-foreground">
          {file.mimeType} · {formatBytes(Number(file.sizeBytes))}
        </p>
      </div>

      {file.downloadUrl ? (
        <Button variant="outline" size="sm" className="shrink-0 gap-2" render={<a
          href={file.downloadUrl}
          // The URL is presigned and short-lived; a new tab keeps the panel open
          // and avoids navigating the app away mid-review.
          target="_blank"
          rel="noopener noreferrer"
          download={file.originalName}
        />}>
          <Download className="size-3.5" />
          Download
        </Button>
      ) : (
        <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldAlert className="size-3.5" />
          {file.status === 'QUARANTINED' ? 'Quarantined' : 'Not available'}
        </span>
      )}
    </li>
  );
}

/** Render one stored answer value. Mirrors the CSV export's flattening rules. */
function renderValue(value: unknown): React.ReactNode {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) {
    if (value.length === 0) return '—';
    return (
      <ul className="list-disc space-y-0.5 pl-4">
        {value.map((entry, index) => (
          <li key={index}>{renderValue(entry)}</li>
        ))}
      </ul>
    );
  }
  if (typeof value === 'object') {
    // Matrix answers and structured payloads. `key: value` lines rather than
    // JSON, which is unreadable at a glance and was what the old view showed.
    return (
      <ul className="space-y-0.5">
        {Object.entries(value as Record<string, unknown>).map(([key, entry]) => (
          <li key={key}>
            <span className="text-foreground">{key}:</span> {renderValue(entry)}
          </li>
        ))}
      </ul>
    );
  }
  return String(value);
}
