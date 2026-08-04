import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchApi } from '@/lib/api';

export function useAdminDashboard() {
  return useQuery({
    queryKey: ['admin', 'dashboard'],
    queryFn: () => fetchApi('/admin/dashboard').then(res => res.data ?? res),
  });
}

export function useAdminOrganizations(page = 1, limit = 20, search = '') {
  return useQuery({
    queryKey: ['admin', 'organizations', { page, limit, search }],
    queryFn: () => {
      const params = new URLSearchParams();
      if (page) params.append('page', page.toString());
      if (limit) params.append('limit', limit.toString());
      if (search) params.append('search', search);
      return fetchApi(`/admin/organizations?${params.toString()}`).then(res => res.data ?? res);
    },
  });
}

export function useAdminUsers(page = 1, limit = 20, search = '') {
  return useQuery({
    queryKey: ['admin', 'users', { page, limit, search }],
    queryFn: () => {
      const params = new URLSearchParams();
      if (page) params.append('page', page.toString());
      if (limit) params.append('limit', limit.toString());
      if (search) params.append('search', search);
      return fetchApi(`/admin/users?${params.toString()}`).then(res => res.data ?? res);
    },
  });
}

export function useAdminAuditLogs(page = 1, limit = 50, orgId = '') {
  return useQuery({
    queryKey: ['admin', 'audit-logs', { page, limit, orgId }],
    queryFn: () => {
      const params = new URLSearchParams();
      if (page) params.append('page', page.toString());
      if (limit) params.append('limit', limit.toString());
      if (orgId) params.append('orgId', orgId);
      return fetchApi(`/admin/audit-logs?${params.toString()}`).then(res => res.data ?? res);
    },
  });
}

export function useSuspendOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ orgId, reason }: { orgId: string; reason: string }) => 
      fetchApi(`/admin/organizations/${orgId}/suspend`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'organizations'] });
    },
  });
}

export function useActivateOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (orgId: string) => 
      fetchApi(`/admin/organizations/${orgId}/activate`, {
        method: 'POST',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'organizations'] });
    },
  });
}
