import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { fetchApi, setAccessToken, clearSession, unwrap } from '@/lib/api';
import { useSessionBootstrap } from '@/providers/auth-provider';
import {
  resolvePermissions,
  atLeastOrgRole,
  type OrgRole,
  type Permission,
} from '@/config/roles';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  systemRole: string;
  mfaEnabled?: boolean;
  emailVerified?: boolean;
  avatarUrl?: string | null;
}

export interface ActiveOrganization {
  id: string;
  name: string;
  slug: string;
  role: string;
  status?: string;
}

export interface UserSession {
  user: User;
  activeOrganization: ActiveOrganization | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Session
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The current session.
 *
 * Gated on the bootstrap in AuthProvider: until the refresh cookie has been
 * exchanged for an access token there is nothing to authenticate with, and
 * firing /auth/me early would return a spurious null and flash the signed-out
 * UI on every page load.
 */
export function useUser() {
  const { ready } = useSessionBootstrap();

  return useQuery<UserSession | null>({
    queryKey: ['user'],
    queryFn: async () => {
      try {
        const raw = unwrap<any>(await fetchApi('/auth/me'));
        // getMe returns the user object directly, not wrapped under `user`.
        const u = raw?.user ?? raw;
        if (!u?.id) return null;

        return {
          user: {
            id: u.id,
            email: u.email,
            firstName: u.firstName,
            lastName: u.lastName,
            systemRole: u.systemRole,
            mfaEnabled: u.mfaEnabled ?? false,
            emailVerified: u.emailVerified ?? false,
            avatarUrl: u.avatarUrl ?? null,
          },
          activeOrganization: u.organization ?? null,
        } satisfies UserSession;
      } catch {
        return null;
      }
    },
    enabled: ready,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    retry: false,
  });
}

/** Convenience: the active organization id, or undefined. */
export function useOrgId(): string | undefined {
  const { data } = useUser();
  return data?.activeOrganization?.id;
}

/**
 * Role and capability checks for the current session.
 *
 * Components should branch on `can('form:create')`, not on role strings —
 * see config/roles.ts for why the two role axes are kept separate.
 */
export function usePermissions() {
  const { data: session, isLoading } = useUser();
  const { ready } = useSessionBootstrap();

  const systemRole = session?.user?.systemRole;
  const orgRole = session?.activeOrganization?.role;

  return useMemo(() => {
    const granted = resolvePermissions(systemRole, orgRole);
    return {
      isLoading: isLoading || !ready,
      isAuthenticated: !!session?.user,
      systemRole,
      orgRole: (orgRole as OrgRole | undefined) ?? undefined,
      isSuperAdmin: systemRole === 'SUPER_ADMIN',
      /** True when the user holds the named capability. */
      can: (permission: Permission) => granted.has(permission),
      /** True when the user holds every named capability. */
      canAll: (...permissions: Permission[]) => permissions.every((p) => granted.has(p)),
      /** True when the user holds at least one of the named capabilities. */
      canAny: (...permissions: Permission[]) => permissions.some((p) => granted.has(p)),
      /** Org-ladder comparison, for the rare place a rank genuinely matters. */
      atLeast: (minimum: OrgRole) => atLeastOrgRole(orgRole, minimum),
      permissions: granted,
    };
  }, [systemRole, orgRole, session?.user, isLoading, ready]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Sign in / out
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every mutation below stores the access token via setAccessToken (memory
 * only). The previous versions wrote it to localStorage at four separate call
 * sites, which is what made a single XSS equal a full account takeover.
 */

export interface LoginPayload {
  email: string;
  password: string;
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (credentials: LoginPayload) => {
      const data = unwrap<any>(
        await fetchApi('/auth/login', {
          method: 'POST',
          body: JSON.stringify(credentials),
        }),
      );

      // MFA challenge — no access token is issued yet.
      if (data.mfaRequired) return data as { mfaRequired: true; mfaToken: string };

      setAccessToken(data.accessToken);
      return data;
    },
    onSuccess: (data) => {
      if (!data.mfaRequired) {
        queryClient.invalidateQueries({ queryKey: ['user'] });
      }
    },
  });
}

export function useLoginMfa() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { mfaToken: string; code: string }) => {
      const data = unwrap<any>(
        await fetchApi('/auth/login/mfa', {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
      );
      setAccessToken(data.accessToken);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user'] });
    },
  });
}

export function useRegister() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (credentials: {
      email: string;
      password: string;
      firstName: string;
      lastName: string;
      organizationName?: string;
    }) => {
      const data = unwrap<any>(
        await fetchApi('/auth/register', {
          method: 'POST',
          body: JSON.stringify(credentials),
        }),
      );
      setAccessToken(data.accessToken);
      return data.user;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user'] });
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      // Best-effort: even if the API call fails we must still drop local state,
      // otherwise a network blip leaves the user apparently signed in.
      try {
        await fetchApi('/auth/logout', { method: 'POST' });
      } finally {
        clearSession();
      }
    },
    onSettled: () => {
      // Clear *everything*, not just the user key — leaving forms, submissions
      // and member lists in the cache means the next person to sign in on this
      // browser briefly sees the previous tenant's data.
      queryClient.clear();
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Password reset
// ─────────────────────────────────────────────────────────────────────────────

export function useForgotPassword() {
  return useMutation({
    mutationFn: (email: string) =>
      fetchApi('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      }),
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: (payload: { token: string; newPassword: string }) =>
      fetchApi('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (payload: { currentPassword: string; newPassword: string }) =>
      fetchApi('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MFA
// ─────────────────────────────────────────────────────────────────────────────

export function useSetupMfa() {
  return useMutation({
    mutationFn: async () =>
      unwrap<{ secret: string; qrCodeUrl: string; otpauthUrl?: string }>(
        await fetchApi('/auth/mfa/setup', { method: 'POST' }),
      ),
  });
}

export function useVerifyMfa() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (code: string) =>
      unwrap<{ recoveryCodes?: string[] }>(
        await fetchApi('/auth/mfa/verify', {
          method: 'POST',
          body: JSON.stringify({ code }),
        }),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user'] });
    },
  });
}

/**
 * Disabling MFA requires the account password.
 *
 * The API added this check so that a stolen session cannot quietly remove the
 * second factor; the previous hook sent an empty body and every call 400'd.
 */
export function useDisableMfa() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { currentPassword: string }) =>
      fetchApi('/auth/mfa/disable', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user'] });
    },
  });
}

export function useRegenerateRecoveryCodes() {
  return useMutation({
    mutationFn: async (payload: { currentPassword: string }) =>
      unwrap<{ recoveryCodes: string[] }>(
        await fetchApi('/auth/mfa/recovery-codes', {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
      ),
  });
}
