import { useQuery } from '@tanstack/react-query';
import { fetchApi, unwrap } from '@/lib/api';
import { useOrgId } from './use-auth';

/**
 * Organization analytics.
 *
 * These replace the dashboard's previous approach of deriving totals from
 * whichever page of the forms list was loaded — with a page size of 5, an
 * organization with 200 forms reported "5 forms" and summed five forms' worth
 * of responses as the organization total.
 */

export interface OrgSummary {
  forms: { total: number; published: number; draft: number; closed: number; archived: number };
  submissions: {
    total: number;
    window: number;
    previousWindow: number;
    changePercent: number | null;
  };
  engagement: {
    views: number;
    starts: number;
    completionRate: number | null;
    avgCompletionMs: number | null;
  };
  /** BigInt columns arrive as strings — parse before arithmetic. */
  storage: { usedBytes: string; quotaBytes: string | null };
  windowDays: number;
}

export interface DailyPoint {
  date: string;
  submissions: number;
  views: number;
  starts: number;
}

export interface TopForm {
  id: string;
  title: string;
  slug: string;
  status: string;
  submissions: number;
  views: number;
}

export function useOrgSummary(days = 30) {
  const orgId = useOrgId();
  return useQuery<OrgSummary>({
    queryKey: ['analytics', 'summary', orgId, days],
    queryFn: async () =>
      unwrap(await fetchApi(`/organizations/${orgId}/analytics/summary?days=${days}`)),
    enabled: !!orgId,
    // Counters are flushed from Redis every 30s; refetching faster than that
    // returns the same numbers.
    staleTime: 60_000,
  });
}

export function useOrgTimeseries(days = 30) {
  const orgId = useOrgId();
  return useQuery<DailyPoint[]>({
    queryKey: ['analytics', 'global', orgId, days],
    queryFn: async () => {
      const rows = unwrap<any[]>(
        await fetchApi(`/organizations/${orgId}/analytics/global?days=${days}`),
      );
      return Array.isArray(rows) ? rows : [];
    },
    enabled: !!orgId,
    staleTime: 60_000,
  });
}

export function useTopForms(limit = 5) {
  const orgId = useOrgId();
  return useQuery<TopForm[]>({
    queryKey: ['analytics', 'top-forms', orgId, limit],
    queryFn: async () => {
      const rows = unwrap<any[]>(
        await fetchApi(`/organizations/${orgId}/analytics/top-forms?limit=${limit}`),
      );
      return Array.isArray(rows) ? rows : [];
    },
    enabled: !!orgId,
    staleTime: 60_000,
  });
}

/** Daily rows for one form. */
export function useFormTimeseries(formId: string | undefined, days = 30) {
  const orgId = useOrgId();
  return useQuery<any[]>({
    queryKey: ['analytics', 'form', orgId, formId, days],
    queryFn: async () => {
      const rows = unwrap<any[]>(
        await fetchApi(`/organizations/${orgId}/analytics/forms/${formId}?days=${days}`),
      );
      return Array.isArray(rows) ? rows : [];
    },
    enabled: !!orgId && !!formId,
    staleTime: 60_000,
  });
}
