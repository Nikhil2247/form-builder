'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Boxes, Contact, FileBox, Hash, Inbox, Trash2 } from 'lucide-react';
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
import { AttributeList } from '@/components/apps/AttributeList';
import { DataAppsDisabled } from '@/components/apps/DataAppsGate';
import { FEATURES, useFeature } from '@/hooks/use-features';
import { usePagination } from '@/hooks/use-pagination';
import {
  useDeleteSubject,
  useSubject,
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
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete this record');
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
          <div className="space-y-3">
            <ol className="relative space-y-3 border-l border-border pl-6">
              {entries.map((entry) => (
                <TimelineRow key={entry.id} entry={entry} />
              ))}
            </ol>

            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <DataTablePagination
                {...pager.paginationProps(totalEntries, 'entries')}
                isLoading={timeline.isFetching}
                className="border-t-0"
              />
            </div>
          </div>
        )}
      </section>

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

function TimelineRow({ entry }: { entry: TimelineEntry }) {
  const answerCount = Object.keys(entry.answers ?? {}).length;

  return (
    <li className="relative">
      {/* The node sits on the rail drawn by the parent's left border. */}
      <span
        aria-hidden
        className="absolute -left-[1.9375rem] top-5 flex size-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground"
      >
        <FileBox className="size-3" strokeWidth={1.5} />
      </span>

      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {entry.form ? (
              <Link
                href={`/forms/${entry.form.id}`}
                className="truncate text-sm font-medium text-foreground underline-offset-2 hover:underline"
              >
                {entry.form.title}
              </Link>
            ) : (
              <span className="truncate text-sm font-medium text-foreground">Deleted form</span>
            )}
            <p className="mt-0.5 text-xs text-muted-foreground">
              <RelativeTime value={entry.submittedAt} /> · {answerCount}{' '}
              {answerCount === 1 ? 'answer' : 'answers'}
            </p>
          </div>
          <StatusBadge status={entry.status} dot />
        </div>
      </Card>
    </li>
  );
}
