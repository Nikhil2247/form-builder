'use client';

import React, { useState } from 'react';
import {
  ChevronLeft,
  ClipboardList,
  FilePlus2,
  FileText,
  Home,
  Loader2,
  Search,
  UserPlus,
  Users,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { useSubjects, useSubjectTimeline, type Subject } from '@/hooks/use-subjects';
import type { AppForm, DashboardCardResult } from '@/hooks/use-form-apps';

/**
 * A working simulation of the data-entry app, rendered inside the phone frame.
 *
 * Not a mockup: it runs the real hooks against the real API, so an author sees
 * their actual records and their actual dashboard counts. The point is to answer
 * "does this app make sense on a phone" — a question a static picture of
 * invented rows cannot answer.
 *
 * SELF-CONTAINED BY DESIGN. It takes plain props and owns its own navigation
 * state, so the builder can drive it from unsaved edits and the app page can
 * drive it from a saved record, with no shared store and nothing to unwind if
 * the preview is dropped later.
 *
 * READ-ONLY. Tapping a form shows what would open rather than opening it — the
 * preview must never create a record as a side effect of being looked at.
 */

type Screen = 'home' | 'records' | 'forms';

export interface PhoneAppSimulatorProps {
  name: string;
  icon?: string | null;
  /** Usually the record type — "Patient", "Household". */
  subjectTypeName?: string;
  subjectTypeId?: string | null;
  forms: AppForm[];
  /** Resolved counts when the app is saved; titles alone while building. */
  cards?: DashboardCardResult[];
  cardsLoading?: boolean;
  /**
   * False while the app has no subject type yet, which suppresses the record
   * queries rather than firing them with an undefined filter.
   */
  canLoadRecords?: boolean;
}

const TABS: Array<{ id: Screen; label: string; icon: typeof Home }> = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'records', label: 'Records', icon: Users },
  { id: 'forms', label: 'Forms', icon: FileText },
];

export function PhoneAppSimulator({
  name,
  icon,
  subjectTypeName,
  subjectTypeId,
  forms,
  cards,
  cardsLoading = false,
  canLoadRecords = true,
}: PhoneAppSimulatorProps) {
  const [screen, setScreen] = useState<Screen>('home');
  const [search, setSearch] = useState('');
  const [openSubject, setOpenSubject] = useState<Subject | null>(null);

  const recordsEnabled = canLoadRecords && !!subjectTypeId;

  const { data: subjectsData, isLoading: subjectsLoading } = useSubjects(
    { subjectTypeId: subjectTypeId ?? undefined, limit: 20, search: search || undefined },
    { enabled: recordsEnabled },
  );

  const subjects = subjectsData?.subjects ?? [];
  const registrationForm = forms.find((form) => form.subjectRole === 'REGISTERS');
  const entryForms = forms.filter((form) => form.subjectRole !== 'REGISTERS');

  // A record's detail replaces the tab content rather than sitting beside it,
  // which is how it behaves on a real phone.
  if (openSubject) {
    return (
      <PhoneChrome
        name={openSubject.displayName}
        subtitle={openSubject.externalId ?? subjectTypeName}
        icon={null}
        onBack={() => setOpenSubject(null)}
        screen={screen}
        onTab={(next) => {
          setOpenSubject(null);
          setScreen(next);
        }}
      >
        <RecordScreen subject={openSubject} entryForms={entryForms} />
      </PhoneChrome>
    );
  }

  return (
    <PhoneChrome
      name={name}
      subtitle={subjectTypeName}
      icon={icon}
      screen={screen}
      onTab={setScreen}
    >
      {screen === 'home' && (
        <HomeScreen
          cards={cards}
          cardsLoading={cardsLoading}
          registrationForm={registrationForm}
          recentCount={subjects.length}
          onSeeRecords={() => setScreen('records')}
        />
      )}

      {screen === 'records' && (
        <RecordsScreen
          enabled={recordsEnabled}
          loading={subjectsLoading}
          subjects={subjects}
          search={search}
          onSearch={setSearch}
          onOpen={setOpenSubject}
          registrationForm={registrationForm}
        />
      )}

      {screen === 'forms' && <FormsScreen forms={forms} />}
    </PhoneChrome>
  );
}

// ── Chrome: header, scrolling body, bottom tab bar ──────────────────────────

