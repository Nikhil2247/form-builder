/**
 * Working out which choice-list values a plan actually needs.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The compiler emits `plan.lookups` — the SPECS, e.g. "read `udise_code` from
 * `ng-schools`, for whatever `school_name` holds". A spec is only half a key:
 * the other half is the respondent's answer.
 *
 * This module does that pairing. It is deliberately separate from both the
 * server's database query and the browser's already-fetched items, because the
 * two must agree on exactly which triples are wanted and under exactly which
 * key they are filed. Computing that differently on either side would produce
 * a bag whose keys the interpreter never looks up — every auto-filled field
 * would silently read `null`, on one side only, which is the worst possible
 * shape for a bug of this kind.
 *
 * DEPENDENCY RULE: pure, no imports beyond the AST. Mirrored byte-for-byte at
 * `frontend/src/lib/rules/lookup-bag.ts`.
 */

import { lookupKey, type LookupSpec, type RuleValue } from './ast';

/** One concrete thing to fetch. */
export interface LookupRequest {
  /** ChoiceList.slug. */
  list: string;
  /** The value the respondent picked — matches ChoiceItem.value. */
  value: string;
  /** Key within ChoiceItem.metadata. */
  column: string;
  /** Where the resolved value must be filed. */
  key: string;
}

/**
 * Expand a plan's lookup specs against the current answers.
 *
 * @param specs    `plan.lookups`, as emitted by the compiler.
 * @param answers  Answers keyed by question KEY (not id) — the same projection
 *                 the interpreter sees.
 *
 * Unanswered questions and multi-value answers produce no request: there is no
 * single item to look up, and the operator returns `null` for both cases
 * anyway. De-duplicated, because two rules reading the same column of the same
 * item must not become two queries.
 */
export function planLookupRequests(
  specs: readonly LookupSpec[] | undefined,
  answers: Readonly<Record<string, RuleValue>>,
): LookupRequest[] {
  if (!specs || specs.length === 0) return [];

  const byKey = new Map<string, LookupRequest>();

  for (const spec of specs) {
    if (!spec || typeof spec.list !== 'string' || typeof spec.column !== 'string') continue;
    if (typeof spec.field !== 'string') continue;

    const answer = answers[spec.field];
    // Arrays (multi-choice) identify no single item; blanks identify none yet.
    if (answer === null || answer === undefined || Array.isArray(answer)) continue;

    const value =
      typeof answer === 'string'
        ? answer
        : typeof answer === 'number' || typeof answer === 'boolean'
          ? String(answer)
          : null;
    if (value === null || value === '') continue;

    const key = lookupKey(spec.list, value, spec.column);
    if (byKey.has(key)) continue;
    byKey.set(key, { list: spec.list, value, column: spec.column, key });
  }

  return [...byKey.values()];
}

/**
 * Build the interpreter's bag from fetched items.
 *
 * @param requests  What `planLookupRequests` asked for.
 * @param items     Whatever was found, keyed `list::value` — the caller's job,
 *                  because only it knows whether that came from Postgres or
 *                  from a cascade response already in memory.
 *
 * A request with no matching item still gets an entry, set to `null`. Filing
 * the miss explicitly rather than leaving a hole means the interpreter cannot
 * tell "not found" from "not resolved", which is correct: both mean the field
 * has no value, and neither is an error.
 */
export function resolveLookupBag(
  requests: readonly LookupRequest[],
  items: ReadonlyMap<string, Record<string, unknown>>,
): Record<string, RuleValue> {
  const bag: Record<string, RuleValue> = {};

  for (const request of requests) {
    const metadata = items.get(`${request.list}::${request.value}`);
    const raw = metadata ? metadata[request.column] : undefined;

    bag[request.key] =
      raw === undefined || raw === null
        ? null
        : typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean'
          ? raw
          : // Nested objects have no meaning in this value system; a column
            // holding one reads as absent rather than leaking a structure the
            // operators cannot work with.
            null;
  }

  return bag;
}
