import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchApi, unwrap } from '@/lib/api';
import { useOrgId } from './use-auth';
import type { SubjectType, SubjectTypeRef } from './use-subjects';

/**
 * Form Apps — a data-entry surface over one subject type.
 *
 * An app is configuration, not code: an ordered list of form ids plus a set of
 * declarative dashboard cards. The server resolves the ids on read, so a form
 * deleted after the app was configured simply disappears from the app rather
 * than 404ing when someone taps it — which is why `forms` on the detail
 * response is the source of truth for what an app can actually open, not
 * `config.formIds`.
 *
 * Conventions follow use-forms.ts / use-organization.ts.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type CardSource = 'subjects' | 'submissions';

export interface DashboardCardFilter {
  /** Records created in the last N days. Clamped server-side to 1…3650. */
  createdWithinDays?: number;
  /** Submissions of one specific form. Only valid for the 'submissions' source. */
  formId?: string;
}

export interface DashboardCardConfig {
  title: string;
  source: CardSource;
  filter?: DashboardCardFilter;
}

export interface FormAppConfig {
  /** Forms available in the app, in display order. */
  formIds: string[];
  dashboardCards: DashboardCardConfig[];
}

/** How a form relates to the record it is filled against. */
export type SubjectRole = 'REGISTERS' | 'ATTACHES' | 'NONE';

/** A form as resolved onto an app. */
export interface AppForm {
  id: string;
  title: string;
  slug: string;
  subjectRole: SubjectRole;
  subjectTypeId: string | null;
}

export interface FormApp {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  isPublished: boolean;
  subjectTypeId: string;
  config?: Partial<FormAppConfig> | null;
  subjectType: SubjectTypeRef;
}

/** `GET /apps/:appId` carries the full subject type and the resolved forms. */
export interface FormAppDetail extends Omit<FormApp, 'subjectType'> {
  subjectType: SubjectType;
  forms: AppForm[];
}

export interface DashboardCardResult {
  title: string;
  value: number;
}

export interface AppDashboard {
  cards: DashboardCardResult[];
}

/** Normalised config, so callers never have to `?? []` two levels deep. */
export function toAppConfig(config: Partial<FormAppConfig> | null | undefined): FormAppConfig {
  return {
    formIds: Array.isArray(config?.formIds) ? config.formIds : [],
    dashboardCards: Array.isArray(config?.dashboardCards) ? config.dashboardCards : [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────────────────

export function useFormApps(options: { enabled?: boolean } = {}) {
  const orgId = useOrgId();

  return useQuery<FormApp[]>({
    queryKey: ['form-apps', orgId],
    queryFn: async () => {
      const data = unwrap<FormApp[] | { apps?: FormApp[] }>(
        await fetchApi(`/organizations/${orgId}/apps`),
      );
      return Array.isArray(data) ? data : (data?.apps ?? []);
    },
    enabled: !!orgId && options.enabled !== false,
  });
}

export function useFormApp(appId: string | undefined, options: { enabled?: boolean } = {}) {
  const orgId = useOrgId();

  return useQuery<FormAppDetail>({
    queryKey: ['form-app', orgId, appId],
    queryFn: async () => {
      const data = unwrap<FormAppDetail>(await fetchApi(`/organizations/${orgId}/apps/${appId}`));
      return { ...data, forms: Array.isArray(data.forms) ? data.forms : [] };
    },
    enabled: !!orgId && !!appId && options.enabled !== false,
  });
}

/**
 * Card counts for an app.
 *
 * Each card is a bounded count computed server-side from a closed filter shape,
 * so this is cheap — but it is still N counts per request, which is why it is
 * cached rather than refetched on every focus.
 */
export function useFormAppDashboard(
  appId: string | undefined,
  options: { enabled?: boolean } = {},
) {
  const orgId = useOrgId();

  return useQuery<AppDashboard>({
    queryKey: ['form-app-dashboard', orgId, appId],
    queryFn: async () => {
      const data = unwrap<AppDashboard>(
        await fetchApi(`/organizations/${orgId}/apps/${appId}/dashboard`),
      );
      return { cards: Array.isArray(data?.cards) ? data.cards : [] };
    },
    enabled: !!orgId && !!appId && options.enabled !== false,
    staleTime: 30_000,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateFormAppDto {
  name: string;
  slug?: string;
  subjectTypeId: string;
  description?: string;
  icon?: string;
  config?: FormAppConfig;
}

export interface UpdateFormAppDto {
  name?: string;
  description?: string;
  icon?: string;
  config?: FormAppConfig;
  isPublished?: boolean;
}

export function useCreateFormApp() {
  const qc = useQueryClient();
  const orgId = useOrgId();

  return useMutation({
    mutationFn: async (dto: CreateFormAppDto) => {
      if (!orgId) throw new Error('No active organization');
      return unwrap<FormApp>(
        await fetchApi(`/organizations/${orgId}/apps`, {
          method: 'POST',
          body: JSON.stringify(dto),
        }),
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['form-apps', orgId] });
    },
  });
}

export function useUpdateFormApp() {
  const qc = useQueryClient();
  const orgId = useOrgId();

  return useMutation({
    mutationFn: async ({ appId, ...dto }: UpdateFormAppDto & { appId: string }) => {
      if (!orgId) throw new Error('No active organization');
      return unwrap<FormApp>(
        await fetchApi(`/organizations/${orgId}/apps/${appId}`, {
          method: 'PATCH',
          body: JSON.stringify(dto),
        }),
      );
    },
    onSuccess: (_result, variables) => {
      qc.invalidateQueries({ queryKey: ['form-apps', orgId] });
      qc.invalidateQueries({ queryKey: ['form-app', orgId, variables.appId] });
      // The cards are derived from config; a config change restates them.
      qc.invalidateQueries({ queryKey: ['form-app-dashboard', orgId, variables.appId] });
    },
  });
}

export function useDeleteFormApp() {
  const qc = useQueryClient();
  const orgId = useOrgId();

  return useMutation({
    mutationFn: async (appId: string) => {
      if (!orgId) throw new Error('No active organization');
      await fetchApi(`/organizations/${orgId}/apps/${appId}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['form-apps', orgId] });
    },
  });
}
