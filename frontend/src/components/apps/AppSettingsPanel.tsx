'use client';

import React from 'react';
import {
  CalendarClock,
  CalendarPlus,
  Copy,
  Image as ImageIcon,
  Link2,
  Palette,
  Save,
  ShieldCheck,
  Trash2,
  Type,
} from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ThemeCustomizer } from '@/components/builder/ThemeCustomizer';
import { PanelBlock, PanelRow, PanelSection } from '@/components/builder/panel-primitives';
import { EmptyState } from '@/components/shared';
import { cn } from '@/lib/utils';
import type { AppLayoutMode } from '@/components/apps/AppRunner';
import {
  APPEARANCE_LABELS,
  APP_DENSITIES,
  APP_MASTHEADS,
  APP_SHELLS_AVAILABLE,
  APP_STEP_STYLES,
  APP_TEXTURES,
  APP_WIDTHS,
  readAppearance,
} from '@/components/apps/appearance';
import type { FormConfig, FormTheme } from '@/types/form';
import {
  useCreateAppPeriod,
  useDeleteAppPeriod,
  useUpdateAppPeriod,
  useUpdateAppSettings,
  type AppBranding,
  type AppSettingsDto,
  type FormAppDetail,
  type FormAppPeriod,
} from '@/hooks/use-form-apps';

/**
 * App settings — the app's answer to the form settings panel.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * An app has its own public link, its own theme and its own access rules,
 * separate from the forms it runs. That separation is the point: a respondent
 * filling a three-step programme sees one masthead and one palette, not the
 * theme of whichever form happens to be step two.
 *
 * The tabs mirror the form panel deliberately — Design, Access, Schedule — so
 * an author who has configured a form already knows where to look.
 *
 * Unlike the form panel, which writes into an autosaving builder store, an app
 * has no such store: every control here PATCHes `/settings` on change. Text
 * fields commit on blur; toggles commit immediately.
 */

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

type SettingsTab = 'design' | 'access' | 'schedule';

/** `datetime-local` needs local `YYYY-MM-DDTHH:mm`, never an ISO-Z string. */
function toLocalInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export function AppSettingsPanel({
  app,
  initialTab = 'design',
}: {
  app: FormAppDetail;
  initialTab?: SettingsTab;
}) {
  const [activeTab, setActiveTab] = React.useState<SettingsTab>(initialTab);
  const [publicOrigin] = React.useState(() =>
    typeof window === 'undefined' ? '' : window.location.origin,
  );

  const save = useUpdateAppSettings();

  const patch = React.useCallback(
    async (dto: AppSettingsDto) => {
      try {
        await save.mutateAsync({ appId: app.id, ...dto });
      } catch {
        // The slug collision message is the useful one and the server writes it
        // for a human; the global handler shows it verbatim.
      }
    },
    [app.id, save],
  );

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => setActiveTab(value as SettingsTab)}
      className="gap-4"
    >
      <TabsList className="w-full">
        <TabsTrigger value="design" className="flex-1 gap-1.5">
          <Palette className="size-3.5" />
          Design
        </TabsTrigger>
        <TabsTrigger value="access" className="flex-1 gap-1.5">
          <ShieldCheck className="size-3.5" />
          Access
        </TabsTrigger>
        <TabsTrigger value="schedule" className="flex-1 gap-1.5">
          <CalendarClock className="size-3.5" />
          Schedule
        </TabsTrigger>
      </TabsList>

      <TabsContent value="design" className="space-y-4">
        <AppearanceSection app={app} onPatch={patch} />
        <LayoutSection app={app} onPatch={patch} />
        <BrandingSection app={app} onPatch={patch} />
        <AppThemeEditor app={app} onPatch={patch} />
      </TabsContent>

      <TabsContent value="access" className="space-y-4">
        <AccessSection app={app} publicOrigin={publicOrigin} onPatch={patch} />
      </TabsContent>

      <TabsContent value="schedule" className="space-y-4">
        <PeriodsSection app={app} />
      </TabsContent>
    </Tabs>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/** A wrapping row of mutually exclusive choices. */
