'use client';

import React, { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Boxes,
  CalendarClock,
  ChevronRight,
  Contact,
  FileBox,
  Hash,
  Inbox,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ButtonLink,
  ConfirmDialog,
  DataTablePagination,
  EmptyState,
  ErrorState,
  FormattedDate,
  PageHeader,
  PageShell,
  RelativeTime,
  StatusBadge,
} from '@/components/shared';
import { Can } from '@/components/auth/RoleGuard';
import { AddEntryMenu } from '@/components/apps/AddEntryMenu';
import { AttributeList } from '@/components/apps/AttributeList';
import { DataAppsDisabled } from '@/components/apps/DataAppsGate';
import { SubmissionDetailsDialog } from '@/components/submissions/SubmissionDetailsDialog';
import { FEATURES, useFeature } from '@/hooks/use-features';
import { useForm } from '@/hooks/use-forms';
import { usePagination } from '@/hooks/use-pagination';
import type { Submission } from '@/hooks/use-submissions';
import {
  useDeleteSubject,
  useSubject,
  useSubjectEntryOptions,
  useSubjectTimeline,
  type TimelineEntry,
} from '@/hooks/use-subjects';

/**
 * One record and its history.
 *
 * The whole point of a subject is that it outlives any single submission, so
 * the page leads with identity (who this is) and then shows the accumulated
 * entries newest-first. Deleting a record is a soft delete server-side and the
 * submissions survive it — the copy says so, because "delete" that appears to
 * destroy months of collected data is a button nobody dares press.
 */
