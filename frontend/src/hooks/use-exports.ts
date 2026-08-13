import { useCallback, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchApi, unwrap } from '@/lib/api';
import { useOrgId } from './use-auth';

/**
 * Asynchronous export jobs.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The synchronous export (`useExportSubmissions` in use-submissions.ts) is
 * still the right call for a small form: one request, one blob, one download,
 * no state to track. It stops being the right call somewhere in the tens of
 * thousands of rows, because the whole export has to travel down a single HTTP
 * response — and a load balancer with a 60-second idle timeout will cut that
 * response off mid-row, handing the user a CSV that opens cleanly and is
 * missing half its data.
 *
 * These hooks drive the other path: ask the API to run the export, get an id
 * back immediately, poll until it lands in object storage, then download it
 * from storage directly.
 */

export type ExportJobStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'EXPIRED';
export type ExportJobFormat = 'CSV' | 'JSON';

export interface ExportJobFilters {
  from?: string;
  to?: string;
  statuses?: string[];
  search?: string;
  formIds?: string[];
}

/** Mirrors the API's export summary exactly — see ExportsService.toSummary. */
export interface ExportJob {
  id: string;
  status: ExportJobStatus;
  format: ExportJobFormat;
  formId: string | null;
  scope: 'form' | 'organization';
  /** Form title, or "all-forms" for an org-wide export. */
  label: string;
  /** Frozen at creation. Describes what the finished file contains, forever. */
  filters: ExportJobFilters;
  filtersDescription: string;
  rowsWritten: number;
  rowsTotal: number | null;
  /** 0–1, already clamped server-side. Null until a total is known. */
  progress: number | null;
  bytes: number | null;
  /** User-safe failure reason. Rendered verbatim; never contains internals. */
  error: string | null;
  /** When the stored file is swept from the bucket. Null until it completes. */
  expiresAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  /** Present only on the create response. */
  retentionDays?: number;
}

export interface ExportsPage {
  exports: ExportJob[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export interface ExportDownload {
  downloadUrl: string;
  filename: string;
  expiresIn: number;
  urlExpiresAt: string;
  fileExpiresAt: string | null;
}

/** A job is "settled" when nothing further will happen to it without a new request. */
export function isExportSettled(job: ExportJob): boolean {
  return job.status === 'COMPLETED' || job.status === 'FAILED' || job.status === 'EXPIRED';
}

/**
 * Row count past which the synchronous export stops being a good idea.
 *
 * Matches the shape of the server's own advice rather than its hard cap: the
 * API refuses a synchronous export past EXPORT_MAX_ROWS (50 000 by default),
 * but the experience degrades long before the refusal — a 20 000-row export is
 * a browser tab hanging on a blob for a minute with no progress indication at
 * all. Offering the async path from 5 000 is the point where "wait for the
 * download" starts costing more than "we'll tell you when it's ready".
 */
export const ASYNC_EXPORT_THRESHOLD_ROWS = 5_000;

/** Poll cadence while a job is in flight. */
const POLL_INTERVAL_MS = 3_000;

/**
 * Hard stop on polling.
 *
 * A job whose worker was killed mid-upload stays RUNNING until the server-side
 * retention sweeper reaps it, which is hours away. Polling until then means a
 * tab left open overnight quietly issues twelve hundred requests an hour
 * forever. After half an hour the UI stops on its own and offers a manual
 * refresh, which is both cheaper and more honest than a spinner that has not
 * moved since breakfast.
 */
const MAX_POLL_MS = 30 * 60 * 1000;

/**
 * Poll while anything is in flight; stop the moment everything settles, and give
 * up entirely once the window lapses.
 *
 * The clock lives in a ref and is read from react-query's `refetchInterval`
 * callback rather than during render. Both halves of that matter: reading
 * `Date.now()` while rendering makes the component non-idempotent (the same
 * props produce different output on a re-render React chose to do for its own
 * reasons), and deriving the deadline in an effect would mean a setState
 * cascade on every poll. The callback runs outside render, so the one place
 * that needs wall-clock time is the one place allowed to have it.
 */
function usePollWindow() {
  const startedAtRef = useRef<number | null>(null);
  const [exhausted, setExhausted] = useState(false);

  const intervalFor = useCallback((active: boolean): number | false => {
    if (!active) {
      // Everything settled. Reset so a job queued twenty minutes from now gets
      // its own full window rather than inheriting this one's remainder.
      startedAtRef.current = null;
      setExhausted((previous) => (previous ? false : previous));
      return false;
    }

    startedAtRef.current ??= Date.now();

    if (Date.now() - startedAtRef.current > MAX_POLL_MS) {
      setExhausted((previous) => (previous ? previous : true));
      return false;
    }

    return POLL_INTERVAL_MS;
  }, []);

  return { exhausted, intervalFor };
}

/**
 * This org's export jobs, newest first, optionally narrowed to one form.
 */
export function useExports(formId?: string, { enabled = true }: { enabled?: boolean } = {}) {
  const orgId = useOrgId();
  const { exhausted, intervalFor } = usePollWindow();

  const query = useQuery<ExportsPage>({
    queryKey: ['exports', orgId, formId ?? 'all'],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '10' });
      if (formId) params.set('formId', formId);
      const data = unwrap<Partial<ExportsPage>>(
        await fetchApi(`/organizations/${orgId}/exports?${params}`),
      );
      return {
        exports: data?.exports ?? [],
        pagination: data?.pagination ?? { page: 1, limit: 10, total: 0, totalPages: 0 },
      };
    },
    enabled: enabled && !!orgId,
    refetchInterval: (query) =>
      intervalFor((query.state.data?.exports ?? []).some((job) => !isExportSettled(job))),
    // A job that finished while the tab was in the background should be ready
    // to download the instant the user comes back, without waiting a tick.
    refetchOnWindowFocus: true,
  });

  const active = (query.data?.exports ?? []).some((job) => !isExportSettled(job));

  return {
    ...query,
    exports: query.data?.exports ?? [],
    /** True while at least one job is queued or running. */
    isPolling: active && !exhausted,
    /** True when polling gave up on a job that never settled. */
    pollingStopped: active && exhausted,
  };
}

