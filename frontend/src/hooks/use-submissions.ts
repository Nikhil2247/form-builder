import { useQuery, useMutation, keepPreviousData } from '@tanstack/react-query';
import { DEFAULT_PAGE_SIZE } from './use-pagination';
import { fetchApi, unwrap, getAccessToken, refreshAccessToken, ApiError } from '@/lib/api';
import { useOrgId } from './use-auth';
import { API_BASE_URL } from '@/lib/config';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Mirrors the API's FormSubmission record. */
export interface Submission {
  id: string;
  formId: string;
  formVersionId?: string;
  answers: Record<string, any>;
  submittedAt: string;
  processedAt?: string | null;
  completionTimeMs: number;
  status?: 'SUBMITTED' | 'FLAGGED_SPAM' | 'REJECTED' | 'DELETED';
  country?: string | null;
  quizScore?: number;
  maxQuizScore?: number;
  isPassed?: boolean | null;
  form?: { id: string; title: string };
  respondent?: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
  } | null;
}

export interface SubmissionsResponse {
  submissions: Submission[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

function normalise(data: any, page: number, limit: number): SubmissionsResponse {
  const submissions = data?.submissions ?? (Array.isArray(data) ? data : []);
  return {
    submissions,
    pagination: data?.pagination ?? {
      page,
      limit,
      total: submissions.length,
      totalPages: 1,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────────────────

/** Submissions for one form. */
export function useFormSubmissions(
  formId: string | undefined,
  { page = 1, limit = DEFAULT_PAGE_SIZE }: { page?: number; limit?: number } = {},
) {
  const orgId = useOrgId();

  return useQuery<SubmissionsResponse>({
    queryKey: ['submissions', orgId, formId, page, limit],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      const data = unwrap<any>(
        await fetchApi(`/organizations/${orgId}/forms/${formId}/submissions?${params}`),
      );
      return normalise(data, page, limit);
    },
    enabled: !!orgId && !!formId,
    // Keeps the current page on screen while the next one loads.
    placeholderData: keepPreviousData,
  });
}

/** Submissions across every form in the organization. */
export function useOrgSubmissions({
  page = 1,
  limit = DEFAULT_PAGE_SIZE,
  search = '',
}: { page?: number; limit?: number; search?: string } = {}) {
  const orgId = useOrgId();

  return useQuery<SubmissionsResponse>({
    queryKey: ['org-submissions', orgId, page, limit, search],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (search) params.set('search', search);
      const data = unwrap<any>(await fetchApi(`/organizations/${orgId}/submissions?${params}`));
      return normalise(data, page, limit);
    },
    enabled: !!orgId,
    placeholderData: keepPreviousData,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Download a CSV or JSON export.
 *
 * The export endpoint streams a file with a Content-Disposition header, so it
 * cannot go through `fetchApi` — the previous hook did exactly that, parsed the
 * CSV as JSON, threw, and surfaced "Unexpected token" as the export error. It
 * also never gave the user a file: nothing was ever written to disk.
 *
 * Uses a blob URL rather than navigating to the endpoint, because a plain
 * <a href> cannot carry the Authorization header (the token is memory-only, by
 * design) and would 401.
 */
export function useExportSubmissions(formId: string | undefined, formTitle?: string) {
  const orgId = useOrgId();

  return useMutation({
    mutationFn: async (format: 'csv' | 'json') => {
      if (!orgId || !formId) throw new ApiError('No form selected', 400);

      const request = (token: string | null) =>
        fetch(`${API_BASE_URL}/organizations/${orgId}/forms/${formId}/export?format=${format}`, {
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });

      let response = await request(getAccessToken());
      if (response.status === 401) {
        const token = await refreshAccessToken();
        if (!token) throw new ApiError('Your session has expired. Please sign in again.', 401);
        response = await request(token);
      }

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new ApiError(
          body?.error?.message ?? `Export failed (${response.status})`,
          response.status,
        );
      }

      const blob = await response.blob();

      // Prefer the server's filename; fall back to a slug of the form title.
      const disposition = response.headers.get('Content-Disposition') ?? '';
      const match = /filename="?([^"';]+)"?/i.exec(disposition);
      const safeTitle = (formTitle ?? 'export')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
      const filename =
        match?.[1] ?? `${safeTitle || 'export'}-${new Date().toISOString().slice(0, 10)}.${format}`;

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Revoking immediately can cancel the download in Safari.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);

      return { filename, size: blob.size };
    },
  });
}