function PhoneChrome({
  name,
  subtitle,
  icon,
  onBack,
  screen,
  onTab,
  children,
}: {
  name: string;
  subtitle?: string | null;
  icon?: string | null;
  onBack?: () => void;
  screen: Screen;
  onTab: (screen: Screen) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col bg-background">
      <header className="sticky top-0 z-10 flex shrink-0 items-center gap-2.5 border-b border-border bg-card/95 px-4 py-3 backdrop-blur">
        {onBack ? (
          <button
            onClick={onBack}
            aria-label="Back"
            className="-ml-1.5 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft className="size-4" strokeWidth={2} />
          </button>
        ) : icon ? (
          <span aria-hidden className="text-base leading-none">
            {icon}
          </span>
        ) : null}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-foreground">{name}</span>
          {subtitle && (
            <span className="block truncate text-[11px] text-muted-foreground">{subtitle}</span>
          )}
        </span>
      </header>

      {/* The only scrolling region — the header and tab bar stay put, as they
          would on a device. */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div>

      <nav
        aria-label="App sections"
        className="flex shrink-0 border-t border-border bg-card/95 backdrop-blur"
      >
        {TABS.map(({ id, label, icon: Icon }) => {
          const isActive = id === screen;
          return (
            <button
              key={id}
              onClick={() => onTab(id)}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors',
                isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="size-4" strokeWidth={isActive ? 2.2 : 1.6} aria-hidden />
              {label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

// ── Screens ─────────────────────────────────────────────────────────────────

function HomeScreen({
  cards,
  cardsLoading,
  registrationForm,
  recentCount,
  onSeeRecords,
}: {
  cards?: DashboardCardResult[];
  cardsLoading: boolean;
  registrationForm?: AppForm;
  recentCount: number;
  onSeeRecords: () => void;
}) {
  return (
    <div className="space-y-3">
      {registrationForm && (
        <button
          onClick={onSeeRecords}
          className="flex w-full items-center gap-2.5 rounded-xl bg-primary px-3.5 py-3 text-left text-primary-foreground shadow-sm"
        >
          <UserPlus className="size-4 shrink-0" strokeWidth={2} aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-semibold">New record</span>
            <span className="block truncate text-[10px] opacity-80">{registrationForm.title}</span>
          </span>
        </button>
      )}

      {cardsLoading ? (
        <PhoneLoading label="Loading dashboard…" />
      ) : cards && cards.length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          {cards.map((card, index) => (
            <div
              key={`${card.title}-${index}`}
              className="rounded-xl border border-border bg-card p-3"
            >
              <div className="text-lg font-semibold tabular-nums text-foreground">
                {typeof card.value === 'number' ? card.value.toLocaleString() : '—'}
              </div>
              <div className="mt-0.5 line-clamp-2 text-[10px] leading-tight text-muted-foreground">
                {card.title}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <PhoneEmpty
          icon={ClipboardList}
          title="No dashboard cards"
          body="Add cards to show counts here."
        />
      )}

      {recentCount > 0 && (
        <button
          onClick={onSeeRecords}
          className="w-full rounded-xl border border-border bg-card px-3.5 py-2.5 text-left"
        >
          <span className="block text-xs font-medium text-foreground">Browse records</span>
          <span className="block text-[10px] text-muted-foreground">
            {recentCount} loaded on this device
          </span>
        </button>
      )}
    </div>
  );
}

function RecordsScreen({
  enabled,
  loading,
  subjects,
  search,
  onSearch,
  onOpen,
  registrationForm,
}: {
  enabled: boolean;
  loading: boolean;
  subjects: Subject[];
  search: string;
  onSearch: (value: string) => void;
  onOpen: (subject: Subject) => void;
  registrationForm?: AppForm;
}) {
  if (!enabled) {
    return (
      <PhoneEmpty
        icon={Users}
        title="No record type yet"
        body="Choose one and records will appear here."
      />
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          strokeWidth={1.5}
          aria-hidden
        />
        <input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Search records"
          aria-label="Search records"
          className="w-full rounded-lg border border-border bg-card py-2 pl-8 pr-2.5 text-xs text-foreground
                     placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      {registrationForm && (
        <button className="flex w-full items-center gap-2 rounded-lg border border-dashed border-border-strong px-3 py-2 text-left text-muted-foreground">
          <UserPlus className="size-3.5 shrink-0" strokeWidth={1.5} aria-hidden />
          <span className="truncate text-[11px]">Register with “{registrationForm.title}”</span>
        </button>
      )}

      {loading ? (
        <PhoneLoading label="Loading records…" />
      ) : subjects.length === 0 ? (
        <PhoneEmpty
          icon={Users}
          title={search ? 'No matches' : 'No records yet'}
          body={search ? 'Try a different search.' : 'Register one to get started.'}
        />
      ) : (
        <ul className="space-y-1.5">
          {subjects.map((subject) => (
            <li key={subject.id}>
              <button
                onClick={() => onOpen(subject)}
                className="flex w-full items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted"
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
                  {subject.displayName?.[0]?.toUpperCase() ?? '?'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-foreground">
                    {subject.displayName}
                  </span>
                  {subject.externalId && (
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {subject.externalId}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RecordScreen({ subject, entryForms }: { subject: Subject; entryForms: AppForm[] }) {
  const { data, isLoading } = useSubjectTimeline(subject.id, { limit: 10 });
  const entries = data?.entries ?? [];

  const attributes = Object.entries(subject.attributes ?? {}).filter(
    ([, value]) => value !== null && value !== undefined && value !== '',
  );

  return (
    <div className="space-y-3">
      {attributes.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-3">
          <dl className="grid grid-cols-2 gap-y-2">
            {attributes.slice(0, 6).map(([key, value]) => (
              <div key={key} className="min-w-0">
                <dt className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
                  {key.replace(/_/g, ' ')}
                </dt>
                <dd className="truncate text-xs text-foreground">
                  {Array.isArray(value) ? value.join(', ') : String(value)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {entryForms.length > 0 && (
        <div className="space-y-1.5">
          <h3 className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Record an entry
          </h3>
          {entryForms.map((form) => (
            <button
              key={form.id}
              className="flex w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-left"
            >
              <FilePlus2 className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.5} aria-hidden />
              <span className="truncate text-xs text-foreground">{form.title}</span>
            </button>
          ))}
        </div>
      )}

      <div className="space-y-1.5">
        <h3 className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          History
        </h3>
        {isLoading ? (
          <PhoneLoading label="Loading history…" />
        ) : entries.length === 0 ? (
          <PhoneEmpty icon={ClipboardList} title="No entries yet" body="Nothing recorded so far." />
        ) : (
          // A left rail turns a list of dates into something that reads as a
          // sequence, which is the whole point of a longitudinal record.
          <ol className="space-y-2 border-l border-border pl-3">
            {entries.map((entry) => (
              <li key={entry.id} className="relative">
                <span
                  aria-hidden
                  className="absolute -left-[17px] top-1.5 size-1.5 rounded-full bg-border-strong"
                />
                <div className="rounded-lg border border-border bg-card px-3 py-2">
                  <div className="truncate text-xs font-medium text-foreground">
                    {entry.form?.title ?? 'Entry'}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {new Date(entry.submittedAt).toLocaleDateString(undefined, {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function FormsScreen({ forms }: { forms: AppForm[] }) {
  if (forms.length === 0) {
    return (
      <PhoneEmpty
        icon={FileText}
        title="No forms yet"
        body="Add forms and they appear here."
      />
    );
  }

  return (
    <ul className="space-y-1.5">
      {forms.map((form) => (
        <li key={form.id}>
          <div className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5">
            <FileText className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.5} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-foreground">
                {form.title}
              </span>
              <span className="block text-[10px] text-muted-foreground">
                {form.subjectRole === 'REGISTERS'
                  ? 'Creates a record'
                  : form.subjectRole === 'ATTACHES'
                    ? 'Adds to a record'
                    : 'Standalone'}
              </span>
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ── Small shared states ─────────────────────────────────────────────────────

function PhoneLoading({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-8 text-[11px] text-muted-foreground">
      <Loader2 className="size-3.5 animate-spin" strokeWidth={1.5} aria-hidden />
      {label}
    </div>
  );
}

function PhoneEmpty({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Users;
  title: string;
  body: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed border-border-strong px-4 py-8 text-center">
      <Icon className="size-5 text-muted-foreground" strokeWidth={1.5} aria-hidden />
      <p className="text-xs font-medium text-foreground">{title}</p>
      <p className="text-[10px] text-muted-foreground">{body}</p>
    </div>
  );
}
