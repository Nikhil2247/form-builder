import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { DEFAULT_PAGE_SIZE } from './use-pagination';
import { fetchApi, unwrap } from '@/lib/api';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Role inside one organization. */
export type OrgRole = 'ADMIN' | 'EDITOR' | 'VIEWER';
/** Platform-wide role. Deliberately separate from OrgRole — see the backend's
 *  AdminUsersService: a super admin is not implicitly an org admin. */
export type SystemRole = 'USER' | 'SUPER_ADMIN';

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
  /** Soft delete. Non-null means the account is suspended and cannot sign in. */
  deletedAt?: string | null;
  organization?: { id: string; name: string; role?: string } | null;
  memberships?: Array<{ organization: { id: string; name: string }; role: string }>;
}

export interface AdminPage<T> {
  items: T[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

type Envelope = Record<string, unknown>;

/**
 * The admin endpoints have historically returned three different envelopes.
 * Each page reimplemented the unwrapping with a different `??` chain — the
 * organizations page's chain ended by treating a non-array response as `[]`,
 * so an envelope change would have shown "no organizations" rather than an
 * error. Normalising here means one place to fix if the API settles.
 */
function toPage<T>(raw: unknown, key: string, page: number, limit: number): AdminPage<T> {
  const envelope = (raw ?? {}) as Envelope;
  const inner = (envelope.data ?? {}) as Envelope;

  const source = envelope[key] ?? inner[key] ?? (Array.isArray(raw) ? raw : []);
  const items = (Array.isArray(source) ? source : []) as T[];

  const pagination =
    (envelope.pagination as AdminPage<T>['pagination'] | undefined) ??
    (inner.pagination as AdminPage<T>['pagination'] | undefined) ??
    { page, limit, total: items.length, totalPages: 1 };

  return { items, pagination };
}

function deriveOrgStatus(org: {
  suspendedAt?: string | null;
  isActive?: boolean;
}): AdminOrganization['status'] {
  if (org?.suspendedAt) return 'SUSPENDED';
  if (org?.isActive === false) return 'INACTIVE';
  return 'ACTIVE';
}

// ─────────────────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The dashboard payload has been returned both flat and nested under `stats`,
 * so the shape stays open rather than pretending to a precision it does not
 * have. Callers read through a helper that checks both.
 */
export interface AdminDashboard {
  stats?: Record<string, unknown>;
  [key: string]: unknown;
}

export function useAdminDashboard() {
  return useQuery<AdminDashboard>({
    queryKey: ['admin', 'dashboard'],
    queryFn: async () => unwrap<AdminDashboard>(await fetchApi('/admin/dashboard')),
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

      const raw = unwrap<unknown>(await fetchApi(`/admin/organizations?${params}`));
      const result = toPage<AdminOrganization>(raw, 'organizations', page, limit);

      return {
        ...result,
        items: result.items.filter(Boolean).map((org) => ({
          ...org,
          status: deriveOrgStatus(org),
        })),
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
      const raw = unwrap<unknown>(await fetchApi(`/admin/users?${params}`));
      return toPage<AdminUser>(raw, 'users', page, limit);
    },
    placeholderData: keepPreviousData,
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorFallback: 'Could not create this user' },
    mutationFn: (data: {
      email: string;
      firstName: string;
      lastName: string;
      systemRole?: SystemRole;
    }) =>
      fetchApi('/admin/users', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      qc.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// System health — GET /admin/system
// ─────────────────────────────────────────────────────────────────────────────

export type ProbeStatus = 'up' | 'degraded' | 'down';

export interface DependencyProbe {
  name: string;
  status: ProbeStatus;
  /** Round-trip in milliseconds; null when the probe never completed. */
  latencyMs: number | null;
  detail?: string;
  error?: string;
}

export interface SystemHealth {
  status: ProbeStatus;
  checkedAt: string;
  dependencies: DependencyProbe[];
}

export interface SystemProcess {
  nodeVersion: string;
  platform: string;
  pid: number;
  processRole: string;
  environment: string;
  uptimeSeconds: number;
  memory: {
    heapUsedMb: number;
    heapTotalMb: number;
    rssMb: number;
    externalMb: number;
  };
}

export interface QueueStat {
  name: string;
  reachable: boolean;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: boolean;
}

export interface DatabaseTableStat {
  name: string;
  estimatedRows: number;
  size: string;
}

export interface DatabaseStats {
  reachable: boolean;
  size: string;
  sizeBytes: number;
  connections: { total: number; active: number; idle: number };
  tables: DatabaseTableStat[];
}

export interface RedisStats {
  reachable: boolean;
  version: string;
  usedMemory: string;
  peakMemory: string;
  connectedClients: number;
  uptimeSeconds: number;
  opsPerSecond: number;
  /** Null on a cold instance — "no lookups yet" is not "every lookup missed". */
  hitRate: number | null;
}

export interface SystemOverview {
  health: SystemHealth;
  process: SystemProcess;
  queues: QueueStat[];
  database: DatabaseStats;
  redis: RedisStats;
}

/**
 * Everything the system page needs, in one request.
 *
 * Polled rather than cached: the value of this page is that it is current, and
 * a stale "all systems up" is worse than no answer at all. `staleTime: 0` so a
 * remount refetches, and errors are not retried into a storm.
 */
export function useSystemOverview({ refetchInterval = 15_000 }: { refetchInterval?: number } = {}) {
  return useQuery<SystemOverview>({
    queryKey: ['admin', 'system'],
    queryFn: async () => unwrap<SystemOverview>(await fetchApi('/admin/system')),
    refetchInterval,
    refetchIntervalInBackground: false,
    staleTime: 0,
    retry: 1,
  });
}

/** The cheap probe-only endpoint, for a tighter poll than the full overview. */
export function useSystemHealth({ refetchInterval = 15_000 }: { refetchInterval?: number } = {}) {
  return useQuery<SystemHealth>({
    queryKey: ['admin', 'system', 'health'],
    queryFn: async () => unwrap<SystemHealth>(await fetchApi('/admin/system/health')),
    refetchInterval,
    staleTime: 0,
    retry: 1,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// User detail — GET /admin/users/:userId
// ─────────────────────────────────────────────────────────────────────────────

export interface AdminUserMembership {
  id: string;
  role: OrgRole;
  joinedAt: string;
  organization: {
    id: string;
    name: string;
    slug: string;
    isActive: boolean;
    suspendedAt: string | null;
  };
}

export interface AdminUserDetail {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string | null;
  systemRole: SystemRole;
  emailVerified: boolean;
  mfaEnabled: boolean;
  /** Soft delete. Non-null means the account is suspended and cannot sign in. */
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastActiveOrganizationId?: string | null;
  memberships: AdminUserMembership[];
  security: {
    mfaEnabled: boolean;
    recoveryCodesRemaining: number;
    activeSessions: number;
    emailVerified: boolean;
  };
  activity: { formsCreated: number };
}

export function useAdminUser(userId: string) {
  return useQuery<AdminUserDetail>({
    queryKey: ['admin', 'user', userId],
    queryFn: async () => unwrap<AdminUserDetail>(await fetchApi(`/admin/users/${userId}`)),
    enabled: Boolean(userId),
  });
}

/**
 * Every user mutation invalidates the same two things: this user's detail and
 * the platform user list. Centralised so a new action cannot forget one and
 * leave the page showing the state it just changed.
 */
function useInvalidateUser() {
  const qc = useQueryClient();
  return (userId: string) => {
    qc.invalidateQueries({ queryKey: ['admin', 'user', userId] });
    qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    qc.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
  };
}

export function useSetSystemRole() {
  const invalidate = useInvalidateUser();
  return useMutation({
    meta: { errorFallback: 'Could not change this system role' },
    mutationFn: ({ userId, systemRole }: { userId: string; systemRole: SystemRole }) =>
      fetchApi(`/admin/users/${userId}/system-role`, {
        method: 'PATCH',
        body: JSON.stringify({ systemRole }),
      }),
    onSuccess: (_data, variables) => invalidate(variables.userId),
  });
}

export function useSetUserOrgRole() {
  const qc = useQueryClient();
  const invalidate = useInvalidateUser();
  return useMutation({
    meta: { errorFallback: 'Could not change this workspace role' },
    mutationFn: ({
      userId,
      orgId,
      role,
    }: {
      userId: string;
      orgId: string;
      role: OrgRole;
    }) =>
      fetchApi(`/admin/users/${userId}/organizations/${orgId}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      }),
    onSuccess: (_data, variables) => {
      invalidate(variables.userId);
      qc.invalidateQueries({ queryKey: ['admin', 'organization', variables.orgId] });
    },
  });
}

export interface RevokeSessionsResult {
  sessionsRevoked: number;
  message: string;
}

export function useRevokeUserSessions() {
  const invalidate = useInvalidateUser();
  return useMutation({
    meta: { errorFallback: 'Could not revoke this user’s sessions' },
    mutationFn: async (userId: string) =>
      unwrap<RevokeSessionsResult>(
        await fetchApi(`/admin/users/${userId}/revoke-sessions`, { method: 'POST' }),
      ),
    onSuccess: (_data, userId) => invalidate(userId),
  });
}

export function useSetUserSuspended() {
  const invalidate = useInvalidateUser();
  return useMutation({
    meta: { errorFallback: 'Could not change this user’s status' },
    mutationFn: ({ userId, suspended }: { userId: string; suspended: boolean }) =>
      fetchApi(`/admin/users/${userId}/suspended`, {
        method: 'PATCH',
        body: JSON.stringify({ suspended }),
      }),
    onSuccess: (_data, variables) => invalidate(variables.userId),
  });
}

export function useResetUserMfa() {
  const invalidate = useInvalidateUser();
  return useMutation({
    meta: { errorFallback: 'Could not reset two-factor for this user' },
    mutationFn: async (userId: string) =>
      unwrap<{ message: string }>(
        await fetchApi(`/admin/users/${userId}/reset-mfa`, { method: 'POST' }),
      ),
    onSuccess: (_data, userId) => invalidate(userId),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Organization detail — GET /admin/organizations/:orgId
// ─────────────────────────────────────────────────────────────────────────────

export interface AdminOrgMember {
  id: string;
  role: OrgRole;
  joinedAt: string;
  organizationId?: string;
  userId?: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    systemRole: SystemRole;
  };
}

/** Only present if the API is extended to include them; rendered defensively. */
export interface AdminOrgForm {
  id: string;
  title?: string;
  name?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  _count?: { submissions?: number };
}

export interface AdminOrganizationDetail extends AdminOrganization {
  logoUrl?: string | null;
  maxForms: number;
  maxSubmissionsMonth: number;
  maxMembers: number;
  storageQuotaBytes: string | number;
  storageUsedBytes: string | number;
  updatedAt: string;
  deletedAt?: string | null;
  members: AdminOrgMember[];
  forms?: AdminOrgForm[];
  _count?: { members?: number; forms?: number; invitations?: number };
}

export function useAdminOrganization(orgId: string) {
  return useQuery<AdminOrganizationDetail>({
    queryKey: ['admin', 'organization', orgId],
    queryFn: async () => {
      const org = unwrap<AdminOrganizationDetail>(
        await fetchApi(`/admin/organizations/${orgId}`),
      );
      return { ...org, status: deriveOrgStatus(org) };
    },
    enabled: Boolean(orgId),
  });
}

export interface OrgQuotaUpdate {
  maxForms?: number;
  maxSubmissionsMonth?: number;
  maxMembers?: number;
  /** BigInt column — the API takes it as a decimal string, not a number. */
  storageQuotaBytes?: string;
}

export function useUpdateOrgQuotas() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorFallback: 'Could not save these quotas' },
    mutationFn: ({ orgId, quotas }: { orgId: string; quotas: OrgQuotaUpdate }) =>
      fetchApi(`/admin/organizations/${orgId}/quotas`, {
        method: 'PATCH',
        body: JSON.stringify(quotas),
      }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['admin', 'organization', variables.orgId] });
      qc.invalidateQueries({ queryKey: ['admin', 'organizations'] });
    },
  });
}

/**
 * Add an existing user to an organization, effective immediately — the
 * platform-admin route to a membership, distinct from the emailed invitation
 * an org's own admin sends (which waits on the recipient to accept).
 */
export function useAddOrgMember() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorFallback: 'Could not add this member' },
    mutationFn: async ({
      orgId,
      email,
      role,
    }: {
      orgId: string;
      email: string;
      role: OrgRole;
    }) =>
      unwrap<AdminOrgMember>(
        await fetchApi(`/admin/organizations/${orgId}/members`, {
          method: 'POST',
          body: JSON.stringify({ email, role }),
        }),
      ),
    onSuccess: (data, variables) => {
      qc.invalidateQueries({ queryKey: ['admin', 'organization', variables.orgId] });
      qc.invalidateQueries({ queryKey: ['admin', 'organizations'] });
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      if (data?.user?.id) {
        qc.invalidateQueries({ queryKey: ['admin', 'user', data.user.id] });
      }
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────────────────────────────────

export function useSuspendOrganization() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorFallback: 'Could not suspend this organization' },
    mutationFn: ({ orgId, reason }: { orgId: string; reason: string }) =>
      fetchApi(`/admin/organizations/${orgId}/suspend`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['admin', 'organizations'] });
      qc.invalidateQueries({ queryKey: ['admin', 'organization', variables.orgId] });
      qc.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
    },
  });
}

export function useActivateOrganization() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorFallback: 'Could not reactivate this organization' },
    mutationFn: (orgId: string) =>
      fetchApi(`/admin/organizations/${orgId}/activate`, { method: 'POST' }),
    onSuccess: (_data, orgId) => {
      qc.invalidateQueries({ queryKey: ['admin', 'organizations'] });
      qc.invalidateQueries({ queryKey: ['admin', 'organization', orgId] });
      qc.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
    },
  });
}

export function useCreateOrganization() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorFallback: 'Could not create this organization' },
    mutationFn: (data: { name: string; slug?: string }) =>
      fetchApi('/admin/organizations', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'organizations'] });
      qc.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
    },
  });
}

export interface OrgProfileUpdate {
  name?: string;
  slug?: string;
  logoUrl?: string;
}

export function useUpdateOrganization() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorFallback: 'Could not save this organization' },
    mutationFn: ({ orgId, data }: { orgId: string; data: OrgProfileUpdate }) =>
      fetchApi(`/admin/organizations/${orgId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['admin', 'organizations'] });
      qc.invalidateQueries({ queryKey: ['admin', 'organization', variables.orgId] });
    },
  });
}

export function useDeleteOrganization() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorFallback: 'Could not delete this organization' },
    mutationFn: (orgId: string) =>
      fetchApi(`/admin/organizations/${orgId}`, { method: 'DELETE' }),
    onSuccess: (_data, orgId) => {
      qc.invalidateQueries({ queryKey: ['admin', 'organizations'] });
      qc.invalidateQueries({ queryKey: ['admin', 'organization', orgId] });
      qc.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
    },
  });
}