/** One job's status and progress. Polls on the same terms as the list. */
export function useExport(exportId: string | undefined) {
  const orgId = useOrgId();
  const { exhausted, intervalFor } = usePollWindow();

  const query = useQuery<ExportJob>({
    queryKey: ['export', orgId, exportId],
    queryFn: async () =>
      unwrap<ExportJob>(await fetchApi(`/organizations/${orgId}/exports/${exportId}`)),
    enabled: !!orgId && !!exportId,
    refetchInterval: (query) =>
      intervalFor(!!query.state.data && !isExportSettled(query.state.data)),
  });

  const active = !!query.data && !isExportSettled(query.data);

  return { ...query, isPolling: active && !exhausted, pollingStopped: active && exhausted };
}

export interface CreateExportInput {
  /** Omit for an org-wide export. */
  formId?: string;
  format?: ExportJobFormat;
  filters?: { from?: string; to?: string; statuses?: string[]; search?: string };
}

/**
 * Queue an export. Resolves as soon as the API has accepted it (202) — the file
 * does not exist yet, so callers must poll rather than assume a download.
 */
export function useCreateExport() {
  const orgId = useOrgId();
  const qc = useQueryClient();

  return useMutation({
    meta: { errorFallback: 'Could not start this export' },
    mutationFn: async (input: CreateExportInput) =>
      unwrap<ExportJob>(
        await fetchApi(`/organizations/${orgId}/exports`, {
          method: 'POST',
          body: JSON.stringify(input),
        }),
      ),
    onSuccess: () => {
      // Invalidate both the form-scoped list and the org-wide one; a new job
      // belongs to whichever the user happens to be looking at.
      qc.invalidateQueries({ queryKey: ['exports', orgId] });
    },
  });
}

/**
 * Fetch a presigned URL and hand the browser to object storage.
 *
 * The bytes never come through the API — that is the entire reason this feature
 * exists — so this cannot use the blob-download trick the synchronous export
 * uses. The signed URL carries a Content-Disposition override, so the browser
 * saves the file under a readable name rather than the job's UUID.
 */
export function useDownloadExport() {
  const orgId = useOrgId();
  const qc = useQueryClient();

  return useMutation({
    meta: { errorFallback: 'Could not open this download' },
    mutationFn: async (exportId: string) =>
      unwrap<ExportDownload>(
        await fetchApi(`/organizations/${orgId}/exports/${exportId}/download`),
      ),
    onSuccess: (result) => {
      if (typeof window !== 'undefined') window.location.assign(result.downloadUrl);
    },
    onError: () => {
      // The most likely reason a download 404s is that retention swept the file
      // between the list being rendered and the button being clicked. Refetching
      // replaces the stale download button with the EXPIRED explanation.
      qc.invalidateQueries({ queryKey: ['exports', orgId] });
    },
  });
}

/**
 * How long a completed export has left, in whole days, or null once gone.
 * Rendered next to the download button: a user who bookmarks a link and comes
 * back in a month needs to have been told, at the time, that it would not last.
 */
export function daysUntilExpiry(job: ExportJob, now: number = Date.now()): number | null {
  if (!job.expiresAt) return null;
  const remaining = new Date(job.expiresAt).getTime() - now;
  if (remaining <= 0) return null;
  return Math.max(1, Math.ceil(remaining / (24 * 60 * 60 * 1000)));
}
