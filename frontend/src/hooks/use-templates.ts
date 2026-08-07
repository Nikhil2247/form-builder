import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { DEFAULT_PAGE_SIZE } from './use-pagination';
import { fetchApi, unwrap } from '@/lib/api';
import { useOrgId } from './use-auth';

export interface Template {
  id: string;
  /** The API (FormTemplate model) exposes this as `name`, not `title`. */
  name: string;
  description?: string;
  category?: string;
  thumbnail?: string;
  usageCount?: number;
  createdAt: string;
}

export interface TemplatesResponse {
  templates: Template[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export function useTemplates({
  page = 1,
  limit = DEFAULT_PAGE_SIZE,
  category,
  search,
}: { page?: number; limit?: number; category?: string; search?: string } = {}) {
  return useQuery<TemplatesResponse>({
    queryKey: ['templates', page, limit, category, search],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (category && category !== 'ALL') params.set('category', category);
      if (search) params.set('search', search);

      const data = unwrap<any>(await fetchApi(`/templates?${params}`));
      return {
        templates: data?.templates ?? [],
        pagination: data?.pagination ?? { page, limit, total: 0, totalPages: 1 },
      };
    },
    // The template catalogue changes rarely; an hour avoids refetching it on
    // every visit to the templates or dashboard page.
    staleTime: 60 * 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useTemplateCategories() {
  return useQuery<string[]>({
    queryKey: ['templates', 'categories'],
    queryFn: async () => {
      const data = unwrap<any>(await fetchApi('/templates/categories'));
      return Array.isArray(data) ? data : [];
    },
    staleTime: 60 * 60_000,
  });
}

export function useCreateFromTemplate() {
  const qc = useQueryClient();
  const orgId = useOrgId();

  return useMutation({
    mutationFn: async (templateId: string) => {
      const data = unwrap<any>(
        await fetchApi(`/organizations/${orgId}/forms/from-template/${templateId}`, {
          method: 'POST',
        }),
      );
      return data?.form ?? data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['forms', orgId] });
      // Usage counts move, so the catalogue ordering is now stale.
      qc.invalidateQueries({ queryKey: ['templates'] });
    },
  });
}
