'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { API_BASE_URL } from '@/lib/config';
import { getAccessToken } from '@/lib/api';
import { useSessionBootstrap } from '@/providers/auth-provider';

/**
 * A form-app session, from the respondent's side.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Answers are STAGED on the server as they are typed and only become real
 * submissions when "Submit All" is pressed. That is what makes the single
 * submit button honest: the server commits every entry in one transaction, so
 * either the whole report exists or none of it does.
 *
 * ── Autosave, per entry ────────────────────────────────────────────────────
 * Debounced and keyed by (step, index), so typing in School Visit #3 does not
 * re-send #1 and #2. An in-flight save for an entry is superseded rather than
 * queued — the newest answers are the only ones worth writing.
 */

export interface AppSessionStep {
  key: string;
  order: number;
  title: string;
  description: string | null;
  icon: string | null;
  mode: 'SINGLE' | 'REPEATABLE';
  minEntries: number;
  maxEntries: number | null;
  isOptional: boolean;
  uniqueBy: string[];
  form: {
    id: string;
    slug: string;
    title: string;
    subjectRole: 'NONE' | 'REGISTERS' | 'ATTACHES';
    formVersionId: string;
    /**
     * The form's own arrangement, used only when the app's layout is INHERIT.
     * Optional because an app served by an API older than that option omits it,
     * and the resolver treats anything other than `GRID` as stacked.
     */
    layoutMode?: string;
    pages: unknown[];
    questions: unknown[];
    logic: unknown[];
    theme: Record<string, unknown>;
    compiledRules: unknown;
  };
  entries: Array<{ index: number; answers: Record<string, unknown> }>;
}

/** The record a follow-up session is recording against. */
export interface AppSessionSubject {
  id: string;
  displayName: string;
  externalId: string | null;
  attributes: Record<string, unknown>;
}

export interface AppSession {
  id: string;
  appId: string;
  status: 'DRAFT' | 'SUBMITTED' | 'ABANDONED';
  /**
   * REGISTER creates a record; FOLLOW_UP adds to one that already exists.
   * Optional so an API older than follow-ups is read as REGISTER rather than
   * as a session with no mode at all.
   */
  mode?: 'REGISTER' | 'FOLLOW_UP';
  period: { id: string; label: string; startsAt: string; endsAt: string } | null;
  subjectId: string | null;
  subject: AppSessionSubject | null;
  steps: AppSessionStep[];
}

/** How a session is opened. Absent fields mean "a plain new registration". */
export interface OpenSessionOptions {
  /** File into a specific open window — the late-entry case. */
  periodId?: string;
  /** Record this session attaches to. Requires a signed-in caller. */
  subjectId?: string;
  /** Narrow the session to these steps, so "add one visit" is one form. */
  stepKeys?: string[];
}

export interface SessionIssue {
  stepKey: string;
  index: number;
  questionId?: string;
  message: string;
}

const AUTOSAVE_MS = 1200;

/**
 * A stable per-browser id, shared with the public form drafts.
 *
 * Not a security control: it decides which DRAFT is resumed. The server binds
 * every session lookup to it so one respondent cannot open another's
 * half-written report by guessing a session id.
 */
function fingerprint(): string {
  if (typeof window === 'undefined') return '';
  let fp = localStorage.getItem('form_fingerprint');
  if (!fp) {
    fp =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    localStorage.setItem('form_fingerprint', fp);
  }
  return fp;
}

/**
 * Are these two answer maps the same to a respondent?
 *
 * One level deep on purpose. Answer values are scalars, arrays and small
 * objects; the runner rebuilds the map on every change but reuses the values it
 * did not touch, so identity comparison per key is both correct and cheap. A
 * deep walk here would run on every keystroke of every entry.
 */
function shallowEqual(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every((key) => Object.is(a[key], b[key]));
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  // A follow-up session (`subjectId` set) is rejected server-side for anyone
  // the API cannot identify as signed in — without this header a respondent
  // who is genuinely logged in still reads as anonymous, and "add an entry to
  // an existing record" fails with a sign-in prompt despite an active session.
  const token = getAccessToken();
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
    credentials: 'include',
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const raw = body?.error?.message ?? body?.message;
    const error = new Error(
      (Array.isArray(raw) ? raw.join(', ') : raw) || 'Something went wrong.',
    );
    (error as { issues?: SessionIssue[] }).issues = body?.error?.issues ?? body?.issues;
    (error as { status?: number }).status = res.status;
    throw error;
  }
  return (body?.data ?? body) as T;
}

