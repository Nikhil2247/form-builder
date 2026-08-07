'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, fetchApi, unwrap } from '@/lib/api';
import { selectSavePayload, useBuilderStore } from '@/store/builder-store';

/**
 * Autosave for the form builder.
 *
 * ── What this replaces ─────────────────────────────────────────────────────
 * The builder previously autosaved with a bare `setTimeout` inside a store
 * subscription:
 *
 *   • Every save cleared `isDirty` on completion, including the keystrokes the
 *     user produced *while the request was in flight*. Those edits then sat
 *     unsaved and looked saved, and were lost on navigation.
 *   • Nothing serialised the requests. A fast typist with a slow connection had
 *     several PUTs racing, and the one that happened to land last won — which
 *     is not necessarily the newest.
 *   • A failed save was a toast and nothing else. No retry, no persistent
 *     warning; the user kept working over a form that had stopped saving.
 *   • Closing the tab within the debounce window silently discarded the last
 *     edit.
 *   • Nothing ever saved a form that had no id yet, so the first minutes of
 *     work on a new form were not protected at all.
 *
 * ── The model ──────────────────────────────────────────────────────────────
 * The store's `revision` is a monotonic counter of content changes and
 * `savedRevision` is the high-water mark known to be on the server. Autosave's
 * only job is to close the gap between them.
 *
 * A save captures the revision it is sending. On success the store records
 * *that* revision, so anything typed during the request stays dirty and
 * triggers a follow-up pass. Saves never overlap: a request arriving while one
 * is in flight sets a flag and runs when the current one settles.
 */

/** Quiet period after the last keystroke before a save fires. */
const DEBOUNCE_MS = 1200;

/**
 * Hard ceiling between saves while the user is typing continuously. Without
 * it, a debounce alone means someone who never pauses for 1.2s is never saved.
 */
const MAX_WAIT_MS = 10_000;

/** Backoff schedule for retryable failures. The last value repeats. */
const RETRY_DELAYS_MS = [1_000, 3_000, 8_000, 20_000, 30_000];

export type SaveStatus =
  | 'idle'
  | 'unsaved'
  | 'saving'
  | 'saved'
  /** A retryable failure; a retry is scheduled. Work is still safe locally. */
  | 'retrying'
  /** No network. Saving is paused until the browser reports it is back. */
  | 'offline'
  /** Someone else saved this form since we loaded it. Needs a human decision. */
  | 'conflict'
  /** Rejected by the server and not worth retrying (validation, permission). */
  | 'error';

export interface AutosaveController {
  status: SaveStatus;
  lastSavedAt: Date | null;
  /** Present when status is 'error' or 'conflict'. */
  errorMessage: string | null;
  /** Save now, bypassing the debounce. Resolves to the form id, or null. */
  saveNow: (opts?: { silent?: boolean }) => Promise<string | null>;
  /** Discard local edits and take the server's copy. Only for 'conflict'. */
  reloadFromServer: () => void;
}

interface UseFormAutosaveOptions {
  orgId: string | null | undefined;
  /** Holds the form id across the create → update transition. */
  formIdRef: React.MutableRefObject<string | null>;
  /** False while the form is still loading, to keep autosave off. */
  enabled: boolean;
  /** Called once, with the new id, when the first save creates the form. */
  onCreated?: (id: string) => void;
  onConflict?: () => void;
}

/** Retryable failures are transport-level; a 4xx will fail identically forever. */
function isRetryable(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  return error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500;
}

/**
 * The parts of the save response this hook uses. The API sometimes wraps the
 * row under `form` and sometimes returns it bare, so both are tolerated.
 */
interface SavedFormResponse {
  id?: string;
  slug?: string;
  updatedAt?: string;
  form?: SavedFormResponse;
}

