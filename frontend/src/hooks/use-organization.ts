import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { DEFAULT_PAGE_SIZE } from './use-pagination';
import { fetchApi, unwrap } from '@/lib/api';
import { useOrgId } from './use-auth';
import type { OrgRole } from '@/config/roles';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface OrgMember {
  /** Membership id — this is what the members endpoints are keyed by. */
  id: string;
  userId: string;
  role: OrgRole;
  /** The join row timestamp is `joinedAt`, not `createdAt`. */
  joinedAt: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
  };
}

export interface OrgInvitation {
  id: string;
  email: string;
  role: OrgRole;
  status: 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';
  createdAt: string;
  expiresAt?: string | null;
  invitedBy?: { firstName: string; lastName: string; email: string } | null;
}

export interface PaginatedResult<T> {
  items: T[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

/**
 * The organizations endpoints are inconsistent: some return a bare array, some
 * `{ members }`, some `{ invitations }`, some `{ data: { ... } }`. Every page
 * re-derived that with a chain of `??` fallbacks, and each chain was subtly
 * different — the team page's invitation chain ended in `invitesData`, so on
 * one shape it rendered the pagination object as a list row.
 *
 * Normalise once, here.
 */
function toPaginated<T>(raw: any, key: string, page: number, limit: number): PaginatedResult<T> {
  const items: T[] = Array.isArray(raw) ? raw : (raw?.[key] ?? raw?.items ?? []);
  return {
    items: Array.isArray(items) ? items : [],
    pagination: raw?.pagination ?? {
      page,
      limit,
      total: Array.isArray(items) ? items.length : 0,
      totalPages: 1,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mirrors `organizationDetailSelect`.
 *
 * Typed deliberately rather than left as `any`: while it was `any`, the
 * settings and billing pages read `org.plan` and `org.website`, neither of
 * which is a column on Organization. Both rendered `undefined` behind a `??`
 * fallback, so the billing page reported every organization as being on the
 * "Free" plan and the settings page offered a Website field that saved nothing.
 */
export interface OrganizationDetail {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  isActive: boolean;
  maxForms: number;
  maxSubmissionsMonth: number;
  maxMembers: number;
  /** BigInt columns are serialised as numbers by the API's BigInt patch. */
  storageQuotaBytes: number;
  storageUsedBytes: number;
  createdAt: string;
  updatedAt: string;
  _count?: { members: number; forms: number };
}

export function useOrganizationDetail(orgId?: string) {
  const activeOrgId = useOrgId();
  const id = orgId ?? activeOrgId;

  return useQuery<OrganizationDetail>({
    queryKey: ['organization', id],
    queryFn: async () => unwrap<OrganizationDetail>(await fetchApi(`/organizations/${id}`)),
    enabled: !!id,
  });
}

export function useOrganizationMembers({
  page = 1,
  limit = DEFAULT_PAGE_SIZE,
  orgId,
}: { page?: number; limit?: number; orgId?: string } = {}) {
  const activeOrgId = useOrgId();
  const id = orgId ?? activeOrgId;

  return useQuery<PaginatedResult<OrgMember>>({
    queryKey: ['organization', id, 'members', page, limit],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      const raw = unwrap<any>(await fetchApi(`/organizations/${id}/members?${params}`));
      return toPaginated<OrgMember>(raw, 'members', page, limit);
    },
    enabled: !!id,
    placeholderData: keepPreviousData,
  });
}

export function useOrganizationInvites({
  page = 1,
  limit = DEFAULT_PAGE_SIZE,
  orgId,
}: { page?: number; limit?: number; orgId?: string } = {}) {
  const activeOrgId = useOrgId();
  const id = orgId ?? activeOrgId;

  return useQuery<PaginatedResult<OrgInvitation>>({
    queryKey: ['organization', id, 'invitations', page, limit],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      const raw = unwrap<any>(await fetchApi(`/organizations/${id}/invitations?${params}`));
      return toPaginated<OrgInvitation>(raw, 'invitations', page, limit);
    },
    enabled: !!id,
    placeholderData: keepPreviousData,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────────────────────────────────

export function useUpdateOrganization(orgId?: string) {
  const qc = useQueryClient();
  const activeOrgId = useOrgId();
  const id = orgId ?? activeOrgId;

  return useMutation({
    meta: { errorFallback: 'Could not save these changes' },
    mutationFn: (data: Record<string, unknown>) =>
      fetchApi(`/organizations/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['organization', id] });
      // The session carries the org name and plan; a rename must refresh it.
      qc.invalidateQueries({ queryKey: ['user'] });
    },
  });
}

export function useInviteMember(orgId?: string) {
  const qc = useQueryClient();
  const activeOrgId = useOrgId();
  const id = orgId ?? activeOrgId;

  return useMutation({
    meta: { errorFallback: 'Could not send this invitation' },
    mutationFn: (data: { email: string; role: OrgRole }) =>
      fetchApi(`/organizations/${id}/invitations`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['organization', id, 'invitations'] }),
  });
}

export function useRevokeInvite(orgId?: string) {
  const qc = useQueryClient();
  const activeOrgId = useOrgId();
  const id = orgId ?? activeOrgId;

  return useMutation({
    meta: { errorFallback: 'Could not revoke this invitation' },
    mutationFn: (invitationId: string) =>
      fetchApi(`/organizations/${id}/invitations/${invitationId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['organization', id, 'invitations'] }),
  });
}

/** `memberId` is the membership row id, not the user id — the route is keyed by it. */
export function useUpdateMemberRole(orgId?: string) {
  const qc = useQueryClient();
  const activeOrgId = useOrgId();
  const id = orgId ?? activeOrgId;

  return useMutation({
    meta: { errorFallback: 'Could not change this role' },
    mutationFn: ({ memberId, role }: { memberId: string; role: OrgRole }) =>
      fetchApi(`/organizations/${id}/members/${memberId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['organization', id, 'members'] }),
  });
}

export function useRemoveMember(orgId?: string) {
  const qc = useQueryClient();
  const activeOrgId = useOrgId();
  const id = orgId ?? activeOrgId;

  return useMutation({
    meta: { errorFallback: 'Could not remove this member' },
    mutationFn: (memberId: string) =>
      fetchApi(`/organizations/${id}/members/${memberId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['organization', id, 'members'] }),
  });
}
