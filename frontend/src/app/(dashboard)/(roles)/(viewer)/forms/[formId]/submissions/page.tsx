'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Download, Inbox, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  PageHeader,
  PageShell,
  DataTable,
  StatusBadge,
  EmptyState,
  ErrorState,
  ButtonLink,
  RelativeTime,
  Duration,
  type DataTableColumn,
} from '@/components/shared';
import { SubmissionDetailsDialog } from '@/components/submissions/SubmissionDetailsDialog';
import { Can } from '@/components/auth/RoleGuard';
import { usePagination } from '@/hooks/use-pagination';
import { useForm } from '@/hooks/use-forms';
import { useFormSubmissions, useExportSubmissions, type Submission } from '@/hooks/use-submissions';
import { toFormConfig, type FormQuestion } from '@/types/form';

/**
 * Spreadsheet view: one column per question.
 *
 * Replaces `SubmissionsView`, which rendered every answer through
 * `JSON.stringify` for its search filter, hardcoded `slate-*`/`indigo-*`
 * colours that ignored the theme entirely (unreadable in dark mode), computed
 * an "average NPS" from a hardcoded question id (`q-recommend`) that existed in
 * the sample data and no real form, and exported via a client-side xlsx bundle
 * while the API already streams CSV and JSON.
 */
export default function FormSubmissionsPage() {
  const params = useParams();
  const formId = params.formId as string;

  const pager = usePagination();
  const [selected, setSelected] = useState<Submission | null>(null);

  const form = useForm(formId);
  const submissions = useFormSubmissions(formId, { page: pager.page, limit: pager.pageSize });
  const exportSubmissions = useExportSubmissions(formId, form.data?.title);

  const questions = useMemo<FormQuestion[]>(
    () => (form.data ? toFormConfig(form.data).questions : []),
    [form.data],
  );

  const total = submissions.data?.pagination?.total ?? 0;

  const columns: DataTableColumn<Submission>[] = useMemo(() => {
    const base: DataTableColumn<Submission>[] = [
      {
        id: 'submittedAt',
        header: 'Submitted',
        width: 'w-40',
        isRowHeader: true,
        cell: (submission) => (
          <div className="min-w-0">
            <RelativeTime value={submission.submittedAt} />
            <div className="truncate text-xs text-muted-foreground">
              {submission.respondent?.email ?? 'Anonymous'}
            </div>
          </div>
        ),
      },
      {
        id: 'status',
        header: 'Status',
        width: 'w-32',
        cell: (submission) => <StatusBadge status={submission.status ?? 'SUBMITTED'} dot />,
      },
    ];

    // One column per answerable question, capped so a 60-question form does not
    // produce a table nobody can scroll. The detail dialog shows everything.
    const answerColumns = questions
      .filter((question) => question.type !== 'SECTION_HEADER')
      .slice(0, 12)
      .map<DataTableColumn<Submission>>((question) => ({
        id: question.id,
        header: question.label,
        headerClassName: 'max-w-56 truncate',
        className: 'max-w-64',
        cell: (submission) => (
          <span className="block truncate" title={preview(submission.answers?.[question.id])}>
            {preview(submission.answers?.[question.id]) || (
              <span className="text-muted-foreground">—</span>
            )}
          </span>
        ),
      }));

    return [
      ...base,
      ...answerColumns,
      {
        id: 'completionTimeMs',
        header: 'Time taken',
        numeric: true,
        width: 'w-28',
        cell: (submission) => <Duration ms={submission.completionTimeMs} />,
      },
    ];
  }, [questions]);

  async function handleExport(format: 'csv' | 'json') {
    try {
      const result = await exportSubmissions.mutateAsync(format);
      toast.success(`Downloaded ${result.filename}`);
    } catch {
      // Reported globally.
    }
  }

  if (form.error) {
    return (
      <PageShell>
        <ErrorState title="Could not load this form" error={form.error} onRetry={() => form.refetch()} />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        isLoading={form.isLoading}
        back={`/forms/${formId}`}
        breadcrumbs={[
          { label: 'Forms', href: '/forms' },
          { label: form.data?.title ?? '', href: `/forms/${formId}` },
          { label: 'Responses' },
        ]}
        title={`${form.data?.title ?? 'Form'} — responses`}
        description="One row per response, one column per question. Select a row for the full detail."
        actions={
          <Can permission="submission:export">
            <DropdownMenu>
              <DropdownMenuTrigger
                disabled={total === 0 || exportSubmissions.isPending}
                render={
                  <Button variant="outline" size="sm" className="gap-2">
                    {exportSubmissions.isPending ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Download className="size-3.5" />
                    )}
                    Export
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
        }
      />

      {questions.length > 12 && (
        <p className="text-xs text-muted-foreground">
          Showing the first 12 of {questions.length} questions as columns. Every answer is included
          in the detail view and in exports.
        </p>
      )}

      <DataTable
        caption={`Responses to ${form.data?.title ?? 'this form'}`}
        columns={columns}
        data={submissions.data?.submissions}
        getRowId={(submission) => submission.id}
        isLoading={submissions.isLoading || submissions.isFetching}
        error={submissions.error}
        onRetry={() => submissions.refetch()}
        onRowClick={setSelected}
        pagination={pager.paginationProps(total, 'responses')}
        empty={
          <EmptyState
            variant="inline"
            icon={Inbox}
            title="No responses yet"
            description="Share the form link to start collecting responses."
            action={
              <ButtonLink variant="outline" size="sm" href={`/forms/${formId}`}>
                Get the share link
              </ButtonLink>
            }
          />
        }
      />

      <SubmissionDetailsDialog
        submission={selected}
        questions={questions}
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </PageShell>
  );
}

/** Single-line preview of an answer for a table cell. */
function preview(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.map((v) => preview(v)).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    const record = value as Record<string, any>;
    // File uploads and matrix answers are objects; show something meaningful
    // rather than "[object Object]".
    if (record.filename) return String(record.filename);
    return Object.entries(record)
      .map(([key, entry]) => `${key}: ${entry}`)
      .join(' · ');
  }
  return String(value);
}