export function useFormAutosave({
  orgId,
  formIdRef,
  enabled,
  onCreated,
  onConflict,
}: UseFormAutosaveOptions): AutosaveController {
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // ── Scheduler state ───────────────────────────────────────────────────────
  // All refs: these change on every keystroke and must not re-render anything.
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxWaitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  /** An edit landed during a save; run another pass once this one settles. */
  const rerunRequested = useRef(false);
  const retryAttempt = useRef(0);
  /** Blocks further writes after a conflict, until the user resolves it. */
  const halted = useRef(false);
  const mounted = useRef(true);

  // Callbacks are held in refs so that a caller passing a fresh closure each
  // render does not tear down and rebuild the timers mid-edit. Assigned in an
  // effect, never during render.
  const onCreatedRef = useRef(onCreated);
  const onConflictRef = useRef(onConflict);
  useEffect(() => {
    onCreatedRef.current = onCreated;
    onConflictRef.current = onConflict;
  }, [onCreated, onConflict]);

  /**
   * The current save function. `performSave` needs to re-enter itself (to pick
   * up edits that arrived mid-request, and to retry) and a `useCallback` cannot
   * name itself in its own body. Every such call goes through this ref, which
   * is only ever read asynchronously — inside a timer or a `finally` — long
   * after the effect below has populated it.
   */
  const saveRef = useRef<(opts?: { silent?: boolean; keepalive?: boolean }) => Promise<string | null>>(
    async () => null,
  );

  const clearTimers = useCallback(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (maxWaitTimer.current) clearTimeout(maxWaitTimer.current);
    if (retryTimer.current) clearTimeout(retryTimer.current);
    debounceTimer.current = null;
    maxWaitTimer.current = null;
    retryTimer.current = null;
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimers();
    };
  }, [clearTimers]);

  // ── The write ─────────────────────────────────────────────────────────────
  const performSave = useCallback(
    async (opts: { silent?: boolean; keepalive?: boolean } = {}): Promise<string | null> => {
      if (!orgId || halted.current) return null;

      const state = useBuilderStore.getState();
      // Nothing to do. Checked here rather than only at the call site so that
      // the retry path and the flush path cannot save redundantly either.
      if (state.revision <= state.savedRevision) return formIdRef.current;

      if (inFlight.current) {
        rerunRequested.current = true;
        return null;
      }

      // Capture before the await. Everything the user types from here on
      // belongs to a later revision and must stay dirty.
      const sentRevision = state.revision;
      const payload = selectSavePayload(state);
      const body = JSON.stringify(payload);

      inFlight.current = true;
      clearTimers();
      if (mounted.current) setStatus('saving');

      try {
        const existingId = formIdRef.current;

        const saved = unwrap<SavedFormResponse>(
          existingId
            ? await fetchApi(`/organizations/${orgId}/forms/${existingId}`, {
                method: 'PUT',
                body,
                keepalive: opts.keepalive,
              })
            : await fetchApi(`/organizations/${orgId}/forms`, {
                method: 'POST',
                body,
                keepalive: opts.keepalive,
              }),
        );

        const form = saved?.form ?? saved;
        const id = form?.id ?? existingId;

        // A create that comes back without an id leaves nothing to update on
        // the next pass, so every later save would create another form. Treat
        // it as a failure rather than quietly forking the document.
        if (!id) throw new ApiError('The server did not return a form id.', 502);

        formIdRef.current = id;

        useBuilderStore.getState().markSaved(sentRevision, {
          id,
          slug: form?.slug,
          updatedAt: form?.updatedAt ?? null,
        });

        retryAttempt.current = 0;
        if (mounted.current) {
          setErrorMessage(null);
          setLastSavedAt(new Date());
          setStatus(useBuilderStore.getState().isDirty ? 'unsaved' : 'saved');
        }

        if (!existingId && id) onCreatedRef.current?.(id);
        return id;
      } catch (error) {
        const apiError = error instanceof ApiError ? error : null;

        // 409 — the row moved under us (another tab, another editor). Retrying
        // would either fail identically or, worse, clobber their work.
        if (apiError?.status === 409) {
          halted.current = true;
          if (mounted.current) {
            setStatus('conflict');
            setErrorMessage(
              apiError.message ||
                'This form was changed somewhere else. Reload to get the latest version.',
            );
          }
          onConflictRef.current?.();
          return null;
        }

        if (isRetryable(error)) {
          const attempt = retryAttempt.current;
          retryAttempt.current = attempt + 1;
          const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];

          if (mounted.current) {
            setStatus(
              typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'retrying',
            );
            setErrorMessage(apiError?.message ?? 'Could not reach the server.');
          }

          retryTimer.current = setTimeout(() => void saveRef.current({ silent: true }), delay);
          return null;
        }

        if (mounted.current) {
          setStatus('error');
          setErrorMessage(apiError?.message ?? 'This form could not be saved.');
        }
        return null;
      } finally {
        inFlight.current = false;

        // Edits that arrived mid-request. Go straight round again rather than
        // waiting for the next keystroke to reschedule.
        if (rerunRequested.current && !halted.current) {
          rerunRequested.current = false;
          const latest = useBuilderStore.getState();
          if (latest.revision > latest.savedRevision) {
            debounceTimer.current = setTimeout(
              () => void saveRef.current({ silent: true }),
              DEBOUNCE_MS,
            );
          }
        }
      }
    },
    [orgId, formIdRef, clearTimers],
  );

  useEffect(() => {
    saveRef.current = performSave;
  }, [performSave]);

  // ── Scheduling ────────────────────────────────────────────────────────────
  const schedule = useCallback(() => {
    if (!enabled || halted.current) return;

    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => void performSave({ silent: true }), DEBOUNCE_MS);

    // Armed once per burst of edits, not reset on each one — that is what makes
    // it a ceiling rather than a second debounce.
    if (!maxWaitTimer.current) {
      maxWaitTimer.current = setTimeout(() => {
        maxWaitTimer.current = null;
        void performSave({ silent: true });
      }, MAX_WAIT_MS);
    }
  }, [enabled, performSave]);

  // Subscribed outside React: an edit reschedules a timer, it does not need to
  // re-render the page component that owns this hook.
  useEffect(() => {
    if (!enabled) return;

    return useBuilderStore.subscribe((state, previous) => {
      if (state.revision === previous.revision) return;
      if (state.revision <= state.savedRevision) return;

      setStatus((current) =>
        current === 'saving' || current === 'conflict' || current === 'error' ? current : 'unsaved',
      );
      schedule();
    });
  }, [enabled, schedule]);

  // ── Connectivity ──────────────────────────────────────────────────────────
  useEffect(() => {
    const goOffline = () => {
      if (useBuilderStore.getState().isDirty) setStatus('offline');
    };
    const goOnline = () => {
      // Reset the backoff — the reason for the failures is gone.
      retryAttempt.current = 0;
      if (useBuilderStore.getState().isDirty) void performSave({ silent: true });
    };

    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, [performSave]);

  // ── Flush on the way out ──────────────────────────────────────────────────
  // `visibilitychange → hidden` is the last event reliably delivered on mobile;
  // `pagehide` covers desktop tab closes and bfcache. `keepalive` lets the
  // request outlive the document.
  useEffect(() => {
    if (!enabled) return;

    const flush = () => {
      const state = useBuilderStore.getState();
      if (state.revision <= state.savedRevision) return;
      if (halted.current || !formIdRef.current) return;
      void performSave({ silent: true, keepalive: true });
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
    };
  }, [enabled, performSave, formIdRef]);

  const saveNow = useCallback(
    (opts: { silent?: boolean } = {}) => {
      clearTimers();
      retryAttempt.current = 0;
      return performSave(opts);
    },
    [clearTimers, performSave],
  );

  const reloadFromServer = useCallback(() => {
    halted.current = false;
    window.location.reload();
  }, []);

  return { status, lastSavedAt, errorMessage, saveNow, reloadFromServer };
}
