import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { DEFAULT_PAGE_SIZE } from './use-pagination';
import { fetchApi, unwrap } from '@/lib/api';
import { useOrgId } from './use-auth';

export type { Form } from '../types/form';
import type { Form } from '../types/form';

export interface Paginated<T> {
  pagination: { page: number; limit: number; total: number; totalPages: number };
  forms?: T[];
}

export interface FormsResponse {
  forms: Form[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export interface FormsQuery {
  page?: number;
  limit?: number;
  status?: string;
  search?: string;
  sort?: string | null;
  direction?: 'asc' | 'desc';
}

/**
 * List forms.
 *
 * `placeholderData: keepPreviousData` is what makes paging feel instant: the
 * previous page stays on screen (dimmed by DataTable) while the next loads,
 * instead of the table collapsing to a spinner and the page jumping to the top.
 *
 * Search is sent to the server. The forms page used to filter the current page
 * locally, so searching for a form on page 3 of 5 found nothing unless you
 * happened to be on the right page.
 */
export function useForms(query: FormsQuery = {}) {
  const orgId = useOrgId();
  const { page = 1, limit = DEFAULT_PAGE_SIZE, status, search, sort, direction = 'desc' } = query;

  return useQuery<FormsResponse>({
    queryKey: ['forms', orgId, { page, limit, status, search, sort, direction }],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (status && status !== 'ALL') params.set('status', status);
      if (search) params.set('search', search);
      if (sort) {
        params.set('sortBy', sort);
        params.set('sortOrder', direction);
      }

      const data = unwrap<FormsResponse>(
        await fetchApi(`/organizations/${orgId}/forms?${params}`),
      );
      return {
        forms: data.forms ?? [],
        pagination: data.pagination ?? { page, limit, total: data.forms?.length ?? 0, totalPages: 1 },
      };
    },
    enabled: !!orgId,
    placeholderData: keepPreviousData,
  });
}

export function useForm(formId: string | undefined) {
  const orgId = useOrgId();
  return useQuery<Form>({
    queryKey: ['form', orgId, formId],
    queryFn: async () => {
      const data = unwrap<any>(await fetchApi(`/organizations/${orgId}/forms/${formId}`));
      return data?.form ?? data;
    },
    enabled: !!orgId && !!formId,
  });
}

/** Pre-aggregated analytics for a single form. */
export function useFormAnalytics(formId: string | undefined, days = 30) {
  const orgId = useOrgId();
  return useQuery<any>({
    queryKey: ['form-analytics', orgId, formId, days],
    queryFn: async () =>
      unwrap(await fetchApi(`/organizations/${orgId}/forms/${formId}/analytics?days=${days}`)),
    enabled: !!orgId && !!formId,
    // Analytics are flushed from Redis on an interval; polling faster than that
    // just burns requests.
    staleTime: 60_000,
  });
}

export function useTrashedForms() {
  const orgId = useOrgId();
  return useQuery<Form[]>({
    queryKey: ['forms-trash', orgId],
    queryFn: async () => {
      const data = unwrap<any>(await fetchApi(`/organizations/${orgId}/forms/trash`));
      return Array.isArray(data) ? data : (data?.forms ?? []);
    },
    enabled: !!orgId,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Mutations
//
// Every mutation invalidates with the *prefix* ['forms', orgId], so it clears
// every page, filter, and sort variant. The previous code invalidated the exact
// key only, so deleting a form on page 2 left it visible on page 1.
// ─────────────────────────────────────────────────────────────────────────────

function useFormMutation<TArgs, TResult>(
  fn: (orgId: string, args: TArgs) => Promise<TResult>,
  errorFallback: string,
  extraKeys: string[] = [],
) {
  const qc = useQueryClient();
  const orgId = useOrgId();

  return useMutation({
    // Read by the global MutationCache handler in query-provider when the API's
    // own message is too generic to show. See lib/errors.tsx.
    meta: { errorFallback },
    mutationFn: (args: TArgs) => {
      if (!orgId) throw new Error('No active organization');
      return fn(orgId, args);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['forms', orgId] });
      extraKeys.forEach((key) => qc.invalidateQueries({ queryKey: [key, orgId] }));
    },
  });
}

export function useCreateForm() {
  return useFormMutation<{ title: string; description?: string }, Form>(
    async (orgId, dto) => {
      const data = unwrap<any>(
        await fetchApi(`/organizations/${orgId}/forms`, {
          method: 'POST',
          body: JSON.stringify({ ...dto, themeConfig: {} }),
        }),
      );
      return data?.form ?? data;
    },
    'Could not create this form',
  );
}

export function useUpdateForm(formId: string) {
  const qc = useQueryClient();
  const orgId = useOrgId();

  return useMutation({
    meta: { errorFallback: 'Could not save this form' },
    mutationFn: async (dto: Partial<Form>) => {
      const data = unwrap<any>(
        await fetchApi(`/organizations/${orgId}/forms/${formId}`, {
          method: 'PUT',
          body: JSON.stringify(dto),
        }),
      );
      return data?.form ?? data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['forms', orgId] });
      qc.invalidateQueries({ queryKey: ['form', orgId, formId] });
    },
  });
}

export function useDeleteForm() {
  return useFormMutation<string, void>(async (orgId, formId) => {
    await fetchApi(`/organizations/${orgId}/forms/${formId}`, { method: 'DELETE' });
  }, 'Could not delete this form', ['forms-trash']);
}

export function useCloneForm() {
  return useFormMutation<string, Form>(async (orgId, formId) => {
    const data = unwrap<any>(
      await fetchApi(`/organizations/${orgId}/forms/${formId}/clone`, { method: 'POST' }),
    );
    return data?.form ?? data;
  }, 'Could not duplicate this form');
}

export function useRestoreForm() {
  return useFormMutation<string, Form>(async (orgId, formId) => {
    const data = unwrap<any>(
      await fetchApi(`/organizations/${orgId}/forms/${formId}/restore`, { method: 'POST' }),
    );
    return data?.form ?? data;
  }, 'Could not restore this form', ['forms-trash']);
}

/** Hard delete from trash. */
export function usePurgeForm() {
  return useFormMutation<string, void>(async (orgId, formId) => {
    await fetchApi(`/organizations/${orgId}/forms/${formId}/permanent`, { method: 'DELETE' });
  }, 'Could not permanently delete this form', ['forms-trash']);
}

export function useCreateFromTemplate() {
  return useFormMutation<string, Form>(async (orgId, templateId) => {
    const data = unwrap<any>(
      await fetchApi(`/organizations/${orgId}/forms/from-template/${templateId}`, {
        method: 'POST',
      }),
    );
    return data?.form ?? data;
  }, 'Could not create a form from this template');
}
