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

export function useOrganizationMembers(orgId?: string) {
  return useQuery({
    queryKey: ['organizations', orgId, 'members'],
    queryFn: () => fetchApi(`/organizations/${orgId}/members`).then(res => {
      const d = res.data ?? res;
      // Backend returns { members, pagination } - return the members array
      return d?.members ?? d ?? [];
    }),
    enabled: !!orgId,
  });
}

export function useOrganizationInvites(orgId?: string) {
  return useQuery({
    queryKey: ['organizations', orgId, 'invites'],
    queryFn: () => fetchApi(`/organizations/${orgId}/invitations`).then(res => {
      const d = res.data ?? res;
      // Backend returns { invitations, pagination } 
      return d?.invitations ?? d?.invites ?? d ?? [];
    }),
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
