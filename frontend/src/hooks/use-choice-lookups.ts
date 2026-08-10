'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { API_BASE_URL } from '@/lib/config';
import {
  planLookupRequests,
  resolveLookupBag,
  type CompiledPlan,
  type RuleValue,
} from '@/lib/rules';
import type { FormQuestion } from '@/types/form';

/**
 * Resolving `lookup()` in the browser, so auto-filled fields fill live.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The interpreter performs no I/O — a lookup's value is handed to it in a bag,
 * pre-resolved. On the server that bag comes from Postgres; here it comes from
 * the same public endpoint the cascade uses, fetched by exact value.
 *
 * `planLookupRequests` and `resolveLookupBag` are the SHARED pure functions the
 * server also calls. That is the point: both sides must agree on which triples
 * are wanted and under which key each is filed, or an auto-filled field would
 * read `null` in the browser and a real value on submit — the value visibly
 * changing at the moment of submission is a worse failure than never showing
 * it at all.
 *
 * ── Scope restriction ──────────────────────────────────────────────────────
 * The public endpoint is addressed by QUESTION, never by list slug, so nobody
 * can enumerate an organization's lists by guessing names. A `lookup()` is
 * therefore resolvable here only when the question it reads is itself bound to
 * the list being read — which is the case for every real use, since the value
 * being looked up came from that list in the first place. Anything else is
 * skipped: the field simply stays blank until submit, when the server computes
 * it authoritatively. Degraded preview, never a wrong value.
 */

export function useChoiceLookups({
  formSlug,
  questions,
  plan,
  answersByKey,
}: {
  formSlug?: string;
  questions: FormQuestion[];
  plan: CompiledPlan | null;
  /** Answers keyed by question KEY — the projection the plan addresses. */
  answersByKey: Record<string, RuleValue>;
}): Record<string, RuleValue> {
  const [bag, setBag] = useState<Record<string, RuleValue>>({});

  const requests = useMemo(
    () => planLookupRequests(plan?.lookups, answersByKey),
    [plan?.lookups, answersByKey],
  );

  /** Which question to address the endpoint with, per requested list+value. */
  const resolvable = useMemo(() => {
    if (!formSlug || requests.length === 0) return [];

    const byKey = new Map<string, FormQuestion>();
    for (const question of questions) {
      if (question.key) byKey.set(question.key, question);
    }

    const out: Array<{ questionId: string; list: string; value: string }> = [];
    for (const request of requests) {
      // `planLookupRequests` does not carry the field back, so recover the
      // question from the plan spec that produced this request.
      const spec = plan?.lookups?.find(
        (candidate) => candidate.list === request.list && candidate.column === request.column,
      );
      if (!spec) continue;
      const question = byKey.get(spec.field);
      if (!question) continue;
      // See the scope note above.
      if (question.optionsSource?.listSlug !== request.list) continue;
      out.push({ questionId: question.id, list: request.list, value: request.value });
    }
    return out;
  }, [formSlug, requests, questions, plan?.lookups]);

  // One primitive dependency, so the effect does not re-run on array identity.
  const fetchKey = useMemo(
    () =>
      resolvable.length === 0
        ? null
        : JSON.stringify(
            [...new Set(resolvable.map((r) => `${r.questionId}|${r.list}|${r.value}`))].sort(),
          ),
    [resolvable],
  );

  const latest = useRef<string | null>(null);

  useEffect(() => {
    // No state reset here: the return value below is derived from `fetchKey`,
    // so "nothing to fetch" already reads as an empty bag without a render
    // cycle spent clearing one.
    if (!fetchKey || !formSlug) return;

    latest.current = fetchKey;
    const controller = new AbortController();

    // One request per question, each carrying every value wanted from it.
    const byQuestion = new Map<string, { list: string; values: Set<string> }>();
    for (const entry of resolvable) {
      const existing = byQuestion.get(entry.questionId);
      if (existing) existing.values.add(entry.value);
      else byQuestion.set(entry.questionId, { list: entry.list, values: new Set([entry.value]) });
    }

    Promise.all(
      [...byQuestion.entries()].map(async ([questionId, { list, values }]) => {
        const params = new URLSearchParams({
          question: questionId,
          values: [...values].join(','),
        });
        const res = await fetch(
          `${API_BASE_URL}/public-forms/${encodeURIComponent(formSlug)}/choice-items?${params}`,
          { signal: controller.signal },
        );
        if (!res.ok) return [] as Array<[string, Record<string, unknown>]>;
        const body = await res.json();
        const items = ((body.data ?? body).items ?? []) as Array<{
          value: string;
          metadata?: Record<string, unknown>;
        }>;
        return items.map(
          (item) => [`${list}::${item.value}`, item.metadata ?? {}] as [string, Record<string, unknown>],
        );
      }),
    )
      .then((results) => {
        if (latest.current !== fetchKey) return;
        setBag(resolveLookupBag(requests, new Map(results.flat())));
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        if (latest.current !== fetchKey) return;
        // A failed fetch leaves every affected field blank rather than stale.
        // The server recomputes on submit regardless.
        setBag({});
      });

    return () => controller.abort();
    // `requests` and `resolvable` are derived from `fetchKey`'s inputs; keying
    // the effect on the string alone is what stops it re-running per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey, formSlug]);

  // Derived, not synchronised. A stale bag from a previous answer must never
  // survive into a render where nothing is being looked up — that is precisely
  // how an auto-filled field would keep showing the code of a school the
  // respondent has already changed away from.
  return fetchKey ? bag : EMPTY_BAG;
}

/** Stable identity, so a consumer's `useMemo` does not recompute per render. */
const EMPTY_BAG: Record<string, RuleValue> = {};
