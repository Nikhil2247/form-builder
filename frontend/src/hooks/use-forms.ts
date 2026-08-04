import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchApi } from '@/lib/api';
import { useUser } from './use-auth';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
export type { Form } from '../types/form';
import type { Form } from '../types/form';

export interface FormsResponse {
  forms: Form[];
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

/** Get the org ID from the user session */
function useOrgId(): string | undefined {
  const { data: session } = useUser();
  return session?.activeOrganization?.id;
}

/** List all forms for the current org */
export function useForms(status?: string, page = 1, limit = 20) {
  const orgId = useOrgId();
  return useQuery<FormsResponse>({
    queryKey: ['forms', orgId, status, page, limit],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      params.set('page', String(page));
      params.set('limit', String(limit));
      const res = await fetchApi(`/organizations/${orgId}/forms?${params.toString()}`);
      return res.data ?? res;
    },
    enabled: !!orgId,
  });
}

/** Get a single form by ID */
export function useForm(formId: string | undefined) {
  const orgId = useOrgId();
  return useQuery<Form>({
    queryKey: ['form', orgId, formId],
    queryFn: async () => {
      const res = await fetchApi(`/organizations/${orgId}/forms/${formId}`);
      return res.data?.form ?? res.data ?? res;
    },
    enabled: !!orgId && !!formId,
  });
}

/** Get trashed forms */
export function useTrashedForms() {
  const orgId = useOrgId();
  return useQuery<Form[]>({
    queryKey: ['forms-trash', orgId],
    queryFn: async () => {
      const res = await fetchApi(`/organizations/${orgId}/forms/trash`);
      // Backend returns a plain array (not {forms: []})
      return Array.isArray(res.data) ? res.data : res.data ?? res;
    },
    enabled: !!orgId,
  });
}

/** Create a new form */
export function useCreateForm() {
  const qc = useQueryClient();
  const { data: session } = useUser();
  const orgId = session?.activeOrganization?.id;
  return useMutation({
    mutationFn: async (dto: { title: string; description?: string }) => {
      const payload = { ...dto, themeConfig: {} };
      const res = await fetchApi(`/organizations/${orgId}/forms`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      return res.data?.form ?? res.data ?? res;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['forms', orgId] });
    },
  });
}

/** Update a form */
export function useUpdateForm(formId: string) {
  const qc = useQueryClient();
  const { data: session } = useUser();
  const orgId = session?.activeOrganization?.id;
  return useMutation({
    mutationFn: async (dto: Partial<Form>) => {
      const res = await fetchApi(`/organizations/${orgId}/forms/${formId}`, {
        method: 'PUT',
        body: JSON.stringify(dto),
      });
      return res.data?.form ?? res.data ?? res;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['forms', orgId] });
      qc.invalidateQueries({ queryKey: ['form', orgId, formId] });
    },
  });
}

/** Delete (soft-delete) a form */
export function useDeleteForm() {
  const qc = useQueryClient();
  const { data: session } = useUser();
  const orgId = session?.activeOrganization?.id;
  return useMutation({
    mutationFn: async (formId: string) => {
      await fetchApi(`/organizations/${orgId}/forms/${formId}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['forms', orgId] });
    },
  });
}

/** Clone a form */
export function useCloneForm() {
  const qc = useQueryClient();
  const { data: session } = useUser();
  const orgId = session?.activeOrganization?.id;
  return useMutation({
    mutationFn: async (formId: string) => {
      const res = await fetchApi(`/organizations/${orgId}/forms/${formId}/clone`, {
        method: 'POST',
      });
      return res.data?.form ?? res.data ?? res;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['forms', orgId] });
    },
  });
}

/** Restore a trashed form */
export function useRestoreForm() {
  const qc = useQueryClient();
  const { data: session } = useUser();
  const orgId = session?.activeOrganization?.id;
  return useMutation({
    mutationFn: async (formId: string) => {
      const res = await fetchApi(`/organizations/${orgId}/forms/${formId}/restore`, {
        method: 'POST',
      });
      return res.data?.form ?? res.data ?? res;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['forms', orgId] });
      qc.invalidateQueries({ queryKey: ['forms-trash', orgId] });
    },
  });
}

/** Create form from template */
export function useCreateFromTemplate() {
  const qc = useQueryClient();
  const { data: session } = useUser();
  const orgId = session?.activeOrganization?.id;
  return useMutation({
    mutationFn: async (templateId: string) => {
      const res = await fetchApi(`/organizations/${orgId}/forms/from-template/${templateId}`, {
        method: 'POST',
      });
      return res.data?.form ?? res.data ?? res;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['forms', orgId] });
    },
  });
}
