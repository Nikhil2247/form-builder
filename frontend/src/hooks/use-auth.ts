import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchApi } from '@/lib/api';

// Adjust this type based on your actual user model
export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  systemRole: string;
}

export interface UserSession {
  user: User;
  activeOrganization: {
    id: string;
    name: string;
    slug: string;
    role: string;
  } | null;
}

export function useUser() {
  return useQuery<UserSession | null>({
    queryKey: ['user'],
    queryFn: async () => {
      if (typeof window !== 'undefined') {
        const token = localStorage.getItem('access_token');
        if (!token || token === 'undefined' || token === 'null' || token === '""') {
          return null;
        }
      }
      try {
        const json = await fetchApi('/auth/me');
        // Backend getMe returns the user object directly (not wrapped under a 'user' key)
        const rawUser = json.data?.user ?? json.data;
        if (!rawUser || !rawUser.id) return null;
        return {
          user: {
            id: rawUser.id,
            email: rawUser.email,
            firstName: rawUser.firstName,
            lastName: rawUser.lastName,
            systemRole: rawUser.systemRole,
          },
          activeOrganization: rawUser.organization ?? null,
        } as UserSession;
      } catch (err) {
        return null;
      }
    },
    staleTime: 30 * 60 * 1000, // 30 minutes — session doesn't change often
    gcTime: 60 * 60 * 1000,    // Keep in memory 60 minutes
    retry: false, // Don't keep retrying if /me fails (e.g. 401)
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (credentials: any) => {
      const response = await fetchApi('/auth/login', {
        method: 'POST',
        body: JSON.stringify(credentials),
      });
      
      const data = response.data || response;

      if (data.mfaRequired) {
        return data; // { mfaRequired: true, mfaToken: string }
      }

      // Save access token
      if (typeof window !== 'undefined') {
        localStorage.setItem('access_token', data.accessToken);
      }
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
      const response = await fetchApi('/auth/login/mfa', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      
      const data = response.data ?? response;
      if (typeof window !== 'undefined') {
        localStorage.setItem('access_token', data.accessToken);
      }
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
    mutationFn: async (credentials: any) => {
      const response = await fetchApi('/auth/register', {
        method: 'POST',
        body: JSON.stringify(credentials),
      });
      const data = response.data ?? response;
      if (typeof window !== 'undefined') {
        localStorage.setItem('access_token', data.accessToken);
      }
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
      await fetchApi('/auth/logout', { method: 'POST' });
      if (typeof window !== 'undefined') {
        localStorage.removeItem('access_token');
      }
    },
    onSuccess: () => {
      // Clear the user from cache immediately
      queryClient.setQueryData(['user'], null);
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
    },
  });
}

// ════════════════════════════════════════════════════════════════════════════
// PASSWORD RESET
// ════════════════════════════════════════════════════════════════════════════

export function useForgotPassword() {
  return useMutation({
    mutationFn: async (email: string) => {
      return fetchApi('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
    }
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: async (payload: { token: string; newPassword: string }) => {
      return fetchApi('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    }
  });
}

// ════════════════════════════════════════════════════════════════════════════
// MFA
// ════════════════════════════════════════════════════════════════════════════

export function useSetupMfa() {
  return useMutation({
    mutationFn: async () => {
      const res = await fetchApi('/auth/mfa/setup', {
        method: 'POST',
      });
      return res.data ?? res;
    }
  });
}

export function useVerifyMfa() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (code: string) => {
      const res = await fetchApi('/auth/mfa/verify', {
        method: 'POST',
        body: JSON.stringify({ code }),
      });
      return res.data ?? res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user'] });
    }
  });
}

export function useDisableMfa() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      return fetchApi('/auth/mfa/disable', {
        method: 'POST',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user'] });
    }
  });
}
