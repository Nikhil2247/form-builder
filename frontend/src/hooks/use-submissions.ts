import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchApi } from '@/lib/api';
import { useUser } from './use-auth';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
export interface Submission {
  id: string;
  formId: string;
  data: Record<string, unknown>;
  submittedAt: string;
  completionTime?: number; // seconds
  respondentEmail?: string;
}

export interface SubmissionsResponse {
  submissions: Submission[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Hooks
// ─────────────────────────────────────────────────────────────────────────────

/** List submissions for a specific form */
export function useFormSubmissions(formId: string | undefined, page = 1, limit = 50) {
  const { data: session } = useUser();
  const orgId = session?.activeOrganization?.id;
  return useQuery<SubmissionsResponse>({
    queryKey: ['submissions', orgId, formId, page, limit],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      const res = await fetchApi(
        `/organizations/${orgId}/forms/${formId}/submissions?${params.toString()}`,
      );
      return res.data ?? res;
    },
    enabled: !!orgId && !!formId,
  });
}

/** Export submissions for a form */
export function useExportSubmissions(formId: string) {
  const { data: session } = useUser();
  const orgId = session?.activeOrganization?.id;
  return useMutation({
    mutationFn: async (format: 'csv' | 'json') => {
      const res = await fetchApi(
        `/organizations/${orgId}/forms/${formId}/export?format=${format}`,
      );
      return res;
    },
  });
}

/** Cross-org submissions (ADMIN-level) - combine from analytics or direct service calls */
export function useOrgSubmissions(page = 1, limit = 50) {
  const { data: session } = useUser();
  const orgId = session?.activeOrganization?.id;
  return useQuery({
    queryKey: ['org-submissions', orgId, page, limit],
    queryFn: async () => {
      // Fetch submissions across all forms - via analytics endpoint
      const res = await fetchApi(
        `/organizations/${orgId}/submissions?page=${page}&limit=${limit}`,
      );
      return res.data ?? res;
    },
    enabled: !!orgId,
  });
}
