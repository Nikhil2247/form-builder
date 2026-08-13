'use client';

import React from 'react';
import {
  AlertCircle,
  CalendarClock,
  Download,
  FileText,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { EmptyState, ErrorState, RelativeTime, StatusBadge } from '@/components/shared';
import { formatBytes, formatCompact } from '@/components/shared/formatters';
import {
  daysUntilExpiry,
  useCreateExport,
  useDownloadExport,
  useExports,
  type ExportJob,
  type ExportJobFormat,
} from '@/hooks/use-exports';

/**
 * Background exports for one form.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Sits beside — not instead of — the existing Export dropdown. The synchronous
 * download is genuinely better for a small form: the file arrives in two
 * seconds and there is nothing to come back for. It is only past a few thousand
 * rows that it becomes the wrong tool, and the failure there is nasty: the
 * response travels as one long-lived HTTP request, and a proxy that times it
 * out delivers a CSV that opens fine and is silently missing everything after
 * the cut-off. So the threshold is explained rather than enforced, and the
 * heavier option is put in front of the user exactly when it starts to matter.
 *
 * EXPIRY IS SHOWN, NOT BURIED. A finished export is a full copy of the form's
 * responses sitting in a bucket, so it is deleted after a short retention
 * window. Someone who bookmarks a download link and comes back next month must
 * be able to work out why it is gone — which means being told, at the time,
 * that it would not last.
 */
export interface ExportJobsPanelProps {
  formId: string;
  /** Used only to size the advice; the server decides what is actually allowed. */
  totalSubmissions: number;
  /** Rows past which the synchronous download stops being a good idea. */
  thresholdRows: number;
}

export function ExportJobsPanel({ formId, totalSubmissions, thresholdRows }: ExportJobsPanelProps) {
  const { exports, isLoading, error, refetch, isFetching, pollingStopped } = useExports(formId);
  const createExport = useCreateExport();
  const downloadExport = useDownloadExport();

  const isLarge = totalSubmissions > thresholdRows;

  async function start(format: ExportJobFormat) {
    try {
      await createExport.mutateAsync({ formId, format });
      toast.success('Export queued', {
        description: 'It runs in the background — you can leave this page.',
      });
    } catch {
      // Reported globally by the mutation's errorFallback.
    }
  }

  return (
    <Card className="space-y-5 p-5">
      <div className="space-y-1.5">
        <h3 className="text-sm font-medium">Background export</h3>
        <p className="text-sm text-muted-foreground">
          {isLarge ? (
            <>
              This form has {formatCompact(totalSubmissions)} responses. Downloading that directly
              can take long enough for a network timeout to cut the file short — and a truncated CSV
              opens without complaining. Run it in the background instead: we prepare the file, then
              give you a link.
            </>
          ) : (
            <>
              For a form this size the <strong>Export</strong> button above is faster — the file
              downloads immediately. Background exports are for large forms (roughly{' '}
              {formatCompact(thresholdRows)} responses or more), where a direct download risks being
              cut short by a network timeout.
            </>
          )}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={isLarge ? 'default' : 'outline'}
          size="sm"
          className="gap-2"
          disabled={createExport.isPending || totalSubmissions === 0}
          onClick={() => start('CSV')}
        >
          {createExport.isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <FileText className="size-3.5" />
          )}
          Prepare CSV
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          disabled={createExport.isPending || totalSubmissions === 0}
          onClick={() => start('JSON')}
        >
          <FileText className="size-3.5" />
          Prepare JSON
        </Button>

        {pollingStopped && (
          <Button variant="ghost" size="sm" className="gap-2" onClick={() => refetch()}>
            <RefreshCw className={isFetching ? 'size-3.5 animate-spin' : 'size-3.5'} />
            Check again
          </Button>
        )}
      </div>

      {pollingStopped && (
        <p className="text-xs text-muted-foreground">
          This export has been running for a while, so we stopped checking automatically. Use{' '}
          <strong>Check again</strong> to refresh its status.
        </p>
      )}

      {error ? (
        <ErrorState title="Could not load your exports" error={error} onRetry={() => refetch()} />
      ) : exports.length === 0 && !isLoading ? (
        <EmptyState
          variant="inline"
          icon={Download}
          title="No background exports yet"
          description="Prepared files appear here with a download link. They are deleted automatically after their retention period."
        />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {exports.map((job) => (
            <li key={job.id}>
              <ExportJobRow
                job={job}
                isDownloading={downloadExport.isPending && downloadExport.variables === job.id}
                onDownload={() => downloadExport.mutate(job.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Tones the shared badge does not already know about. */
const EXPORT_TONES = {
  QUEUED: 'neutral',
  RUNNING: 'info',
  COMPLETED: 'success',
  FAILED: 'danger',
  EXPIRED: 'neutral',
} as const;

function ExportJobRow({
  job,
  isDownloading,
  onDownload,
}: {
  job: ExportJob;
  isDownloading: boolean;
  onDownload: () => void;
}) {
  const remainingDays = daysUntilExpiry(job);
  const percent = job.progress === null ? null : Math.round(job.progress * 100);

  return (
    <div className="flex flex-wrap items-start gap-3 p-3">
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={job.status} tone={EXPORT_TONES[job.status]} dot />
          <span className="text-sm font-medium">{job.format}</span>
          <span className="truncate text-xs text-muted-foreground">
            {job.filtersDescription}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>
            Requested <RelativeTime value={job.createdAt} />
          </span>
          {job.status === 'COMPLETED' && (
            <>
              <span>{formatCompact(job.rowsWritten)} responses</span>
              <span>{formatBytes(job.bytes)}</span>
            </>
          )}
        </div>

        {(job.status === 'RUNNING' || job.status === 'QUEUED') && (
          <div className="max-w-sm space-y-1 pt-0.5">
            {/*
              An indeterminate bar until the server has counted the rows. Showing
              0% before the total is known reads as "stuck", which is the one
              thing a progress bar must never say about a job that is fine.
            */}
            <Progress value={percent} className="w-full" />
            <span className="text-xs text-muted-foreground">
              {job.status === 'QUEUED'
                ? 'Waiting for a worker…'
                : percent === null
                  ? `${formatCompact(job.rowsWritten)} responses written…`
                  : `${percent}% — ${formatCompact(job.rowsWritten)} of ${formatCompact(job.rowsTotal ?? 0)} responses`}
            </span>
          </div>
        )}

        {job.status === 'FAILED' && job.error && (
          <p className="flex items-start gap-1.5 text-xs text-destructive">
            <AlertCircle className="mt-px size-3.5 shrink-0" />
            {job.error}
          </p>
        )}

        {job.status === 'EXPIRED' && (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <CalendarClock className="mt-px size-3.5 shrink-0" />
            The file was deleted after its retention period. Exports are not kept indefinitely
            because they contain a full copy of your responses. Run it again for a fresh copy.
          </p>
        )}

        {job.status === 'COMPLETED' && remainingDays !== null && (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <CalendarClock className="mt-px size-3.5 shrink-0" />
            Deleted in {remainingDays} day{remainingDays === 1 ? '' : 's'} (
            <RelativeTime value={job.expiresAt} />
            ). Download it before then, or run the export again.
          </p>
        )}
      </div>

      {job.status === 'COMPLETED' && (
        <Button
          size="sm"
          variant="outline"
          className="gap-2"
          disabled={isDownloading}
          onClick={onDownload}
        >
          {isDownloading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Download className="size-3.5" />
          )}
          Download
        </Button>
      )}
    </div>
  );
}