export function useAppSession(publicSlug: string, options: OpenSessionOptions = {}) {
  const [session, setSession] = useState<AppSession | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  /** Answers held locally per (stepKey, index), the source of truth while typing. */
  const [drafts, setDrafts] = useState<Record<string, Record<string, unknown>>>({});
  const [savingKeys, setSavingKeys] = useState<Set<string>>(() => new Set());

  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const fp = useRef('');

  /**
   * The same map as `drafts`, readable synchronously.
   *
   * `setDrafts` with an updater cannot be used to decide whether to schedule a
   * save: the updater runs during the next render, so the decision would be a
   * render later than the keystroke that prompted it — and doing the scheduling
   * inside the updater would make it impure. Every write goes through
   * `applyDrafts`, which keeps the two in step.
   */
  const staged = useRef<Record<string, Record<string, unknown>>>({});

  const applyDrafts = useCallback((next: Record<string, Record<string, unknown>>) => {
    staged.current = next;
    setDrafts(next);
  }, []);

  const entryKey = (stepKey: string, index: number) => `${stepKey}#${index}`;

  // ── Open or resume ────────────────────────────────────────────────────────
  //
  // `subjectId` and `stepKeys` are read out of `options` into locals so the
  // effect can depend on the two values rather than on the object. An inline
  // `{}` default would be a fresh object every render and would reopen the
  // session on each one.
  const subjectId = options.subjectId;
  const periodId = options.periodId;
  const stepKeysParam = options.stepKeys?.join(',');

  // A follow-up session (`subjectId` set) needs the caller's access token on
  // the very first request that opens it. `AuthProvider` only recovers that
  // token from the refresh cookie for this route once it decides the visit is
  // not anonymous — so opening the session before that exchange settles would
  // race it and send the request with no token regardless of `subjectId`
  // being present, landing on the same "must be signed in" rejection this was
  // meant to fix. `bootstrapReady` is true synchronously for every other
  // public-app visit, so this costs nothing there.
  const { ready: bootstrapReady } = useSessionBootstrap();

  useEffect(() => {
    if (subjectId && !bootstrapReady) return;

    let cancelled = false;
    fp.current = fingerprint();

    call<AppSession>(`/public-apps/${encodeURIComponent(publicSlug)}/sessions`, {
      method: 'POST',
      body: JSON.stringify({
        fingerprint: fp.current,
        subjectId,
        periodId,
        stepKeys: stepKeysParam ? stepKeysParam.split(',') : undefined,
      }),
    })
      .then((opened) => {
        if (cancelled) return;
        setSession(opened);
        // Seed the local drafts from whatever was already staged, so a resumed
        // session shows the respondent's own work rather than empty cards.
        const seeded: Record<string, Record<string, unknown>> = {};
        for (const step of opened.steps) {
          for (const entry of step.entries) {
            seeded[entryKey(step.key, entry.index)] = entry.answers ?? {};
          }
        }
        applyDrafts(seeded);
        setIsReady(true);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : 'Could not open this app.');
        setIsReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [publicSlug, applyDrafts, subjectId, periodId, stepKeysParam, bootstrapReady]);

  // Clear pending saves on unmount so a debounce cannot fire into a dead component.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const flush = useCallback(
    async (stepKey: string, index: number, answers: Record<string, unknown>) => {
      if (!session) return;
      const key = entryKey(stepKey, index);
      setSavingKeys((prev) => new Set(prev).add(key));
      try {
        await call(
          `/public-apps/${encodeURIComponent(publicSlug)}/sessions/${session.id}/entries/${encodeURIComponent(stepKey)}/${index}`,
          {
            method: 'PUT',
            body: JSON.stringify({ answers, fingerprint: fp.current }),
          },
        );
      } catch {
        // Staging is best-effort while typing. The authoritative check happens
        // at submit, which re-reads from the server — a lost autosave shows up
        // there as a missing answer rather than as silent data loss.
      } finally {
        setSavingKeys((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [publicSlug, session],
  );

  const setEntryAnswers = useCallback(
    (stepKey: string, index: number, answers: Record<string, unknown>) => {
      const key = entryKey(stepKey, index);

      // An echo of what is already staged is dropped rather than restaged.
      // Every step mounts its own FormRunner, and a runner reporting back the
      // answers it was given would otherwise mint a new drafts object, re-render
      // every other step, and schedule a save that writes nothing.
      if (shallowEqual(staged.current[key], answers)) return;

      applyDrafts({ ...staged.current, [key]: answers });

      const existing = timers.current.get(key);
      if (existing) clearTimeout(existing);
      timers.current.set(
        key,
        setTimeout(() => {
          timers.current.delete(key);
          void flush(stepKey, index, answers);
        }, AUTOSAVE_MS),
      );
    },
    [flush, applyDrafts],
  );

  const refresh = useCallback(async () => {
    if (!session) return;
    const fresh = await call<AppSession>(
      `/public-apps/${encodeURIComponent(publicSlug)}/sessions/${session.id}?fp=${encodeURIComponent(fp.current)}`,
    );
    setSession(fresh);
  }, [publicSlug, session]);

  const addEntry = useCallback(
    async (stepKey: string) => {
      if (!session) return;
      const step = session.steps.find((s) => s.key === stepKey);
      if (!step) return;
      const nextIndex = Math.max(
        step.entries.length,
        ...Object.keys(drafts)
          .filter((key) => key.startsWith(`${stepKey}#`))
          .map((key) => Number(key.split('#')[1]) + 1),
        0,
      );
      // Created server-side immediately so the entry survives a reload even if
      // the respondent never types into it.
      await flush(stepKey, nextIndex, {});
      await refresh();
    },
    [session, drafts, flush, refresh],
  );

  const removeEntry = useCallback(
    async (stepKey: string, index: number) => {
      if (!session) return;
      const pending = timers.current.get(entryKey(stepKey, index));
      if (pending) {
        clearTimeout(pending);
        timers.current.delete(entryKey(stepKey, index));
      }

      await call(
        `/public-apps/${encodeURIComponent(publicSlug)}/sessions/${session.id}/entries/${encodeURIComponent(stepKey)}/${index}?fp=${encodeURIComponent(fp.current)}`,
        { method: 'DELETE' },
      );

      // Indexes close up server-side, so the local drafts have to be rebuilt
      // rather than patched — entry 3 becomes entry 2.
      const next: Record<string, Record<string, unknown>> = {};
      for (const [key, value] of Object.entries(staged.current)) {
        const [owner, position] = key.split('#');
        if (owner !== stepKey) {
          next[key] = value;
          continue;
        }
        const at = Number(position);
        if (at === index) continue;
        next[entryKey(stepKey, at > index ? at - 1 : at)] = value;
      }
      applyDrafts(next);

      await refresh();
    },
    [publicSlug, session, refresh, applyDrafts],
  );

  const reset = useCallback(async () => {
    if (!session) return;
    await call(`/public-apps/${encodeURIComponent(publicSlug)}/sessions/${session.id}/reset`, {
      method: 'POST',
      body: JSON.stringify({ fingerprint: fp.current }),
    });
    applyDrafts({});
    await refresh();
  }, [publicSlug, session, refresh, applyDrafts]);

  /**
   * Submit everything.
   *
   * Every pending autosave is flushed FIRST. Without that, the last thing the
   * respondent typed — very often the field they were on when they reached for
   * the button — would still be sitting in a debounce timer and would simply
   * not be part of the report.
   */
  const submit = useCallback(async () => {
    if (!session) throw new Error('No session.');

    const pending = [...timers.current.entries()];
    for (const [key, timer] of pending) {
      clearTimeout(timer);
      timers.current.delete(key);
      const [stepKey, index] = key.split('#');
      await flush(stepKey, Number(index), drafts[key] ?? {});
    }

    return call<{ sessionId: string; subjectId: string | null; submissionCount: number }>(
      `/public-apps/${encodeURIComponent(publicSlug)}/sessions/${session.id}/submit`,
      { method: 'POST', body: JSON.stringify({ fingerprint: fp.current }) },
    );
  }, [publicSlug, session, drafts, flush]);

  return {
    session,
    drafts,
    isReady,
    loadError,
    isSaving: savingKeys.size > 0,
    setEntryAnswers,
    addEntry,
    removeEntry,
    reset,
    submit,
    refresh,
  };
}