export default function RecordDetailPage() {
  const params = useParams<{ subjectId: string }>();
  const subjectId = params.subjectId;
  const router = useRouter();

  const appsEnabled = useFeature(FEATURES.FORM_APPS);
  const pager = usePagination();
  const [confirmDelete, setConfirmDelete] = useState(false);
  /**
   * Which timeline entry is open, by INDEX rather than id.
   *
   * The index is what makes stepping through entries possible without closing
   * the dialog — which is the whole point of opening them here. Clicking an
   * entry used to navigate to `/forms/{id}`, the form's full response list for
   * every respondent, where finding the one response you had just clicked meant
   * searching a table for it.
   */
  const [openEntryIndex, setOpenEntryIndex] = useState<number | null>(null);

  const subject = useSubject(subjectId, { enabled: appsEnabled });
  const timeline = useSubjectTimeline(
    subjectId,
    { page: pager.page, limit: pager.pageSize },
    { enabled: appsEnabled },
  );
  const deleteSubject = useDeleteSubject();

  if (!appsEnabled) return <DataAppsDisabled title="Record" />;

  if (subject.error) {
    return (
      <PageShell>
        <ErrorState
          title="Could not load this record"
          error={subject.error}
          onRetry={() => subject.refetch()}
        />
      </PageShell>
    );
  }

  if (!subject.isLoading && !subject.data) {
    return (
      <PageShell>
        <EmptyState
          icon={Contact}
          title="Record not found"
          description="It may have been deleted, or you may not have access to it."
          action={
            <ButtonLink size="sm" href="/records">
              Back to records
            </ButtonLink>
          }
        />
      </PageShell>
    );
  }

  const record = subject.data;
  const entries = timeline.data?.entries ?? [];
  const totalEntries = timeline.data?.pagination?.total ?? 0;

  async function handleDelete() {
    try {
      await deleteSubject.mutateAsync(subjectId);
      toast.success('Record deleted');
      setConfirmDelete(false);
      router.push('/records');
    } catch {
      // Reported globally; the confirm dialog stays open.
    }
  }

  return (
    <PageShell>
      <PageHeader
        isLoading={subject.isLoading}
        back="/records"
        breadcrumbs={[
          { label: 'Records', href: '/records' },
          { label: record?.displayName ?? '' },
        ]}
        title={record?.displayName ?? ''}
        description={
          record?.subjectType?.name ? `${record.subjectType.name} record` : undefined
        }
        badge={
          record?.externalId ? (
            <span className="tabular inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              <Hash className="size-3" />
              {record.externalId}
            </span>
          ) : undefined
        }
        actions={
          <>
            {/* The reason this page exists at all after registration: a record
                accumulates. Leading with it, ahead of the destructive action. */}
            <AddEntryMenu subjectId={subjectId} />
            <Can permission="form:delete">
              <Button
                variant="destructive"
                size="sm"
                className="gap-2"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="size-4" /> Delete record
              </Button>
            </Can>
          </>
        }
      />

      <Card className="space-y-5 p-5">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Boxes className="size-3.5" />
            {record?.subjectType?.name ?? '—'}
          </span>
          <span className="flex items-center gap-1.5">
            <Inbox className="size-3.5" />
            {totalEntries.toLocaleString()} {totalEntries === 1 ? 'entry' : 'entries'}
          </span>
          <span className="flex items-center gap-1.5">
            Added <FormattedDate value={record?.createdAt} />
          </span>
        </div>

        <div className="border-t border-border pt-5">
          <h2 className="mb-3 text-sm font-semibold">Attributes</h2>
          {subject.isLoading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : (
            <AttributeList
              attributes={record?.attributes}
              emptyLabel="No attributes are promoted onto this record. Choose which registration answers to promote from the record type's identity settings."
            />
          )}
        </div>
      </Card>

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">Timeline</h2>
          <span className="text-xs text-muted-foreground">Newest first</span>
        </div>

        {timeline.error ? (
          <ErrorState
            title="Could not load the timeline"
            error={timeline.error}
            onRetry={() => timeline.refetch()}
          />
        ) : timeline.isLoading && entries.length === 0 ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="No entries yet"
            description="Every form filled against this record — visits, follow-ups, measurements — will appear here in order."
          />
        ) : (
          <div className="space-y-5">
            {groupByPeriod(entries).map((group) => (
              <div key={group.key} className="space-y-3">
                {group.label && (
                  <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {group.label}
                  </h3>
                )}
                <ol className="relative space-y-3 border-l border-border pl-6">
                  {group.entries.map((entry) => (
                    <TimelineRow
                      key={entry.id}
                      entry={entry}
                      onOpen={() => setOpenEntryIndex(entries.indexOf(entry))}
                    />
                  ))}
                </ol>
              </div>
            ))}

            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <DataTablePagination
                {...pager.paginationProps(totalEntries, 'entries')}
                isLoading={timeline.isFetching}
                className="border-t-0"
              />
            </div>
          </div>
        )}

        {/* What is MISSING, which a list of what happened can never show. This
            is the output a monitoring programme actually exists to produce. */}
        <OutstandingEntries subjectId={subjectId} />
      </section>

      <EntryDialog
        entries={entries}
        index={openEntryIndex}
        onIndexChange={setOpenEntryIndex}
      />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this record"
        description={
          <>
            &ldquo;{record?.displayName}&rdquo; will be removed from lists and searches. The{' '}
            {totalEntries.toLocaleString()} response{totalEntries === 1 ? '' : 's'} collected
            against it are kept.
          </>
        }
        confirmLabel="Delete record"
        onConfirm={handleDelete}
        isPending={deleteSubject.isPending}
      />
    </PageShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Entries grouped into the cycle they were filed under.
 *
 * Grouped in memory over the page already fetched, never with a query per
 * period — a dozen round-trips to render one page is what makes longitudinal
 * views feel slow. Entries arrive ordered by `occurredAt`, so consecutive runs
 * of the same period are already contiguous and this is a single pass.
 *
 * Standalone entries — no app, no period — fall into one unlabelled group, so a
 * record whose history predates reporting periods still renders as a plain
 * list rather than under a heading invented for it.
 */
function groupByPeriod(entries: TimelineEntry[]) {
  const groups: Array<{ key: string; label: string | null; entries: TimelineEntry[] }> =
    [];

  for (const entry of entries) {
    const key = entry.period?.id ?? '__none__';
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.entries.push(entry);
    } else {
      groups.push({ key, label: entry.period?.label ?? null, entries: [entry] });
    }
  }

  return groups;
}

/**
 * What has NOT been recorded yet.
 *
 * Reuses the same availability data the "Add entry" menu is built from, so the
 * two can never disagree about whether March's check is outstanding. Only steps
 * that are actually scheduled appear — an unscheduled step has no date it was
 * expected by, so calling it missing would be an opinion rather than a fact.
 */
