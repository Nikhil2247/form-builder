import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { fetchApi, unwrap } from '@/lib/api';

export interface AuditLog {
  id: string;
  action: string;
  resource: string;
  resourceId: string | null;
  metadata: unknown;
  createdAt: string;
  ipAddress?: string | null;
  organization?: { id: string; name: string } | null;
  user?: {
    id: string;
    email: string;
    firstName?: string | null;
    lastName?: string | null;
  } | null;
}

export interface AuditLogResponse {
  logs: AuditLog[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

interface AuditQuery {
  page?: number;
  limit?: number;
  action?: string;
  orgId?: string;
}

function normalise(raw: any, page: number, limit: number): AuditLogResponse {
  const logs = raw?.logs ?? (Array.isArray(raw) ? raw : []);
  return {
    logs: Array.isArray(logs) ? logs : [],
    pagination: raw?.pagination ?? { page, limit, total: logs.length ?? 0, totalPages: 1 },
  };
}

/** Platform-wide audit log. SUPER_ADMIN only — the API enforces it. */
export function useGlobalAudit({ page = 1, limit = 50, action, orgId }: AuditQuery = {}) {
  return useQuery<AuditLogResponse>({
    queryKey: ['audit', 'global', page, limit, action, orgId],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (action) params.set('action', action);
      if (orgId) params.set('orgId', orgId);
      return normalise(unwrap(await fetchApi(`/admin/audit-logs?${params}`)), page, limit);
    },
    placeholderData: keepPreviousData,
  });
}

/** Audit log scoped to one organization. */
export function useOrgAudit(
  orgId: string | undefined,
  { page = 1, limit = 50, action }: AuditQuery = {},
) {
  return useQuery<AuditLogResponse>({
    queryKey: ['audit', 'org', orgId, page, limit, action],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (action) params.set('action', action);
      return normalise(
        unwrap(await fetchApi(`/organizations/${orgId}/audit-logs?${params}`)),
        page,
        limit,
      );
    },
    enabled: !!orgId,
    placeholderData: keepPreviousData,
  });
}
