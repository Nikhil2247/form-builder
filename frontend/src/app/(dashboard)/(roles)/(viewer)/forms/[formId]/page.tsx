'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  CheckCircle2,
  Clock,
  Download,
  Edit,
  ExternalLink,
  Eye,
  Inbox,
  Loader2,
  User,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  StatCard,
  StatGrid,
  StatusBadge,
  EmptyState,
  ErrorState,
  CopyField,
  RelativeTime,
  Duration,
  type DataTableColumn,
  ButtonLink,
  ButtonAnchor,
} from '@/components/shared';
import { formatCompact, formatDuration } from '@/components/shared/formatters';
import { SubmissionDetailsDialog } from '@/components/submissions/SubmissionDetailsDialog';
import { ExportJobsPanel } from '@/components/exports/ExportJobsPanel';
import { Can } from '@/components/auth/RoleGuard';
import { usePagination } from '@/hooks/use-pagination';
import { useForm } from '@/hooks/use-forms';
import { useFormTimeseries } from '@/hooks/use-analytics';
import { useFormSubmissions, useExportSubmissions, type Submission } from '@/hooks/use-submissions';
import { ASYNC_EXPORT_THRESHOLD_ROWS } from '@/hooks/use-exports';
import { toFormConfig } from '@/types/form';

