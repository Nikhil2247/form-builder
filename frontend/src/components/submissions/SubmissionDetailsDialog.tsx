'use client';

import React, { useMemo } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Loader2,
  Mail,
  Timer,
  User,
} from 'lucide-react';
import { Modal, StatusBadge, CopyButton } from '@/components/shared';
import { FormattedDate, formatDuration, formatBytes } from '@/components/shared/formatters';
import { Button } from '@/components/ui/button';
import type { Submission } from '@/hooks/use-submissions';
import type { FormQuestion } from '@/types/form';

/**
 * A single response, rendered against the form's schema.
 *
 * The previous dialog listed `Object.entries(answers)` directly, so every field
 * was labelled with its raw question id — "q_8fa21c04" instead of "How did you
 * hear about us?" — and answers were rendered with `String(value)`, which turned
 * multi-select arrays into "a,b,c", file uploads into "[object Object]", and
 * `false` into an empty cell indistinguishable from no answer.
 *
 * Passing `questions` restores the labels, the original ordering, and per-type
 * rendering. Answers whose question no longer exists (the form was edited after
 * the response came in) are still shown, under their id, rather than dropped —
 * silently hiding submitted data is worse than an ugly label.
 */

interface SubmissionDetailsDialogProps {
  submission: Submission | null;
  questions?: FormQuestion[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Overrides the default "Response" heading — e.g. the form's own title. */
  title?: React.ReactNode;
  /**
   * Still fetching the schema this response should be labelled against.
   *
   * Rendered as a note rather than by withholding the dialog: the answers are
   * already in hand, and showing them under their question ids for a moment
   * beats an empty modal that looks broken.
   */
  isLoadingQuestions?: boolean;
  /**
   * Step to the previous/next response without closing.
   *
   * Omitted where there is no sequence to step through. This is what keeps a
   * reviewer on one page: reading six entries against a record used to mean six
   * round trips out to a form's response list and back.
   */
  onPrev?: () => void;
  onNext?: () => void;
  /** e.g. "2 of 6", shown between the step buttons. */
  positionLabel?: string;
  /** Extra action rendered in the footer, before Close. */
  footerAction?: React.ReactNode;
}

export function SubmissionDetailsDialog({
  submission,
  questions,
  open,
  onOpenChange,
  title,
  isLoadingQuestions,
  onPrev,
  onNext,
  positionLabel,
  footerAction,
}: SubmissionDetailsDialogProps) {
  const rows = useMemo(() => {
    if (!submission) return [];
    const answers = submission.answers ?? {};
    const seen = new Set<string>();

    // Schema order first — a response should read like the form.
    const ordered = (questions ?? [])
      .filter((q) => q.type !== 'SECTION_HEADER')
      .map((question) => {
        seen.add(question.id);
        return { key: question.id, label: question.label, question, value: answers[question.id] };
      });

    const orphaned = Object.keys(answers)
      .filter((key) => !seen.has(key))
      .map((key) => ({ key, label: key, question: undefined, value: answers[key] }));

    return [...ordered, ...orphaned];
  }, [submission, questions]);

  if (!submission) return null;

  const respondent = submission.respondent;
  const name = respondent
    ? `${respondent.firstName ?? ''} ${respondent.lastName ?? ''}`.trim()
    : null;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={title ?? 'Response'}
      description={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="flex items-center gap-1.5">
            <User className="size-3" />
            {name || respondent?.email || 'Anonymous respondent'}
          </span>
          {respondent?.email && name && (
            <span className="flex items-center gap-1.5">
              <Mail className="size-3" />
              {respondent.email}
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <FileText className="size-3" />
            <FormattedDate value={submission.submittedAt} />
          </span>
          {!!submission.completionTimeMs && (
            <span className="flex items-center gap-1.5">
              <Timer className="size-3" />
              {formatDuration(submission.completionTimeMs)}
            </span>
          )}
        </span>
      }
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            {(onPrev || onNext) && (
              <>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={onPrev}
                  disabled={!onPrev}
                  aria-label="Previous response"
                >
                  <ChevronLeft className="size-4" strokeWidth={1.5} />
                </Button>
                {positionLabel && (
                  <span className="px-1 text-xs tabular-nums text-muted-foreground">
                    {positionLabel}
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={onNext}
                  disabled={!onNext}
                  aria-label="Next response"
                >
                  <ChevronRight className="size-4" strokeWidth={1.5} />
                </Button>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            {footerAction}
            <CopyButton
              value={JSON.stringify(submission.answers, null, 2)}
              label="Copy as JSON"
              variant="ghost"
            />
            <Button size="sm" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={submission.status ?? 'SUBMITTED'} dot />
          {submission.country && (
            <StatusBadge status={submission.country} tone="neutral" label={submission.country} />
          )}
          {submission.maxQuizScore != null && submission.maxQuizScore > 0 && (
            <StatusBadge
              status={submission.isPassed ? 'SUCCESS' : 'FAILED'}
              label={`Score ${submission.quizScore ?? 0} / ${submission.maxQuizScore}`}
              tone={submission.isPassed ? 'success' : 'danger'}
            />
          )}
        </div>

        {isLoadingQuestions && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" strokeWidth={1.5} />
            Loading the form so answers can be labelled…
          </p>
        )}

        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border-strong py-10 text-center text-sm text-muted-foreground">
            This response contains no answers.
          </p>
        ) : (
          <dl className="divide-y divide-border">
            {rows.map((row) => (
              <div key={row.key} className="grid gap-1 py-3 sm:grid-cols-3 sm:gap-4">
                <dt className="text-xs font-medium text-muted-foreground sm:pt-0.5">
                  {row.label}
                  {!row.question && (
                    <span
                      className="ml-1.5 text-[10px] text-warning"
                      title="This question is no longer in the form"
                    >
                      (removed)
                    </span>
                  )}
                </dt>
                <dd className="text-sm sm:col-span-2">
                  <AnswerValue value={row.value} question={row.question} />
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </Modal>
  );
}

function NoAnswer() {
  return <span className="text-muted-foreground italic">No answer</span>;
}

function AnswerValue({ value, question }: { value: unknown; question?: FormQuestion }) {
  // `false` and `0` are real answers. A truthiness check would have hidden both.
  if (value === undefined || value === null || value === '') return <NoAnswer />;

  if (typeof value === 'boolean') return <>{value ? 'Yes' : 'No'}</>;

  if (Array.isArray(value)) {
    if (value.length === 0) return <NoAnswer />;
    const labels = value.map((v) => optionLabel(v, question));
    return (
      <ul className="flex flex-wrap gap-1.5">
        {labels.map((label, i) => (
          <li
            key={`${label}-${i}`}
            className="rounded-md border border-border bg-muted/50 px-2 py-0.5 text-xs"
          >
            {label}
          </li>
        ))}
      </ul>
    );
  }

  if (typeof value === 'object') {
    const record = value as Record<string, any>;

    // File uploads come back as an object with the storage metadata.
    if (record.fileId || record.objectKey || record.filename) {
      return (
        <span className="inline-flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-xs">
          <Download className="size-3.5 text-muted-foreground" />
          <span className="font-medium">{record.filename ?? record.objectKey ?? 'File'}</span>
          {record.sizeBytes != null && (
            <span className="text-muted-foreground">{formatBytes(Number(record.sizeBytes))}</span>
          )}
        </span>
      );
    }

    // Matrix answers: { rowLabel: columnValue }
    return (
      <dl className="space-y-1">
        {Object.entries(record).map(([key, entry]) => (
          <div key={key} className="flex gap-2 text-xs">
            <dt className="text-muted-foreground">{key}:</dt>
            <dd>{String(entry)}</dd>
          </div>
        ))}
      </dl>
    );
  }

  if (question?.type === 'SIGNATURE' && typeof value === 'string' && value.startsWith('data:')) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={value}
        alt="Respondent signature"
        className="h-16 rounded border border-border bg-white"
      />
    );
  }

  if (question?.type === 'URL' && typeof value === 'string') {
    return (
      <a
        href={value}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="break-all underline underline-offset-2 hover:text-foreground"
      >
        {value}
      </a>
    );
  }

  return <span className="whitespace-pre-wrap break-words">{optionLabel(value, question)}</span>;
}

/** Map a stored option value back to its human label where possible. */
function optionLabel(value: unknown, question?: FormQuestion): string {
  const raw = String(value);
  const match = question?.options?.find((o) => o.value === raw || o.label === raw);
  return match?.label ?? raw;
}
