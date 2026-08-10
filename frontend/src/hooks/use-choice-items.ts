'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { API_BASE_URL } from '@/lib/config';
import type { FormQuestion } from '@/types/form';

/**
 * Options for a list-backed question, fetched from the public endpoint.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Scoped by form + question rather than by list slug, matching the API. The
 * server reads the binding off the question's own published definition, so a
 * respondent can reach exactly the options the form would have shown them and
 * nothing else — a slug-addressed endpoint would let anyone enumerate an
 * organization's supplier registry or staff directory by guessing names.
 *
 * ── Cascade ────────────────────────────────────────────────────────────────
 * A child question sends its parent's current answer. When that answer changes
 * the fetch re-runs, and the caller is responsible for clearing the child's own
 * answer — a block left selected under a newly-chosen district is the classic
 * cascade bug, and it produces a submission the server now rejects outright.
 *
 * ── Search ─────────────────────────────────────────────────────────────────
 * Debounced, because a school registry is far too large to send whole. Below
 * the page size the whole set arrives in one request and filtering is local.
 */

export interface ChoiceItem {
  id: string;
  value: string;
  label: string;
  parentValue: string | null;
  metadata?: Record<string, unknown>;
}

export interface UseChoiceItemsResult {
  items: ChoiceItem[];
  isLoading: boolean;
  error: string | null;
  /** True when the question cascades and its parent has not been answered. */
  awaitingParent: boolean;
}

const PAGE_SIZE = 100;
const SEARCH_DEBOUNCE_MS = 250;

export function useChoiceItems({
  formSlug,
  question,
  parentValue,
  search,
  enabled = true,
}: {
  /** Public form slug. Absent in the builder preview, where nothing is fetched. */
  formSlug?: string;
  question: FormQuestion;
  /** The parent question's current answer, when this one cascades. */
  parentValue?: string;
  search?: string;
  enabled?: boolean;
}): UseChoiceItemsResult {
  const source = question.optionsSource;
  const cascades = !!source?.parentQuestionKey;
  const awaitingParent = cascades && !parentValue;

  /**
   * The last completed fetch, tagged with the request it answered.
   *
   * Holding the key alongside the data is what lets `isLoading` be DERIVED —
   * "there is a request outstanding and no result for it yet" — instead of a
   * separate flag toggled inside the effect. That removes a whole class of bug
   * where the spinner and the data disagree, and it means a stale result can
   * never be shown as though it belonged to the current parent selection.
   */
  const [result, setResult] = useState<{
    key: string;
    items: ChoiceItem[];
    error: string | null;
  } | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search?.trim() ?? ''), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  // Every input the request depends on, in one string, so the effect below has
  // a single primitive dependency rather than an object that changes identity
  // on every render.
  const requestKey = useMemo(() => {
    if (!enabled || !formSlug || !source || awaitingParent) return null;
    return JSON.stringify({
      formSlug,
      questionId: question.id,
      parent: parentValue ?? '',
      q: debouncedSearch,
    });
  }, [enabled, formSlug, source, awaitingParent, question.id, parentValue, debouncedSearch]);

  // Guards against an out-of-order response overwriting a newer one — a slow
  // request for "Koh" must not land after the one for "Kohima".
  const latestRequest = useRef<string | null>(null);

  useEffect(() => {
    // Nothing to fetch. No state reset: the returned values below are derived
    // from `requestKey`, so this reads as an empty, idle result already —
    // clearing state here would cost a render and, worse, could briefly show a
    // previous parent's options before it landed.
    if (!requestKey) return;

    const { formSlug: slug, questionId, parent, q } = JSON.parse(requestKey);
    latestRequest.current = requestKey;
    const controller = new AbortController();

    const params = new URLSearchParams({ question: questionId, limit: String(PAGE_SIZE) });
    if (parent) params.set('parent', parent);
    if (q) params.set('q', q);

    fetch(`${API_BASE_URL}/public-forms/${encodeURIComponent(slug)}/choice-items?${params}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('Could not load the options for this question.');
        const body = await res.json();
        return (body.data ?? body) as { items: ChoiceItem[] };
      })
      .then((payload) => {
        if (latestRequest.current !== requestKey) return;
        setResult({
          key: requestKey,
          items: Array.isArray(payload.items) ? payload.items : [],
          error: null,
        });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (latestRequest.current !== requestKey) return;
        setResult({
          key: requestKey,
          items: [],
          error: err instanceof Error ? err.message : 'Could not load the options.',
        });
      });

    return () => controller.abort();
  }, [requestKey]);

  if (!requestKey) {
    return { items: EMPTY_ITEMS, isLoading: false, error: null, awaitingParent };
  }

  const fresh = result?.key === requestKey ? result : null;

  return {
    // Only a result belonging to THIS request is shown. Anything else is the
    // previous parent's options, which would be actively misleading.
    items: fresh?.items ?? EMPTY_ITEMS,
    isLoading: fresh === null,
    error: fresh?.error ?? null,
    awaitingParent,
  };
}

/** Stable identity so consumers' memos do not recompute on every render. */
const EMPTY_ITEMS: ChoiceItem[] = [];
