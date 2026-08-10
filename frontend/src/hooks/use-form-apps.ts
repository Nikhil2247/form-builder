import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchApi, unwrap } from '@/lib/api';
import { useOrgId } from './use-auth';
import type { SubjectType, SubjectTypeRef } from './use-subjects';
import type { FormTheme } from '@/types/form';

/**
 * Form Apps — a data-entry surface over one subject type.
 *
 * An app is configuration, not code: an ordered list of STEPS plus a set of
 * declarative dashboard cards. A step binds one published form to a position in
 * the programme and says how many times it is filled; the respondent works
 * through them in order and submits once.
 *
 * `config.formIds` used to carry that list and no longer exists — the steps
 * migration backfilled it into real rows and dropped the key, because a bare id
 * list could not express "fill this up to twenty times, unique by school name".
 * `steps` on the detail response is the source of truth for what an app opens.
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

/** Filled once, or filled as many times as the respondent has records for. */
export type StepMode = 'SINGLE' | 'REPEATABLE';

export interface FormAppStep {
  id: string;
  appId: string;
  formId: string;
  /** Stable address used by conditions and by the session API. Server-assigned. */
  key: string;
  order: number;
  title: string;
  description: string | null;
  icon: string | null;
  mode: StepMode;
  minEntries: number;
  maxEntries: number | null;
  isOptional: boolean;
  /** Question keys that must not repeat across entries of this step. */
  uniqueBy: string[];
  showWhen?: unknown;
  form: AppForm & { status?: string; deletedAt?: string | null };
  /** False when the step's form was unpublished or deleted out from under it. */
  isUsable: boolean;
}

export interface FormAppPeriod {
  id: string;
  appId: string;
  label: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
}

/** The four keys `normalizeBranding` keeps; anything else is dropped on save. */
export interface AppBranding {
  headerTitle?: string;
  footerText?: string;
  logoUrl?: string;
  coverImageUrl?: string;
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

/** `GET /apps/:appId` carries the full subject type, steps, periods and settings. */
export interface FormAppDetail extends Omit<FormApp, 'subjectType'> {
  subjectType: SubjectType;
  forms: AppForm[];
  steps: FormAppStep[];
  periods: FormAppPeriod[];
  /** Null until an author deliberately publishes a link. */
  publicSlug: string | null;
  themeConfig: FormTheme | null;
  branding: AppBranding | null;
  requireAuth: boolean;
  allowDrafts: boolean;
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
      return {
        ...data,
        forms: Array.isArray(data.forms) ? data.forms : [],
        steps: Array.isArray(data.steps) ? data.steps : [],
        periods: Array.isArray(data.periods) ? data.periods : [],
      };
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

// ─────────────────────────────────────────────────────────────────────────────
// Steps, periods and settings
//
// These are separate endpoints rather than fields on the app PATCH, and the
// hooks mirror that one-for-one. A step is a row with its own identity — its
// key is referenced by other steps' conditions and by every session entry ever
// staged against it — so it cannot be expressed as "replace this array", which
// is what a config-blob save would do.
// ─────────────────────────────────────────────────────────────────────────────

/** Every step/period/settings write restates the same app; refetch it once. */
function useAppConfigMutation<TVars, TResult>(
  run: (orgId: string, vars: TVars & { appId: string }) => Promise<TResult>,
) {
  const qc = useQueryClient();
  const orgId = useOrgId();

  return useMutation({
    mutationFn: async (vars: TVars & { appId: string }) => {
      if (!orgId) throw new Error('No active organization');
      return run(orgId, vars);
    },
    onSuccess: (_result, vars) => {
      qc.invalidateQueries({ queryKey: ['form-app', orgId, vars.appId] });
      qc.invalidateQueries({ queryKey: ['form-apps', orgId] });
    },
  });
}

export interface StepShapeDto {
  title?: string;
  description?: string | null;
  icon?: string | null;
  mode?: StepMode;
  minEntries?: number;
  maxEntries?: number | null;
  isOptional?: boolean;
  uniqueBy?: string[];
  showWhen?: unknown;
}

export function useCreateAppStep() {
  return useAppConfigMutation<StepShapeDto & { formId: string; key?: string }, FormAppStep>(
    (orgId, { appId, ...dto }) =>
      fetchApi(`/organizations/${orgId}/apps/${appId}/steps`, {
        method: 'POST',
        body: JSON.stringify(dto),
      }).then((r) => unwrap<FormAppStep>(r)),
  );
}

export function useUpdateAppStep() {
  return useAppConfigMutation<StepShapeDto & { stepId: string }, FormAppStep>(
    (orgId, { appId, stepId, ...dto }) =>
      fetchApi(`/organizations/${orgId}/apps/${appId}/steps/${stepId}`, {
        method: 'PATCH',
        body: JSON.stringify(dto),
      }).then((r) => unwrap<FormAppStep>(r)),
  );
}

export function useDeleteAppStep() {
  return useAppConfigMutation<{ stepId: string }, void>((orgId, { appId, stepId }) =>
    fetchApi(`/organizations/${orgId}/apps/${appId}/steps/${stepId}`, { method: 'DELETE' }).then(
      () => undefined,
    ),
  );
}

/** The server requires every step id exactly once — a partial list is rejected. */
export function useReorderAppSteps() {
  return useAppConfigMutation<{ stepIds: string[] }, void>((orgId, { appId, stepIds }) =>
    fetchApi(`/organizations/${orgId}/apps/${appId}/steps/reorder`, {
      method: 'POST',
      body: JSON.stringify({ stepIds }),
    }).then(() => undefined),
  );
}

export interface PeriodDto {
  label?: string;
  startsAt?: string;
  endsAt?: string;
  isActive?: boolean;
}

export function useCreateAppPeriod() {
  return useAppConfigMutation<
    { label: string; startsAt: string; endsAt: string; isActive?: boolean },
    FormAppPeriod
  >((orgId, { appId, ...dto }) =>
    fetchApi(`/organizations/${orgId}/apps/${appId}/periods`, {
      method: 'POST',
      body: JSON.stringify(dto),
    }).then((r) => unwrap<FormAppPeriod>(r)),
  );
}

export function useUpdateAppPeriod() {
  return useAppConfigMutation<PeriodDto & { periodId: string }, FormAppPeriod>(
    (orgId, { appId, periodId, ...dto }) =>
      fetchApi(`/organizations/${orgId}/apps/${appId}/periods/${periodId}`, {
        method: 'PATCH',
        body: JSON.stringify(dto),
      }).then((r) => unwrap<FormAppPeriod>(r)),
  );
}

export function useDeleteAppPeriod() {
  return useAppConfigMutation<{ periodId: string }, void>((orgId, { appId, periodId }) =>
    fetchApi(`/organizations/${orgId}/apps/${appId}/periods/${periodId}`, {
      method: 'DELETE',
    }).then(() => undefined),
  );
}

export interface AppSettingsDto {
  themeConfig?: FormTheme;
  branding?: AppBranding;
  /** `null` retires the public link without touching anything else. */
  publicSlug?: string | null;
  requireAuth?: boolean;
  allowDrafts?: boolean;
  isPublished?: boolean;
}

export function useUpdateAppSettings() {
  return useAppConfigMutation<AppSettingsDto, FormApp>((orgId, { appId, ...dto }) =>
    fetchApi(`/organizations/${orgId}/apps/${appId}/settings`, {
      method: 'PATCH',
      body: JSON.stringify(dto),
    }).then((r) => unwrap<FormApp>(r)),
  );
}
