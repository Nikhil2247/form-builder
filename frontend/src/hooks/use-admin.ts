import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { DEFAULT_PAGE_SIZE } from './use-pagination';
import { fetchApi, unwrap } from '@/lib/api';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface AdminOrganization {
  id: string;
  name: string;
  slug: string;
  isActive?: boolean;
  suspendedAt?: string | null;
  /** Schema column is `suspendReason` (no -ed). */
  suspendReason?: string | null;
  createdAt: string;
  storageUsedBytes?: string | number;
  storageQuotaBytes?: string | number;
  _count?: { members?: number; forms?: number };
  /** Derived client-side — the API exposes isActive + suspendedAt, not a status. */
  status: 'ACTIVE' | 'SUSPENDED' | 'INACTIVE';
}

export interface AdminUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  systemRole: string;
  isActive?: boolean;
  emailVerified?: boolean;
  mfaEnabled?: boolean;
  createdAt: string;
  organization?: { id: string; name: string; role?: string } | null;
  memberships?: Array<{ organization: { id: string; name: string }; role: string }>;
}

export interface AdminPage<T> {
  items: T[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

/**
 * The admin endpoints have historically returned three different envelopes.
 * Each page reimplemented the unwrapping with a different `??` chain — the
 * organizations page's chain ended by treating a non-array response as `[]`,
 * so an envelope change would have shown "no organizations" rather than an
 * error. Normalising here means one place to fix if the API settles.
 */
function toPage<T>(raw: any, key: string, page: number, limit: number): AdminPage<T> {
  const source = raw?.[key] ?? raw?.data?.[key] ?? (Array.isArray(raw) ? raw : []);
  const items: T[] = Array.isArray(source) ? source : [];
  const pagination = raw?.pagination ??
    raw?.data?.pagination ?? { page, limit, total: items.length, totalPages: 1 };
  return { items, pagination };
}

function deriveOrgStatus(org: any): AdminOrganization['status'] {
  if (org?.suspendedAt) return 'SUSPENDED';
  if (org?.isActive === false) return 'INACTIVE';
  return 'ACTIVE';
}

// ─────────────────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────────────────

export function useAdminDashboard() {
  return useQuery({
    queryKey: ['admin', 'dashboard'],
    queryFn: async () => unwrap<any>(await fetchApi('/admin/dashboard')),
    staleTime: 60_000,
  });
}

export function useAdminOrganizations({
  page = 1,
  limit = DEFAULT_PAGE_SIZE,
  search = '',
}: { page?: number; limit?: number; search?: string } = {}) {
  return useQuery<AdminPage<AdminOrganization>>({
    queryKey: ['admin', 'organizations', page, limit, search],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (search) params.set('search', search);

      const raw = unwrap<any>(await fetchApi(`/admin/organizations?${params}`));
      const result = toPage<any>(raw, 'organizations', page, limit);

      return {
        ...result,
        items: result.items.filter(Boolean).map((org) => ({
          ...org,
          status: deriveOrgStatus(org),
        })) as AdminOrganization[],
      };
    },
    placeholderData: keepPreviousData,
  });
}

export function useAdminUsers({
  page = 1,
  limit = DEFAULT_PAGE_SIZE,
  search = '',
}: { page?: number; limit?: number; search?: string } = {}) {
  return useQuery<AdminPage<AdminUser>>({
    queryKey: ['admin', 'users', page, limit, search],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (search) params.set('search', search);
      const raw = unwrap<any>(await fetchApi(`/admin/users?${params}`));
      return toPage<AdminUser>(raw, 'users', page, limit);
    },
    placeholderData: keepPreviousData,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────────────────────────────────

export function useSuspendOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orgId, reason }: { orgId: string; reason: string }) =>
      fetchApi(`/admin/organizations/${orgId}/suspend`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'organizations'] });
      qc.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
    },
  });
}

export function useActivateOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orgId: string) =>
      fetchApi(`/admin/organizations/${orgId}/activate`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'organizations'] });
      qc.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
    },
  });
}
