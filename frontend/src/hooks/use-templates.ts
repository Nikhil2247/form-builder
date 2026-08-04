import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchApi } from '@/lib/api';
import { useUser } from './use-auth';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
export interface Template {
  id: string;
  title: string;
  description?: string;
  category?: string;
  thumbnail?: string;
  isPublic: boolean;
  usageCount?: number;
  createdAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hooks
// ─────────────────────────────────────────────────────────────────────────────

/** List all available templates */
export function useTemplates() {
  return useQuery<Template[]>({
    queryKey: ['templates'],
    queryFn: async () => {
      const res = await fetchApi('/templates');
      return res.data?.templates ?? res.data ?? res;
    },
  });
}

/** Create a form from a template */
export function useCreateFromTemplate() {
  const qc = useQueryClient();
  const { data: session } = useUser();
  const orgId = session?.activeOrganization?.id;
  return useMutation({
    mutationFn: async (templateId: string) => {
      const res = await fetchApi(`/organizations/${orgId}/forms/from-template/${templateId}`, {
        method: 'POST',
      });
      return res.data ?? res;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['forms', orgId] });
    },
  });
}