function OutstandingEntries({ subjectId }: { subjectId: string }) {
  const entries = useSubjectEntryOptions(subjectId);

  const outstanding = (entries.data?.options ?? []).flatMap((option) =>
    option.steps
      .filter(
        (step) =>
          step.available &&
          (step.due.status === 'DUE' || step.due.status === 'OVERDUE'),
      )
      .map((step) => ({ option, step })),
  );

  if (outstanding.length === 0) return null;

  return (
    <div className="space-y-3 rounded-xl border border-dashed border-border p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <CalendarClock className="size-4 text-muted-foreground" strokeWidth={1.5} />
        Outstanding
      </h3>
      <ul className="space-y-2">
        {outstanding.map(({ option, step }) => (
          <li
            key={`${option.app.id}-${step.stepKey}`}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
          >
            <span className="font-medium text-foreground">{step.title}</span>
            <span className="text-xs text-muted-foreground">
              {step.due.status === 'OVERDUE' ? (
                <>
                  {step.due.missedCount > 1
                    ? `${step.due.missedCount} missed`
                    : `${step.due.overdueByDays} days overdue`}
                  {step.due.dueAt && (
                    <>
                      {' · was due '}
                      <FormattedDate value={step.due.dueAt} />
                    </>
                  )}
                </>
              ) : (
                <>
                  Due <FormattedDate value={step.due.dueAt} />
                </>
              )}
            </span>
            {option.app.publicSlug && (
              <a
                href={
                  `/a/${option.app.publicSlug}?subject=${encodeURIComponent(subjectId)}` +
                  `&step=${encodeURIComponent(step.stepKey)}`
                }
                className="ml-auto text-xs font-medium text-primary underline underline-offset-4"
              >
                Record now
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * One entry in the record's history.
 *
 * The whole card is the control, not a link on the title. The previous version
 * linked the form's name to `/forms/{id}` — the form's editor — which is both a
 * different destination from what the row is about and a page most viewers
 * cannot open. Activating a row now shows the response it represents.
 */
function TimelineRow({ entry, onOpen }: { entry: TimelineEntry; onOpen: () => void }) {
  const answerCount = Object.keys(entry.answers ?? {}).length;

  // The step's title names what this IS within the programme — "Monthly
  // Progress Check" — where the form's title repeats for every entry of a
  // repeatable step. Falls back for standalone forms, which have no step.
  const label = entry.formAppStep?.title ?? entry.form?.title ?? 'Deleted form';

  // Entered on a different day than it happened. Worth saying, because a
  // timeline ordered by occurrence looks wrong to anyone expecting entry
  // order until they see why.
  const isBackdated =
    !!entry.occurredAt &&
    new Date(entry.occurredAt).toDateString() !==
      new Date(entry.submittedAt).toDateString();

  return (
    <li className="relative">
      {/* The node sits on the rail drawn by the parent's left border. */}
      <span
        aria-hidden
        className="absolute -left-[1.9375rem] top-5 flex size-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground"
      >
        <FileBox className="size-3" strokeWidth={1.5} />
      </span>

      <button
        type="button"
        onClick={onOpen}
        className="w-full rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Card className="p-4 transition-colors hover:border-border-strong hover:bg-muted/40">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-foreground">
                {label}
              </span>
              <p className="mt-0.5 text-xs text-muted-foreground">
                <RelativeTime value={entry.occurredAt ?? entry.submittedAt} /> ·{' '}
                {answerCount} {answerCount === 1 ? 'answer' : 'answers'}
                {entry.period && <> · {entry.period.label}</>}
              </p>
              {isBackdated && (
                <p className="mt-0.5 text-xs text-muted-foreground/80">
                  Entered <FormattedDate value={entry.submittedAt} />
                </p>
              )}
            </div>
            <span className="flex shrink-0 items-center gap-2">
              <StatusBadge status={entry.status} dot />
              <ChevronRight className="size-4 text-muted-foreground" strokeWidth={1.5} />
            </span>
          </div>
        </Card>
      </button>
    </li>
  );
}

/**
 * A timeline entry's answers, in place.
 *
 * Reuses the submissions table's dialog rather than growing a second response
 * renderer: labelling answers against the form's schema, per-type formatting
 * and the "this question was removed" case are all decisions that must not
 * differ depending on which page you opened a response from.
 *
 * The form is fetched lazily — only once an entry is opened, and cached per
 * form id afterwards, so a record whose six entries span three forms costs
 * three requests however many times the reviewer steps back and forth.
 */
function EntryDialog({
  entries,
  index,
  onIndexChange,
}: {
  entries: TimelineEntry[];
  index: number | null;
  onIndexChange: (index: number | null) => void;
}) {
  const entry = index === null ? null : (entries[index] ?? null);
  const form = useForm(entry?.formId);

  if (!entry) return null;

  const submission: Submission = {
    id: entry.id,
    formId: entry.formId,
    answers: entry.answers ?? {},
    submittedAt: entry.submittedAt,
    completionTimeMs: 0,
    status: entry.status as Submission['status'],
    form: entry.form ?? undefined,
  };

  return (
    <SubmissionDetailsDialog
      open
      onOpenChange={(open) => !open && onIndexChange(null)}
      submission={submission}
      questions={form.data?.questionsJson}
      isLoadingQuestions={form.isLoading}
      title={entry.formAppStep?.title ?? entry.form?.title ?? 'Response'}
      positionLabel={`${index! + 1} of ${entries.length}`}
      onPrev={index! > 0 ? () => onIndexChange(index! - 1) : undefined}
      onNext={index! < entries.length - 1 ? () => onIndexChange(index! + 1) : undefined}
      footerAction={
        entry.form ? (
          <ButtonLink
            variant="ghost"
            size="sm"
            href={`/forms/${entry.form.id}/submissions`}
            title={`See every response to ${entry.form.title}`}
          >
            All responses
          </ButtonLink>
        ) : undefined
      }
    />
  );
}