export default function FormDetailPage() {
  const params = useParams();
  const formId = params.formId as string;

  const pager = usePagination();
  const [selected, setSelected] = useState<Submission | null>(null);
  // Controlled so the export dropdown can send the user to the Exports tab when
  // the form is too big for a direct download to be a good idea.
  const [tab, setTab] = useState('responses');

  const { data: form, isLoading: formLoading, error: formError, refetch } = useForm(formId);
  const submissions = useFormSubmissions(formId, {
    page: pager.page,
    limit: pager.pageSize,
  });
  const analytics = useFormTimeseries(formId, 30);
  const exportSubmissions = useExportSubmissions(formId, form?.title);

  const questions = useMemo(() => (form ? toFormConfig(form).questions : []), [form]);

  // Totals come from the pre-aggregated analytics rows rather than the loaded
  // page of submissions — the previous page showed a hardcoded "86%" completion
  // rate and "1m 42s" average for every form.
  const totals = useMemo(() => {
    const rows = analytics.data ?? [];
    const views = rows.reduce((sum, r) => sum + (r.views ?? 0), 0);
    const starts = rows.reduce((sum, r) => sum + (r.starts ?? 0), 0);
    const count = rows.reduce((sum, r) => sum + (r.submissions ?? 0), 0);
    const sumMs = rows.reduce((sum, r) => sum + Number(r.sumCompletionMs ?? 0), 0);

    return {
      views,
      starts,
      submissions: count,
      completionRate: starts > 0 ? Math.min((count / starts) * 100, 100) : null,
      avgCompletionMs: count > 0 ? Math.round(sumMs / count) : null,
    };
  }, [analytics.data]);

  const totalSubmissions = submissions.data?.pagination?.total ?? 0;

  const shareUrl =
    typeof window !== 'undefined' && form?.slug ? `${window.location.origin}/f/${form.slug}` : '';

  async function handleExport(format: 'csv' | 'json') {
    try {
      const result = await exportSubmissions.mutateAsync(format);
      toast.success(`Downloaded ${result.filename}`);
    } catch {
      // Reported globally.
    }
  }

  if (formError) {
    return (
      <PageShell>
        <ErrorState title="Could not load this form" error={formError} onRetry={() => refetch()} />
      </PageShell>
    );
  }

  if (!formLoading && !form) {
    return (
      <PageShell>
        <EmptyState
          icon={Inbox}
          title="Form not found"
          description="It may have been deleted, or you may not have access to it."
          action={
            <ButtonLink size="sm" href="/forms">
              Back to forms
            </ButtonLink>
          }
        />
      </PageShell>
    );
  }

  const columns: DataTableColumn<Submission>[] = [
    {
      id: 'respondent',
      header: 'Respondent',
      isRowHeader: true,
      className: 'max-w-0',
      cell: (submission) => {
        const respondent = submission.respondent;
        const name = respondent
          ? `${respondent.firstName ?? ''} ${respondent.lastName ?? ''}`.trim()
          : '';
        return (
          <div className="flex items-center gap-2.5">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <User className="size-3.5" strokeWidth={1.5} />
            </span>
            <span className="truncate font-medium">
              {name || respondent?.email || 'Anonymous'}
            </span>
          </div>
        );
      },
    },
    {
      id: 'status',
      header: 'Status',
      width: 'w-32',
      hideBelow: 'md',
      cell: (submission) => <StatusBadge status={submission.status ?? 'SUBMITTED'} dot />,
    },
    ...(form?.isQuizMode
      ? [
          {
            id: 'score',
            header: 'Score',
            numeric: true,
            width: 'w-24',
            cell: (submission: Submission) =>
              submission.maxQuizScore
                ? `${submission.quizScore ?? 0} / ${submission.maxQuizScore}`
                : '—',
          } satisfies DataTableColumn<Submission>,
        ]
      : []),
    {
      id: 'completionTimeMs',
      header: 'Time taken',
      numeric: true,
      width: 'w-28',
      hideBelow: 'lg',
      cell: (submission) => <Duration ms={submission.completionTimeMs} />,
    },
    {
      id: 'submittedAt',
      header: 'Submitted',
      width: 'w-40',
      cell: (submission) => (
        <span className="text-muted-foreground">
          <RelativeTime value={submission.submittedAt} />
        </span>
      ),
    },
  ];

  return (
    <PageShell>
      <PageHeader
        isLoading={formLoading}
        back="/forms"
        breadcrumbs={[{ label: 'Forms', href: '/forms' }, { label: form?.title ?? '' }]}
        title={form?.title ?? ''}
        description={form?.description || undefined}
        badge={form && <StatusBadge status={form.status} dot />}
        actions={
          <>
            {form?.status === 'PUBLISHED' && shareUrl && (
              <ButtonAnchor
                variant="outline"
                size="sm"
                className="gap-2"
               href={shareUrl} external>
                <Eye className="size-4" /> View live
              </ButtonAnchor>
            )}
            <Can permission="form:edit">
              <ButtonLink size="sm" className="gap-2" href={`/forms/builder?id=${formId}`}>
                <Edit className="size-4" /> Edit form
              </ButtonLink>
            </Can>
          </>
        }
      />

      <StatGrid>
        <StatCard
          label="Responses"
          icon={Inbox}
          isLoading={submissions.isLoading}
          value={formatCompact(totalSubmissions)}
          hint={`${formatCompact(totals.submissions)} in the last 30 days`}
        />
        <StatCard
          label="Views"
          icon={Eye}
          isLoading={analytics.isLoading}
          value={formatCompact(totals.views)}
          hint="Last 30 days"
        />
        <StatCard
          label="Completion rate"
          icon={CheckCircle2}
          isLoading={analytics.isLoading}
          value={totals.completionRate != null ? `${totals.completionRate.toFixed(1)}%` : '—'}
          hint={
            totals.starts
              ? `${formatCompact(totals.starts)} starts`
              : 'No starts recorded yet'
          }
        />
        <StatCard
          label="Average time"
          icon={Clock}
          isLoading={analytics.isLoading}
          value={totals.avgCompletionMs != null ? formatDuration(totals.avgCompletionMs) : '—'}
          hint="Across completed responses"
        />
      </StatGrid>

      <Tabs value={tab} onValueChange={(value) => setTab(String(value))} className="space-y-4">
        <TabsList>
          <TabsTrigger value="responses" className="gap-1.5">
            <Inbox className="size-3.5" />
            Responses
            {totalSubmissions > 0 && (
              <span className="tabular ml-1 rounded bg-muted px-1.5 text-xs text-muted-foreground">
                {totalSubmissions.toLocaleString()}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="exports" className="gap-1.5">
            <Download className="size-3.5" /> Exports
          </TabsTrigger>
          <TabsTrigger value="share" className="gap-1.5">
            <ExternalLink className="size-3.5" /> Share
          </TabsTrigger>
        </TabsList>

        <TabsContent value="responses">
          <DataTable
            caption={`Responses to ${form?.title ?? 'this form'}`}
            columns={columns}
            data={submissions.data?.submissions}
            getRowId={(submission) => submission.id}
            isLoading={submissions.isLoading || submissions.isFetching}
            error={submissions.error}
            onRetry={() => submissions.refetch()}
            onRowClick={setSelected}
            pagination={pager.paginationProps(totalSubmissions, 'responses')}
            toolbar={
              <div className="ml-auto">
                <Can permission="submission:export">
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      disabled={totalSubmissions === 0 || exportSubmissions.isPending}
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
                      {/*
                        Past a few thousand responses a direct download is a
                        single long-lived request, and a proxy timeout truncates
                        it into a CSV that opens fine and is quietly incomplete.
                        Point at the background path rather than removing the
                        direct one — small exports are still better served by it.
                      */}
                      {totalSubmissions > ASYNC_EXPORT_THRESHOLD_ROWS && (
                        <DropdownMenuItem
                          onClick={() => setTab('exports')}
                          className="cursor-pointer"
                        >
                          Prepare in background (recommended)
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </Can>
              </div>
            }
            empty={
              <EmptyState
                variant="inline"
                icon={Inbox}
                title="No responses yet"
                description={
                  form?.status === 'PUBLISHED'
                    ? 'Share the form link to start collecting responses.'
                    : 'This form is not published, so it cannot receive responses yet.'
                }
              />
            }
          />
        </TabsContent>

        <TabsContent value="exports">
          <Can permission="submission:export">
            <ExportJobsPanel
              formId={formId}
              totalSubmissions={totalSubmissions}
              thresholdRows={ASYNC_EXPORT_THRESHOLD_ROWS}
            />
          </Can>
        </TabsContent>

        <TabsContent value="share">
          <Card className="space-y-6 p-5">
            {form?.status !== 'PUBLISHED' ? (
              <EmptyState
                variant="inline"
                icon={ExternalLink}
                title="This form is not live"
                description="Publish it from the builder to get a shareable link. Until then its public URL returns a 404 and submissions are rejected."
                action={
                  <Can permission="form:publish">
                    <ButtonLink size="sm" href={`/forms/builder?id=${formId}`}>
                      Open builder
                    </ButtonLink>
                  </Can>
                }
              />
            ) : (
              <>
                <CopyField
                  label="Public link"
                  value={shareUrl}
                  description="Anyone with this link can complete the form."
                />
                <div className="space-y-1.5">
                  <span className="block text-xs font-medium">Embed</span>
                  <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                    {`<iframe src="${shareUrl}" width="100%" height="600" style="border:0" title="${form.title}"></iframe>`}
                  </pre>
                </div>
              </>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      <SubmissionDetailsDialog
        submission={selected}
        questions={questions}
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </PageShell>
  );
}
