'use client';

import React, { useState } from 'react';
import {
  AlertTriangle,
  Bell,
  CalendarClock,
  Link2,
  Lock,
  Layers,
  Palette,
  ShieldCheck,
  Trophy,
  X,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ThemeCustomizer } from './ThemeCustomizer';
import { PanelBlock, PanelRow, PanelSection } from './panel-primitives';
import {
  useBuilderStore,
  useFormConfigAdapter,
  useFormSettings,
  useFormSnapshot,
} from '@/store/builder-store';
import type { FormLayoutMode } from '@/types/form';

/**
 * Form-level settings.
 *
 * Every control here writes to a column that already existed on `Form` and had
 * no UI whatsoever: the builder sent title/description/quiz/theme/pages/
 * questions/logic and nothing else, so response caps, expiry, sign-in
 * requirements, duplicate control, access passwords and notification addresses
 * were unreachable from the product and permanently sat at their defaults.
 *
 * Reads and writes go straight to the builder store, which means autosave picks
 * settings changes up exactly like a question edit — there is no separate save
 * button and no separate request.
 */

/**
 * PORTAL is deliberately absent. The column accepts it and the type allows it,
 * but no renderer implements it — a form set to PORTAL falls back to DOCUMENT.
 * Offering it here would be a setting that silently does nothing.
 */
