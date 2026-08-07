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

export interface TemplatesResponse {
  templates: Template[];
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

/** List all available templates */
export function useTemplates(page = 1, limit = 20, category?: string) {
  return useQuery<TemplatesResponse>({
    queryKey: ['templates', page, limit, category],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.append('page', String(page));
      params.append('limit', String(limit));
      if (category) params.append('category', category);

      const res = await fetchApi(`/templates?${params.toString()}`);
      return res.data ?? res;
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