function Segmented<T extends string>({
  value,
  options,
  labels,
  onChange,
  name,
}: {
  value: T;
  options: readonly T[];
  labels: Record<T, string>;
  onChange: (next: T) => void;
  name: string;
}) {
  return (
    <div role="radiogroup" aria-label={name} className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const isActive = option === value;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => !isActive && onChange(option)}
            className={cn(
              'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
              isActive
                ? 'border-primary bg-primary/10 text-foreground'
                : 'border-border text-muted-foreground hover:border-border-strong hover:bg-muted/50',
            )}
          >
            {labels[option]}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Appearance — the shape of the public page, as opposed to its palette.
 *
 * These live inside `themeConfig` rather than in their own columns, so the
 * whole group is written by re-sending the theme with one key changed. That is
 * also why every control here spreads the current theme: the settings endpoint
 * replaces `themeConfig` wholesale, so a patch that sent only the changed key
 * would wipe the colours.
 */
function AppearanceSection({
  app,
  onPatch,
}: {
  app: FormAppDetail;
  onPatch: (dto: AppSettingsDto) => void | Promise<void>;
}) {
  const theme = React.useMemo<FormTheme>(() => (app.themeConfig ?? {}) as FormTheme, [app.themeConfig]);
  const appearance = readAppearance(theme);

  const set = (key: keyof FormTheme, value: string) =>
    onPatch({ themeConfig: { ...theme, [key]: value } });

  // Glass cards are translucent with a heavy blur; a pattern behind them shows
  // through and the text on the card stops being readable. The value is kept
  // rather than reset, so it returns if the author picks solid cards — but
  // saying nothing would leave a control that visibly does nothing.
  const textureSuppressed = theme.cardVariant === 'glass' && appearance.texture !== 'none';

  return (
    <PanelSection
      title="Appearance"
      description="How the public page is laid out. Separate from the palette below, so an app can be recoloured without being rearranged."
    >
      <PanelBlock
        label="How steps are shown"
        hint={
          appearance.shell === 'wizard'
            ? 'One step per page, with Back and Next. Nothing is submitted until the last step, and a rejected answer sends the respondent back to the step holding it.'
            : 'Every step on one page, filled top to bottom.'
        }
      >
        <Segmented
          name="How steps are shown"
          value={appearance.shell}
          options={APP_SHELLS_AVAILABLE}
          labels={APPEARANCE_LABELS.shell}
          onChange={(next) => set('appShell', next)}
        />
      </PanelBlock>

      <PanelBlock
        label="Page width"
        hint="How much of a large screen the app fills. Narrow reads like a document; wider suits several steps and repeatable entries. Phones are unaffected."
      >
        <Segmented
          name="Page width"
          value={appearance.width}
          options={APP_WIDTHS}
          labels={APPEARANCE_LABELS.width}
          onChange={(next) => set('appWidth', next)}
        />
      </PanelBlock>

      <PanelBlock
        label="Header"
        hint={
          appearance.masthead === 'hero' && !app.branding?.coverImageUrl
            ? 'A cover image is needed for this one — until you add one below, the colour wash is shown instead.'
            : 'The first thing a respondent sees, above the fold.'
        }
        hintTone={
          appearance.masthead === 'hero' && !app.branding?.coverImageUrl ? 'warning' : 'muted'
        }
      >
        <Segmented
          name="Header style"
          value={appearance.masthead}
          options={APP_MASTHEADS}
          labels={APPEARANCE_LABELS.masthead}
          onChange={(next) => set('appMasthead', next)}
        />
      </PanelBlock>

      <PanelBlock label="Step headings" hint="How each step is announced as the respondent scrolls.">
        <Segmented
          name="Step headings"
          value={appearance.stepStyle}
          options={APP_STEP_STYLES}
          labels={APPEARANCE_LABELS.stepStyle}
          onChange={(next) => set('appStepStyle', next)}
        />
      </PanelBlock>

      <PanelBlock
        label="Spacing"
        hint="Padding and the gaps between steps. The spacing between individual fields is fixed, so this is a change of pace rather than of scale."
      >
        <Segmented
          name="Spacing"
          value={appearance.density}
          options={APP_DENSITIES}
          labels={APPEARANCE_LABELS.density}
          onChange={(next) => set('appDensity', next)}
        />
      </PanelBlock>

      <PanelBlock
        label="Background"
        hint={
          textureSuppressed
            ? 'Not shown while cards are glass — a pattern behind a translucent card makes the text on it hard to read. Switch to solid cards below and it returns.'
            : 'Drawn from your own colours, so it costs no image and cannot clash.'
        }
        hintTone={textureSuppressed ? 'warning' : 'muted'}
      >
        <Segmented
          name="Background"
          value={appearance.texture}
          options={APP_TEXTURES}
          labels={APPEARANCE_LABELS.texture}
          onChange={(next) => set('appTexture', next)}
        />
      </PanelBlock>
    </PanelSection>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * The theme editor, borrowed whole from the form builder.
 *
 * `ThemeCustomizer` reads `form.theme` and writes it back through a
 * `setState`-shaped prop. An app is not a form, so it is handed a one-field
 * shim: the same component, the same presets, the same fonts and radii, with no
 * second implementation to drift.
 */
function AppThemeEditor({
  app,
  onPatch,
}: {
  app: FormAppDetail;
  onPatch: (dto: AppSettingsDto) => void | Promise<void>;
}) {
  const theme = React.useMemo<FormTheme>(() => app.themeConfig ?? ({} as FormTheme), [app.themeConfig]);

  const setForm = React.useCallback<React.Dispatch<React.SetStateAction<FormConfig>>>(
    (update) => {
      const before = { theme } as unknown as FormConfig;
      const after = typeof update === 'function' ? update(before) : update;
      onPatch({ themeConfig: after.theme ?? {} });
    },
    [theme, onPatch],
  );

  return <ThemeCustomizer form={{ theme } as unknown as FormConfig} setForm={setForm} />;
}

// ─────────────────────────────────────────────────────────────────────────────

function BrandingSection({
  app,
  onPatch,
}: {
  app: FormAppDetail;
  onPatch: (dto: AppSettingsDto) => void | Promise<void>;
}) {
  const branding = React.useMemo<AppBranding>(() => app.branding ?? {}, [app.branding]);

  // One draft object for four fields: branding is stored as a single JSON
  // column, so a per-field PATCH would have to re-send the other three anyway.
  const [draft, setDraft] = React.useState<AppBranding>(branding);
  const [synced, setSynced] = React.useState(branding);
  if (synced !== branding) {
    setSynced(branding);
    setDraft(branding);
  }

  const commit = (next: AppBranding) => {
    setDraft(next);
    onPatch({ branding: next });
  };

  const field = (key: keyof AppBranding) => ({
    value: draft[key] ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setDraft((current) => ({ ...current, [key]: e.target.value })),
    onBlur: () => draft[key] !== branding[key] && commit(draft),
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) =>
      e.key === 'Enter' && e.currentTarget.blur(),
    className: 'h-8 text-xs',
  });

  return (
    <PanelSection
      title="Branding"
      description="What respondents see at the top and bottom of every step. Leave a field blank to fall back to the app's name and the organization's logo."
    >
      <PanelBlock label="Header title" htmlFor="app-header-title">
        <Input id="app-header-title" placeholder={app.name} {...field('headerTitle')} />
      </PanelBlock>

      <PanelBlock
        label="Footer text"
        htmlFor="app-footer-text"
        hint="A department name, a helpline, or the programme this belongs to."
      >
        <Input id="app-footer-text" placeholder="Department of…" {...field('footerText')} />
      </PanelBlock>

      <PanelBlock
        label="Logo URL"
        htmlFor="app-logo-url"
        hint="Must start with http:// or https:// — anything else is dropped on save."
      >
        <div className="flex items-center gap-1.5">
          <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <Input
            id="app-logo-url"
            placeholder="https://…/logo.png"
            {...field('logoUrl')}
            className="h-8 min-w-0 flex-1 text-xs"
          />
        </div>
      </PanelBlock>

      <PanelBlock label="Cover image URL" htmlFor="app-cover-url">
        <div className="flex items-center gap-1.5">
          <Type className="size-3.5 shrink-0 text-muted-foreground" />
          <Input
            id="app-cover-url"
            placeholder="https://…/cover.jpg"
            {...field('coverImageUrl')}
            className="h-8 min-w-0 flex-1 text-xs"
          />
        </div>
      </PanelBlock>
    </PanelSection>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * How each step's fields are arranged.
 *
 * App-wide rather than per-step: a session is one continuous act, and changing
 * column count between step two and step three reads as a rendering fault.
 *
 * Both modes are a single column below the `md` breakpoint, so this is a
 * desktop-only distinction and a phone is unaffected by the choice.
 */
function LayoutSection({
  app,
  onPatch,
}: {
  app: FormAppDetail;
  onPatch: (dto: AppSettingsDto) => void | Promise<void>;
}) {
  const current: AppLayoutMode = app.config?.layoutMode === 'GRID' ? 'GRID' : 'DOCUMENT';

  const OPTIONS: Array<{ value: AppLayoutMode; label: string; hint: string }> = [
    {
      value: 'DOCUMENT',
      label: 'Stacked',
      hint: 'One field per row. Best for long questionnaires and for filling on a phone.',
    },
    {
      value: 'GRID',
      label: 'Two column',
      hint: 'Narrow fields pair up on wide screens. Best for desk-based data entry.',
    },
  ];

  return (
    <PanelSection
      title="Layout"
      description="How the fields of every step are arranged on screen."
    >
      <div className="grid grid-cols-2 gap-2">
        {OPTIONS.map((option) => {
          const isActive = current === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={isActive}
              onClick={() => onPatch({ layoutMode: option.value })}
              className={cn(
                'flex flex-col gap-1.5 rounded-lg border p-2.5 text-left transition-colors',
                isActive
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-border-strong hover:bg-muted/50',
              )}
            >
              {/* A tiny diagram beats the words: "two column" is only
                  meaningful once you can see what it does to the fields. */}
              <span aria-hidden className="flex gap-1">
                {option.value === 'DOCUMENT' ? (
                  <span className="flex w-full flex-col gap-1">
                    <span className="h-1.5 w-full rounded-sm bg-muted-foreground/30" />
                    <span className="h-1.5 w-full rounded-sm bg-muted-foreground/30" />
                    <span className="h-1.5 w-full rounded-sm bg-muted-foreground/30" />
                  </span>
                ) : (
                  <span className="grid w-full grid-cols-2 gap-1">
                    <span className="h-1.5 rounded-sm bg-muted-foreground/30" />
                    <span className="h-1.5 rounded-sm bg-muted-foreground/30" />
                    <span className="h-1.5 rounded-sm bg-muted-foreground/30" />
                    <span className="h-1.5 rounded-sm bg-muted-foreground/30" />
                    <span className="col-span-2 h-1.5 rounded-sm bg-muted-foreground/30" />
                  </span>
                )}
              </span>
              <span className="text-xs font-medium text-foreground">{option.label}</span>
              <span className="text-[11px] leading-snug text-muted-foreground">{option.hint}</span>
            </button>
          );
        })}
      </div>
    </PanelSection>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function AccessSection({
  app,
  publicOrigin,
  onPatch,
}: {
  app: FormAppDetail;
  publicOrigin: string;
  onPatch: (dto: AppSettingsDto) => void | Promise<void>;
}) {
  const [slugDraft, setSlugDraft] = React.useState(app.publicSlug ?? '');
  const [slugError, setSlugError] = React.useState<string | null>(null);

  const [syncedSlug, setSyncedSlug] = React.useState(app.publicSlug ?? '');
  if ((app.publicSlug ?? '') !== syncedSlug) {
    setSyncedSlug(app.publicSlug ?? '');
    setSlugDraft(app.publicSlug ?? '');
    setSlugError(null);
  }

  const commitSlug = () => {
    const value = slugDraft.trim().toLowerCase();
    if (value === (app.publicSlug ?? '')) return;
    // An empty box means "retire the link", which is a null, not a validation
    // failure — the app keeps every session it has already collected.
    if (!value) {
      setSlugError(null);
      onPatch({ publicSlug: null });
      return;
    }
    if (!SLUG_PATTERN.test(value)) {
      setSlugError('Use 3–64 lowercase letters, numbers or hyphens, starting and ending with one.');
      return;
    }
    setSlugError(null);
    onPatch({ publicSlug: value });
  };

  const publicUrl = app.publicSlug ? `${publicOrigin}/a/${app.publicSlug}` : null;

  const copyLink = async () => {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      toast.success('Link copied');
    } catch {
      toast.error('Could not copy — select the address and copy it manually.');
    }
  };

  return (
    <>
      <PanelSection title="Public link">
        <PanelBlock
          label="Link address"
          htmlFor="app-public-slug"
          hint={
            slugError ??
            (!app.isPublished
              ? 'The link is live once the app is set live.'
              : app.publicSlug
                ? 'Where respondents fill this programme in.'
                : 'Blank means the app has no public address at all.')
          }
          hintTone={slugError ? 'destructive' : app.isPublished ? 'muted' : 'warning'}
        >
          <div className="flex items-center gap-1.5">
            <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="shrink-0 truncate text-xs text-muted-foreground">
              {publicOrigin}/a/
            </span>
            <Input
              id="app-public-slug"
              value={slugDraft}
              placeholder="monitoring-2026"
              onChange={(e) => {
                setSlugDraft(e.target.value);
                setSlugError(null);
              }}
              onBlur={commitSlug}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              aria-invalid={!!slugError}
              className="h-8 min-w-0 flex-1 text-xs"
            />
            {publicUrl && (
              <Button variant="ghost" size="icon-sm" aria-label="Copy public link" onClick={copyLink}>
                <Copy className="size-3.5" />
              </Button>
            )}
          </div>
        </PanelBlock>

        <PanelRow
          icon={ShieldCheck}
          title="Live"
          hint="A draft app stays visible to editors but its public link returns nothing."
        >
          <Switch
            checked={app.isPublished}
            aria-label="App is live"
            onCheckedChange={(checked) => onPatch({ isPublished: checked })}
          />
        </PanelRow>
      </PanelSection>

      <PanelSection title="Who can report">
        <PanelRow
          icon={ShieldCheck}
          title="Require sign-in"
          hint="Only signed-in users can open the app, and their identity is recorded against every submission in the report."
        >
          <Switch
            checked={app.requireAuth}
            aria-label="Require sign-in"
            onCheckedChange={(checked) => onPatch({ requireAuth: checked })}
          />
        </PanelRow>

        <PanelRow
          icon={Save}
          title="Allow drafts"
          hint="Answers are staged on the server as they are typed, so a respondent can close the page mid-report and resume. Off means a report must be finished in one sitting."
        >
          <Switch
            checked={app.allowDrafts}
            aria-label="Allow drafts"
            onCheckedChange={(checked) => onPatch({ allowDrafts: checked })}
          />
        </PanelRow>
      </PanelSection>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reporting periods.
 *
 * A period is the window a report belongs to — "May–Nov 2026". With none
 * configured the app is always open; with one or more, the public page refuses
 * outside them and every session is stamped with the period it was filed in,
 * which is what makes "this quarter's reports" a query rather than a date range
 * someone has to remember.
 */
function PeriodsSection({ app }: { app: FormAppDetail }) {
  const createPeriod = useCreateAppPeriod();
  const [isAdding, setAdding] = React.useState(false);

  // Read once per mount, and shared by every row: "open now" is a label on a
  // settings screen, not a countdown, and reading the clock during render would
  // make two rows disagree about the same instant on an unrelated re-render.
  const [now] = React.useState(() => Date.now());

  const addPeriod = async () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 3, 0, 23, 59);

    setAdding(true);
    try {
      await createPeriod.mutateAsync({
        appId: app.id,
        label: `${start.toLocaleDateString(undefined, { month: 'short' })} – ${end.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`,
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        isActive: true,
      });
    } catch {
      // Reported globally.
    } finally {
      setAdding(false);
    }
  };

  return (
    <PanelSection
      title="Reporting periods"
      description="Leave this empty and the app accepts reports at any time. Add a window and it only opens inside it."
      action={
        <Button variant="outline" size="sm" className="gap-2" onClick={addPeriod} disabled={isAdding}>
          <CalendarPlus className="size-3.5" />
          Add period
        </Button>
      }
    >
      {app.periods.length === 0 ? (
        <EmptyState
          variant="inline"
          icon={CalendarClock}
          title="Always open"
          description="No windows configured, so respondents can file a report whenever they need to."
        />
      ) : (
        <ul className="space-y-2 py-3">
          {app.periods.map((period) => (
            <PeriodRow key={period.id} appId={app.id} period={period} now={now} />
          ))}
        </ul>
      )}
    </PanelSection>
  );
}

function PeriodRow({
  appId,
  period,
  now,
}: {
  appId: string;
  period: FormAppPeriod;
  now: number;
}) {
  const updatePeriod = useUpdateAppPeriod();
  const deletePeriod = useDeleteAppPeriod();

  const [label, setLabel] = React.useState(period.label);
  const [synced, setSynced] = React.useState(period);
  if (synced !== period) {
    setSynced(period);
    setLabel(period.label);
  }

  const patch = async (dto: { label?: string; startsAt?: string; endsAt?: string; isActive?: boolean }) => {
    try {
      await updatePeriod.mutateAsync({ appId, periodId: period.id, ...dto });
    } catch {
      // Reported globally.
    }
  };

  const isOpen =
    period.isActive &&
    new Date(period.startsAt).getTime() <= now &&
    new Date(period.endsAt).getTime() >= now;

  const commitDate = (which: 'startsAt' | 'endsAt') => (e: React.ChangeEvent<HTMLInputElement>) => {
    const date = new Date(e.target.value);
    if (Number.isNaN(date.getTime())) return;
    patch({ [which]: date.toISOString() });
  };

  return (
    <li className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex items-center gap-2">
        <Input
          value={label}
          aria-label="Period label"
          className="h-8 min-w-0 flex-1 text-xs"
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => label.trim() && label !== period.label && patch({ label: label.trim() })}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        {isOpen && <Badge variant="secondary">Open now</Badge>}
        <Switch
          checked={period.isActive}
          aria-label={`${period.label} is active`}
          onCheckedChange={(checked) => patch({ isActive: checked })}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-destructive"
          aria-label={`Remove ${period.label}`}
          disabled={deletePeriod.isPending}
          onClick={() => deletePeriod.mutateAsync({ appId, periodId: period.id }).catch(() => {})}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="datetime-local"
          aria-label={`${period.label} starts`}
          className="h-8 w-full text-xs sm:w-52"
          value={toLocalInputValue(period.startsAt)}
          onChange={commitDate('startsAt')}
        />
        <span className="text-xs text-muted-foreground">to</span>
        <Input
          type="datetime-local"
          aria-label={`${period.label} ends`}
          className="h-8 w-full text-xs sm:w-52"
          value={toLocalInputValue(period.endsAt)}
          onChange={commitDate('endsAt')}
        />
      </div>
    </li>
  );
}
