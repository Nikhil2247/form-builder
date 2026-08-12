'use client';

import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchApi, unwrap } from '@/lib/api';
import { useUser } from './use-auth';

/**
 * Feature flags.
 *
 * Resolved server-side per organization and delivered with the session, so
 * there is no extra request and no flash of a menu that then disappears.
 *
 * GATING ONLY, NEVER AUTHORIZATION. A flag decides what is rendered; the API
 * decides what is permitted. Flipping one in devtools reveals menus, not data.
 */

export const FEATURES = {
  /** Subject records, linked forms, and the data-entry app surface. */
  FORM_APPS: 'FORM_APPS',
  /** Calculated fields and advanced rules in the form builder. */
  FORM_RULES: 'FORM_RULES',
} as const;

export type FeatureKey = (typeof FEATURES)[keyof typeof FEATURES];

export function useFeatures() {
  const { data: session, isLoading } = useUser();
  const flags = session?.features;

  return useMemo(
    () => ({
      // Unknown keys read false: a feature the server has never heard of is off,
      // which is the safe direction for a brand-new client against an older API.
      isEnabled: (key: FeatureKey) => flags?.[key] === true,
      flags: flags ?? {},
      isLoading,
    }),
    [flags, isLoading],
  );
}

/** Convenience for the common single-flag check. */
export function useFeature(key: FeatureKey): boolean {
  return useFeatures().isEnabled(key);
}

// ── Super-admin administration ──────────────────────────────────────────────

export interface FeatureFlagAdmin {
  key: string;
  name: string;
  description: string | null;
  isEnabledGlobally: boolean;
  overrides: Array<{ organizationId: string; organizationName: string; isEnabled: boolean }>;
}

export function useFeatureFlagsAdmin() {
  return useQuery<FeatureFlagAdmin[]>({
    queryKey: ['admin', 'features'],
    queryFn: async () => unwrap<FeatureFlagAdmin[]>(await fetchApi('/admin/features')),
    staleTime: 30_000,
  });
}

export function useSetGlobalFeature() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: { errorFallback: 'Could not change this feature' },
    mutationFn: async ({ key, isEnabledGlobally }: { key: string; isEnabledGlobally: boolean }) =>
      unwrap(
        await fetchApi(`/admin/features/${key}`, {
          method: 'PATCH',
          body: JSON.stringify({ isEnabledGlobally }),
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'features'] });
      // The admin's own session carries resolved flags too.
      await queryClient.invalidateQueries({ queryKey: ['user'] });
    },
  });
}

export function useSetOrganizationFeature() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: { errorFallback: 'Could not change this feature for the organization' },
    mutationFn: async ({
      key,
      orgId,
      isEnabled,
    }: {
      key: string;
      orgId: string;
      /** null clears the override, returning the org to the global default. */
      isEnabled: boolean | null;
    }) =>
      unwrap(
        await fetchApi(`/admin/features/${key}/organizations/${orgId}`, {
          method: 'PATCH',
          body: JSON.stringify({ isEnabled }),
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'features'] });
      await queryClient.invalidateQueries({ queryKey: ['user'] });
    },
  });
}
