import { useQuery } from '@tanstack/react-query';
import { fetchApi } from '@/lib/api';

export interface AuditLog {
  id: string;
  action: string;
  resource: string;
  resourceId: string;
  metadata: any;
  createdAt: string;
  organization?: {
    id: string;
    name: string;
  };
}

export interface AuditLogResponse {
  logs: AuditLog[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export function useGlobalAudit(page = 1, limit = 50) {
  return useQuery<AuditLogResponse>({
    queryKey: ['global-audit-logs', page, limit],
    queryFn: async () => {
      const res = await fetchApi(`/admin/audit-logs?page=${page}&limit=${limit}`);
      return res.data ?? res;
    }
  });
}

export function useOrgAudit(orgId?: string, page = 1, limit = 50) {
  return useQuery<AuditLogResponse>({
    queryKey: ['org-audit-logs', orgId, page, limit],
    queryFn: async () => {
      if (!orgId) throw new Error('Org ID is required');
      const res = await fetchApi(`/organizations/${orgId}/audit-logs?page=${page}&limit=${limit}`);
      return res.data ?? res;
    },
    enabled: !!orgId,
  });
}
