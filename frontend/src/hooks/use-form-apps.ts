import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchApi, unwrap } from '@/lib/api';
import { useOrgId } from './use-auth';
import type { SubjectType, SubjectTypeRef } from './use-subjects';
import type { FormTheme } from '@/types/form';
import type { AppLayoutMode } from '@/components/apps/AppRunner';

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
  /** How each step's fields are arranged. See AppRunner. */
  layoutMode?: AppLayoutMode;
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
  /**
   * Null until an author deliberately publishes a link.
   *
   * Declared here rather than only on the detail type because the list endpoint
   * returns it too — it selects the whole row — so the list card can offer the
   * public link without a second fetch.
   */
  publicSlug: string | null;
}

/** `GET /apps/:appId` carries the full subject type, steps, periods and settings. */
export interface FormAppDetail extends Omit<FormApp, 'subjectType'> {
  subjectType: SubjectType;
  forms: AppForm[];
  steps: FormAppStep[];
  periods: FormAppPeriod[];
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
    meta: { errorFallback: 'Could not create this app' },
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
    meta: { errorFallback: 'Could not save this app' },
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
    meta: { errorFallback: 'Could not delete this app' },
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

/** The subset of a detail the apps list renders, so the two never disagree. */
function listFieldsOf(detail: FormAppDetail): Partial<FormApp> {
  return {
    name: detail.name,
    description: detail.description,
    icon: detail.icon,
    isPublished: detail.isPublished,
    publicSlug: detail.publicSlug,
    config: detail.config,
  };
}

/**
 * A write against one app's configuration.
 *
 * ── Why these are optimistic ───────────────────────────────────────────────
 * Every control in the settings panel is bound to server state — a switch reads
 * `checked={app.requireAuth}`. Without an optimistic write, clicking one starts
 * a PATCH, waits for it, invalidates, and only moves once a SECOND request has
 * refetched the whole app detail: its subject type, forms, steps and periods.
 * Two sequential round trips, the heavier one last, and the switch sits under
 * the cursor in its old position for the duration. On anything but a local
 * database that reads as a frozen dialog.
 *
 * So the cache is patched synchronously on click and the server reconciles
 * afterwards. The control moves immediately because the state it renders from
 * has already changed.
 *
 * `optimistic` is deliberately not defaulted: a create cannot be applied ahead
 * of the server, because the row it returns has an id nothing else can invent.
 */
function useAppConfigMutation<TVars, TResult>(
  run: (orgId: string, vars: TVars & { appId: string }) => Promise<TResult>,
  errorFallback: string,
  optimistic?: (app: FormAppDetail, vars: TVars & { appId: string }) => FormAppDetail,
) {
  const qc = useQueryClient();
  const orgId = useOrgId();

  return useMutation({
    // Named so the reconciliation below can count only its own siblings.
    mutationKey: ['form-app-config'],
    meta: { errorFallback },
    mutationFn: async (vars: TVars & { appId: string }) => {
      if (!orgId) throw new Error('No active organization');
      return run(orgId, vars);
    },

    onMutate: async (vars) => {
      if (!optimistic) return undefined;

      const detailKey = ['form-app', orgId, vars.appId];
      const listKey = ['form-apps', orgId];

      // A GET already in flight would resolve after this write and restore the
      // value the user just changed, so it is cancelled before the cache is
      // touched. This is the difference between a switch that moves and one
      // that moves, snaps back, then moves again.
      await qc.cancelQueries({ queryKey: detailKey });

      const previousDetail = qc.getQueryData<FormAppDetail>(detailKey);
      const previousList = qc.getQueryData<FormApp[]>(listKey);
      if (!previousDetail) return { previousDetail, previousList };

      const nextDetail = optimistic(previousDetail, vars);
      qc.setQueryData<FormAppDetail>(detailKey, nextDetail);

      // The card behind the dialog carries the Live badge. Left alone it would
      // contradict the switch in front of it until the refetch landed.
      if (previousList) {
        qc.setQueryData<FormApp[]>(
          listKey,
          previousList.map((app) =>
            app.id === vars.appId ? { ...app, ...listFieldsOf(nextDetail) } : app,
          ),
        );
      }

      return { previousDetail, previousList };
    },

    onError: (_error, vars, context) => {
      // Put back exactly what was there. The global handler has already shown
      // the message, so the only job here is to stop the control from claiming
      // a change that did not happen.
      if (!context) return;
      if (context.previousDetail) {
        qc.setQueryData(['form-app', orgId, vars.appId], context.previousDetail);
      }
      if (context.previousList) {
        qc.setQueryData(['form-apps', orgId], context.previousList);
      }
    },

    onSettled: (_result, _error, vars) => {
      // Toggling three switches in a row must not queue three refetches of the
      // full detail — and a refetch landing between two of them would drag the
      // later switches back. Only the last mutation still settling reconciles.
      if (qc.isMutating({ mutationKey: ['form-app-config'] }) > 1) return;
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
    'Could not add that step',
  );
}

export function useUpdateAppStep() {
  return useAppConfigMutation<StepShapeDto & { stepId: string }, FormAppStep>(
    (orgId, { appId, stepId, ...dto }) =>
      fetchApi(`/organizations/${orgId}/apps/${appId}/steps/${stepId}`, {
        method: 'PATCH',
        body: JSON.stringify(dto),
      }).then((r) => unwrap<FormAppStep>(r)),
    'Could not save that change',
    (app, { appId: _appId, stepId, ...dto }) => ({
      ...app,
      steps: app.steps.map((step) => (step.id === stepId ? { ...step, ...dto } : step)),
    }),
  );
}

export function useDeleteAppStep() {
  return useAppConfigMutation<{ stepId: string }, void>(
    (orgId, { appId, stepId }) =>
      fetchApi(`/organizations/${orgId}/apps/${appId}/steps/${stepId}`, { method: 'DELETE' }).then(
        () => undefined,
      ),
    'Could not remove that step',
    (app, { stepId }) => ({
      ...app,
      steps: app.steps.filter((step) => step.id !== stepId),
    }),
  );
}

/** The server requires every step id exactly once — a partial list is rejected. */
export function useReorderAppSteps() {
  return useAppConfigMutation<{ stepIds: string[] }, void>(
    (orgId, { appId, stepIds }) =>
      fetchApi(`/organizations/${orgId}/apps/${appId}/steps/reorder`, {
        method: 'POST',
        body: JSON.stringify({ stepIds }),
      }).then(() => undefined),
    'Could not reorder the steps',
    // Reordering is the one write where waiting is most visible: a dragged row
    // that springs back to its old position before settling looks like the drag
    // failed. `order` is restated to match, since it is what the list sorts on.
    (app, { stepIds }) => {
      const byId = new Map(app.steps.map((step) => [step.id, step]));
      const reordered = stepIds
        .map((id, index) => {
          const step = byId.get(id);
          return step ? { ...step, order: index } : null;
        })
        .filter((step): step is FormAppStep => step !== null);
      // A server that rejects a partial list would reject this too, but the
      // cache must not silently drop a step the caller forgot to name.
      return reordered.length === app.steps.length ? { ...app, steps: reordered } : app;
    },
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
  >(
    (orgId, { appId, ...dto }) =>
      fetchApi(`/organizations/${orgId}/apps/${appId}/periods`, {
        method: 'POST',
        body: JSON.stringify(dto),
      }).then((r) => unwrap<FormAppPeriod>(r)),
    'Could not add that period',
  );
}

export function useUpdateAppPeriod() {
  return useAppConfigMutation<PeriodDto & { periodId: string }, FormAppPeriod>(
    (orgId, { appId, periodId, ...dto }) =>
      fetchApi(`/organizations/${orgId}/apps/${appId}/periods/${periodId}`, {
        method: 'PATCH',
        body: JSON.stringify(dto),
      }).then((r) => unwrap<FormAppPeriod>(r)),
    'Could not save that period',
    (app, { appId: _appId, periodId, ...dto }) => ({
      ...app,
      periods: app.periods.map((period) =>
        period.id === periodId ? { ...period, ...dto } : period,
      ),
    }),
  );
}

export function useDeleteAppPeriod() {
  return useAppConfigMutation<{ periodId: string }, void>(
    (orgId, { appId, periodId }) =>
      fetchApi(`/organizations/${orgId}/apps/${appId}/periods/${periodId}`, {
        method: 'DELETE',
      }).then(() => undefined),
    'Could not remove that period',
    (app, { periodId }) => ({
      ...app,
      periods: app.periods.filter((period) => period.id !== periodId),
    }),
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
  /** How each step's fields are laid out. See AppRunner. */
  layoutMode?: AppLayoutMode;
}

export function useUpdateAppSettings() {
  return useAppConfigMutation<AppSettingsDto, FormApp>(
    (orgId, { appId, ...dto }) =>
      fetchApi(`/organizations/${orgId}/apps/${appId}/settings`, {
        method: 'PATCH',
        body: JSON.stringify(dto),
      }).then((r) => unwrap<FormApp>(r)),
    'Could not save that setting',
    // Field by field rather than a blind spread, because the DTO is a patch:
    // spreading it would write `undefined` over every setting the user did not
    // touch, and blank the panel until the refetch landed.
    (app, dto) => ({
      ...app,
      ...(dto.requireAuth !== undefined && { requireAuth: dto.requireAuth }),
      ...(dto.allowDrafts !== undefined && { allowDrafts: dto.allowDrafts }),
      ...(dto.isPublished !== undefined && { isPublished: dto.isPublished }),
      ...(dto.themeConfig !== undefined && { themeConfig: dto.themeConfig }),
      ...(dto.branding !== undefined && { branding: dto.branding }),
      // The server normalises this (lowercases, and treats blank as "retire the
      // link"); the empty-to-null step is mirrored so the hint under the field
      // does not read "no public address" and then flip back.
      ...(dto.publicSlug !== undefined && {
        publicSlug: dto.publicSlug === '' ? null : dto.publicSlug,
      }),
      // `layoutMode` lives INSIDE config server-side, alongside the dashboard
      // cards. Writing it at the top level would move the highlight in the
      // layout picker not at all, and writing `config: { layoutMode }` would
      // drop the cards from the cache until the refetch restored them.
      ...(dto.layoutMode !== undefined && {
        config: { ...(app.config ?? {}), layoutMode: dto.layoutMode },
      }),
    }),
  );
}