const LAYOUT_MODES: Array<{ value: FormLayoutMode; label: string; hint: string }> = [
  { value: 'DOCUMENT', label: 'Document', hint: 'All questions on one scrolling page' },
  { value: 'CONVERSATIONAL', label: 'Conversational', hint: 'One question at a time' },
  { value: 'GRID', label: 'Grid', hint: 'Two columns on wide screens' },
];

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,118}[a-z0-9]$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** `datetime-local` needs `YYYY-MM-DDTHH:mm` in *local* time, not an ISO-Z string. */
function toLocalInputValue(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

// The section/row primitives that used to live here are shared now — the theme
// and logic panels are built from the same ones, so all three tabs keep the
// same density automatically. See panel-primitives.tsx.
const Row = PanelRow;
const Section = PanelSection;

type SettingsTab = 'design' | 'access' | 'responses';

export function FormSettingsPanel({ initialTab = 'design' }: { initialTab?: SettingsTab }) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);

  // Lazily, once. This panel only ever mounts client-side (it is rendered
  // behind an `open &&` inside a dialog), so there is no server render for
  // `window` to be missing from and nothing for it to mismatch against.
  const [publicOrigin] = useState(() =>
    typeof window === 'undefined' ? '' : window.location.origin,
  );

  const settings = useFormSettings();
  const formSnapshot = useFormSnapshot();
  const setForm = useFormConfigAdapter();
  const isQuizMode = useBuilderStore((s) => s.isQuizMode);
  const status = useBuilderStore((s) => s.status);
  const patchSettings = useBuilderStore((s) => s.patchSettings);
  const setQuizMode = useBuilderStore((s) => s.setQuizMode);
  const setPendingPassword = useBuilderStore((s) => s.setPendingPassword);

  // Held locally and pushed on blur: the slug is unique platform-wide, and
  // autosaving a half-typed one both fails validation and burns candidate slugs.
  const [slugDraft, setSlugDraft] = useState(settings.slug);
  const [slugError, setSlugError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [emailDraft, setEmailDraft] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);

  // Captured on mount: once the panel writes a password, `isPasswordProtected`
  // flips true on the next save, and the copy would otherwise change under the
  // user mid-edit.
  const [passwordAlreadySet] = useState(settings.isPasswordProtected);

  // Adjusted during render rather than in an effect: the server can rewrite the
  // slug (it generates one for a new form), and syncing that in an effect would
  // render one frame with the stale draft before correcting itself.
  const [syncedSlug, setSyncedSlug] = useState(settings.slug);
  if (settings.slug !== syncedSlug) {
    setSyncedSlug(settings.slug);
    setSlugDraft(settings.slug);
  }

  const commitSlug = () => {
    const value = slugDraft.trim().toLowerCase();
    if (value === settings.slug) return;
    if (!SLUG_PATTERN.test(value)) {
      setSlugError('Use 3–120 lowercase letters, numbers or hyphens, starting and ending with one.');
      return;
    }
    setSlugError(null);
    patchSettings({ slug: value });
  };

  const addEmail = () => {
    const value = emailDraft.trim().toLowerCase();
    if (!value) return;
    if (!EMAIL_PATTERN.test(value)) {
      setEmailError('That does not look like an email address.');
      return;
    }
    if (settings.notifyEmails.includes(value)) {
      setEmailError('Already on the list.');
      return;
    }
    if (settings.notifyEmails.length >= 20) {
      setEmailError('Up to 20 addresses.');
      return;
    }
    setEmailError(null);
    setEmailDraft('');
    patchSettings({ notifyEmails: [...settings.notifyEmails, value] });
  };

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => setActiveTab(value as SettingsTab)}
      className="gap-4"
    >
      {/* One dialog instead of two buttons. Theme used to be its own navbar
          button and its own modal, which meant styling and behaviour were two
          unrelated destinations for what an author thinks of as "set up my
          form". */}
      <TabsList className="w-full">
        <TabsTrigger value="design" className="flex-1 gap-1.5">
          <Palette className="size-3.5" />
          Design
        </TabsTrigger>
        <TabsTrigger value="access" className="flex-1 gap-1.5">
          <ShieldCheck className="size-3.5" />
          Access
        </TabsTrigger>
        <TabsTrigger value="responses" className="flex-1 gap-1.5">
          <Bell className="size-3.5" />
          Responses
        </TabsTrigger>
      </TabsList>

      {/* ── Design ─────────────────────────────────────────────────────────── */}
      <TabsContent value="design" className="space-y-4">
        <Section title="Layout">
          <Row
            icon={Layers}
            title="Presentation"
            hint={LAYOUT_MODES.find((m) => m.value === settings.layoutMode)?.hint}
          >
            <NativeSelect
              className="w-full sm:w-48"
              value={settings.layoutMode}
              onChange={(e) => patchSettings({ layoutMode: e.target.value as FormLayoutMode })}
              aria-label="Layout mode"
            >
              {LAYOUT_MODES.map((mode) => (
                <NativeSelectOption key={mode.value} value={mode.value}>
                  {mode.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Row>
        </Section>

        <ThemeCustomizer form={formSnapshot} setForm={setForm} />
      </TabsContent>

      {/* ── Access ─────────────────────────────────────────────────────────── */}
      <TabsContent value="access" className="space-y-4">
      <Section title="Public link">
        {/* A full-width block, not a row: the origin prefix plus the slug does
            not fit a right-hand control column at this dialog width. */}
        <PanelBlock
          label="Link address"
          htmlFor="form-slug"
          hint={
            slugError ??
            (status === 'PUBLISHED'
              ? 'Where respondents fill this form in.'
              : 'Active once the form is published.')
          }
          hintTone={slugError ? 'destructive' : 'muted'}
        >
          <div className="flex items-center gap-1.5">
            <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="shrink-0 truncate text-xs text-muted-foreground">
              {publicOrigin}/f/
            </span>
            <Input
              id="form-slug"
              value={slugDraft}
              onChange={(e) => {
                setSlugDraft(e.target.value);
                setSlugError(null);
              }}
              onBlur={commitSlug}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              aria-invalid={!!slugError}
              className="h-8 min-w-0 flex-1 text-xs"
            />
          </div>
        </PanelBlock>
      </Section>

      <Section title="Who can respond">
        <Row
          icon={ShieldCheck}
          title="Require sign-in"
          hint="Only signed-in users can open the form. Their identity is recorded with the response."
        >
          <Switch
            checked={settings.requireAuth}
            onCheckedChange={(checked) => patchSettings({ requireAuth: checked })}
            aria-label="Require sign-in"
          />
        </Row>

        <Row
          icon={Layers}
          title="Allow multiple responses"
          hint="When off, a respondent who has already answered is turned away."
        >
          <Switch
            checked={settings.allowMultiple}
            onCheckedChange={(checked) => patchSettings({ allowMultiple: checked })}
            aria-label="Allow multiple responses"
          />
        </Row>

        <Row
          icon={Lock}
          title="Password protect"
          hint="Respondents must enter a password before they see any questions."
        >
          <Switch
            checked={settings.isPasswordProtected}
            onCheckedChange={(checked) => {
              patchSettings({ isPasswordProtected: checked });
              if (!checked) {
                setPassword('');
                setPendingPassword(null);
              }
            }}
            aria-label="Password protect"
          />
        </Row>

        {settings.isPasswordProtected && (
          <PanelBlock
            /* The API only ever returns `isPasswordProtected`; the hash is
               never sent to a client, so there is nothing to prefill. */
            label={passwordAlreadySet ? 'Set a new password' : 'Choose a password'}
            htmlFor="form-password"
            /* The API holds the flag back until a password exists, rather than
               rejecting the autosave that the toggle itself triggers. Say so,
               or the switch looks like it silently did nothing. */
            hint={
              !passwordAlreadySet && !password
                ? 'Protection turns on once you set a password.'
                : undefined
            }
            hintTone="warning"
            className="pl-6"
          >
            <Input
              id="form-password"
              type="password"
              value={password}
              autoComplete="new-password"
              placeholder={
                passwordAlreadySet
                  ? 'Leave blank to keep the current password'
                  : 'At least 4 characters'
              }
              onChange={(e) => setPassword(e.target.value)}
              onBlur={() => setPendingPassword(password || null)}
              className="h-8 text-xs"
            />
          </PanelBlock>
        )}
      </Section>
      </TabsContent>

      {/* ── Responses ──────────────────────────────────────────────────────── */}
      <TabsContent value="responses" className="space-y-4">
      <Section title="Limits">
        <Row
          icon={Layers}
          title="Response cap"
          hint="The form closes itself once this many responses are in. Blank means unlimited."
        >
          <Input
            type="number"
            min={1}
            inputMode="numeric"
            value={settings.maxSubmissions ?? ''}
            placeholder="Unlimited"
            onChange={(e) => {
              const raw = e.target.value.trim();
              const parsed = Number.parseInt(raw, 10);
              patchSettings({
                maxSubmissions: raw === '' || !Number.isFinite(parsed) || parsed < 1 ? null : parsed,
              });
            }}
            aria-label="Maximum responses"
            className="tabular h-8 w-full text-xs sm:w-32"
          />
        </Row>

        <Row
          icon={CalendarClock}
          title="Close on"
          hint="Responses submitted after this moment are rejected. Blank means never."
        >
          <div className="flex items-center gap-1">
            <Input
              type="datetime-local"
              value={toLocalInputValue(settings.expiresAt)}
              onChange={(e) => {
                const raw = e.target.value;
                if (!raw) return patchSettings({ expiresAt: null });
                const date = new Date(raw);
                patchSettings({
                  expiresAt: Number.isNaN(date.getTime()) ? null : date.toISOString(),
                });
              }}
              aria-label="Close responses on"
              className="h-8 w-full text-xs sm:w-48"
            />
            {settings.expiresAt && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Clear closing date"
                onClick={() => patchSettings({ expiresAt: null })}
              >
                <X className="size-3.5" />
              </Button>
            )}
          </div>
        </Row>
      </Section>

      {/* ── Notifications ──────────────────────────────────────────────────── */}
      <Section title="Notifications">
        <Row
          icon={Bell}
          title="Email on each response"
          hint="These addresses get a message every time the form is submitted."
        />

        <PanelBlock hint={emailError ?? undefined} hintTone="destructive" className="pl-6">
          <div className="flex gap-1.5">
            <Input
              type="email"
              value={emailDraft}
              placeholder="person@company.com"
              onChange={(e) => {
                setEmailDraft(e.target.value);
                setEmailError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addEmail();
                }
              }}
              aria-invalid={!!emailError}
              aria-label="Notification email"
              className="h-8 min-w-0 flex-1 text-xs"
            />
            <Button variant="outline" size="sm" onClick={addEmail} className="shrink-0">
              Add
            </Button>
          </div>

          {settings.notifyEmails.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {settings.notifyEmails.map((email) => (
                <Badge key={email} variant="secondary" className="gap-1 pr-1 font-normal">
                  {email}
                  <button
                    type="button"
                    aria-label={`Remove ${email}`}
                    onClick={() =>
                      patchSettings({
                        notifyEmails: settings.notifyEmails.filter((e) => e !== email),
                      })
                    }
                    className="rounded-full p-0.5 hover:bg-foreground/10"
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </PanelBlock>
      </Section>

      {/* ── Quiz ───────────────────────────────────────────────────────────── */}
      <Section title="Quiz">
        <Row
          icon={Trophy}
          title="Make this a quiz"
          hint="Adds a points value and an answer key to every question, and grades responses automatically."
        >
          <Switch
            checked={isQuizMode}
            onCheckedChange={setQuizMode}
            aria-label="Quiz mode"
          />
        </Row>
      </Section>

      {status === 'PUBLISHED' && (
        <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Settings apply to the live form as soon as they save. Question, logic and theme changes
            need a republish before respondents see them.
          </span>
        </p>
      )}
      </TabsContent>
    </Tabs>
  );
}
