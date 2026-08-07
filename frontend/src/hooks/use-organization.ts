import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchApi } from '@/lib/api';

export function useOrganizationDetail(orgId?: string) {
  return useQuery({
    queryKey: ['organizations', orgId],
    queryFn: () => fetchApi(`/organizations/${orgId}`).then(res => res.data ?? res),
    enabled: !!orgId,
  });
}

export function useUpdateOrganization(orgId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => 
      fetchApi(`/organizations/${orgId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations', orgId] });
      queryClient.invalidateQueries({ queryKey: ['user'] }); // In case org name changed
    },
  });
}

export function useOrganizationMembers(orgId?: string, page = 1, limit = 20) {
  return useQuery({
    queryKey: ['organizations', orgId, 'members', page, limit],
    queryFn: () => {
      const params = new URLSearchParams();
      params.append('page', String(page));
      params.append('limit', String(limit));
      return fetchApi(`/organizations/${orgId}/members?${params.toString()}`).then(res => res.data ?? res);
    },
    enabled: !!orgId,
  });
}

export function useOrganizationInvites(orgId?: string, page = 1, limit = 20) {
  return useQuery({
    queryKey: ['organizations', orgId, 'invites', page, limit],
    queryFn: () => {
      const params = new URLSearchParams();
      params.append('page', String(page));
      params.append('limit', String(limit));
      return fetchApi(`/organizations/${orgId}/invitations?${params.toString()}`).then(res => res.data ?? res);
    },
    enabled: !!orgId,
  });
}

export function useInviteMember(orgId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { email: string; role: string }) => 
      fetchApi(`/organizations/${orgId}/invitations`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations', orgId, 'invites'] });
    },
  });
}

export function useRevokeInvite(orgId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (inviteId: string) => 
      fetchApi(`/organizations/${orgId}/invitations/${inviteId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations', orgId, 'invites'] });
    },
  });
}

export function useUpdateMemberRole(orgId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) => 
      fetchApi(`/organizations/${orgId}/members/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations', orgId, 'members'] });
    },
  });
}

export function useRemoveMember(orgId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => 
      fetchApi(`/organizations/${orgId}/members/${userId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations', orgId, 'members'] });
    },
  });
}
