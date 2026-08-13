import { createHash } from 'node:crypto';

/**
 * Step scope — what "how many times is this filled" is measured against.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A step's `minEntries` / `maxEntries` / `uniqueBy` used to be counted within
 * one sitting. For a programme that repeats over time that is the wrong window,
 * and it made existing configuration quietly dishonest: `maxEntries: 6` on a
 * monthly progress check meant six per SITTING rather than six per student, and
 * `uniqueBy: ["month_number"]` compared only entries staged side by side, so
 * month 3 could be entered twice in two different sessions without complaint.
 *
 * `scope` names the window:
 *   SESSION         — within one sitting. The original behaviour, still default.
 *   SUBJECT         — across the record's whole history. "Registered once, ever."
 *   SUBJECT_PERIOD  — per record, per reporting period. "One check a month."
 *
 * ── Why an occurrence key, and not just a count ────────────────────────────
 * Counting cannot make a duplicate impossible. Two coordinators submitting
 * March for the same student at the same instant both read a count of zero and
 * both pass. The occurrence key turns "which repeat is this" into a value, and
 * a partial UNIQUE index on (subject_id, form_app_step_id, occurrence_key)
 * makes the second writer fail at the database rather than succeed at being
 * wrong. Everything here exists to compute that value identically every time.
 */

export type StepScope = 'SESSION' | 'SUBJECT' | 'SUBJECT_PERIOD';
export type StepMode = 'SINGLE' | 'REPEATABLE';

/** The shape of a step this module needs. Deliberately structural. */
export interface ScopedStep {
  id: string;
  key: string;
  title: string;
  mode: StepMode;
  scope: StepScope;
  minEntries: number;
  maxEntries: number | null;
  isOptional: boolean;
  uniqueBy: unknown;
  occurredAtKey?: string | null;
}

/** One prior submission, projected to only what scope decisions need. */
export interface HistoryRow {
  formAppStepId: string | null;
  periodId: string | null;
  occurrenceKey: string | null;
  occurredAt: Date;
}

/** Prior entries for one subject, indexed for the questions we actually ask. */
export class SubjectHistory {
  /** stepId → total entries, all time. */
  private readonly byStep = new Map<string, number>();
  /** `stepId:periodId` → entries in that period. */
  private readonly byStepPeriod = new Map<string, number>();
  /** stepId → occurrence keys already taken. */
  private readonly keysByStep = new Map<string, Set<string>>();
  /** stepId → most recent occurrence. */
  private readonly lastByStep = new Map<string, Date>();

  constructor(rows: HistoryRow[]) {
    for (const row of rows) {
      const stepId = row.formAppStepId;
      if (!stepId) continue;

      this.byStep.set(stepId, (this.byStep.get(stepId) ?? 0) + 1);

      const periodKey = `${stepId}:${row.periodId ?? 'none'}`;
      this.byStepPeriod.set(
        periodKey,
        (this.byStepPeriod.get(periodKey) ?? 0) + 1,
      );

      if (row.occurrenceKey) {
        let set = this.keysByStep.get(stepId);
        if (!set) this.keysByStep.set(stepId, (set = new Set()));
        set.add(row.occurrenceKey);
      }

      const last = this.lastByStep.get(stepId);
      if (!last || row.occurredAt > last) {
        this.lastByStep.set(stepId, row.occurredAt);
      }
    }
  }

  /** Nothing recorded — the shape a brand-new subject has. */
  static empty() {
    return new SubjectHistory([]);
  }

  /**
   * How many entries already exist for this step, in its own scope.
   *
   * SESSION-scoped steps always answer zero: their history is the current
   * sitting, which the caller holds and this class never sees.
   */
  countFor(step: ScopedStep, periodId: string | null): number {
    if (step.scope === 'SESSION') return 0;
    if (step.scope === 'SUBJECT') return this.byStep.get(step.id) ?? 0;
    return this.byStepPeriod.get(`${step.id}:${periodId ?? 'none'}`) ?? 0;
  }

  /** Is this occurrence already taken by a previous session? */
  hasOccurrence(stepId: string, occurrenceKey: string): boolean {
    return this.keysByStep.get(stepId)?.has(occurrenceKey) ?? false;
  }

  lastOccurredAt(stepId: string): Date | null {
    return this.lastByStep.get(stepId) ?? null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/** `maxEntries`, with SINGLE's implicit ceiling of one folded in. */
export function effectiveMax(step: ScopedStep): number | null {
  if (step.mode === 'SINGLE') return 1;
  return step.maxEntries;
}

/** `minEntries`, with `isOptional` and SINGLE's implicit floor folded in. */
export function effectiveMin(step: ScopedStep): number {
  if (step.isOptional) return 0;
  return Math.max(step.minEntries, step.mode === 'SINGLE' ? 1 : 0);
}

export function uniqueByKeys(step: ScopedStep): string[] {
  return Array.isArray(step.uniqueBy) ? (step.uniqueBy as string[]) : [];
}

/** One answer, flattened to a stable comparable string. */
function readAnswer(
  answers: Record<string, unknown>,
  keyToId: Map<string, string>,
  key: string,
): string {
  const id = keyToId.get(key);
  const value = id ? answers[id] : undefined;
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(stableString).join(',');
  return stableString(value);
}

/**
 * One answer value as a stable string.
 *
 * ── Why not just `String(value)` ───────────────────────────────────────────
 * It was, and that is a correctness bug rather than a lint nit, because this
 * function feeds `occurrenceKey` — the value that decides whether two entries
 * are THE SAME entry. An answer can legitimately be an object: a FILE_UPLOAD
 * answer, a repeating-section answer, an address. `String({...})` returns
 * "[object Object]" for every one of them, so two entries with completely
 * different object answers produce identical keys and the uniqueness check
 * silently treats them as duplicates — rejecting a second school visit because
 * its attachment "matched" the first one's.
 *
 * Object keys are sorted so that `{a:1,b:2}` and `{b:2,a:1}` — the same answer,
 * serialised in whatever order the client happened to send — compare equal. An
 * unsorted JSON.stringify would make key equality depend on property order,
 * which is exactly the kind of instability an identity value must not have.
 */
function stableString(value: unknown): string {
  if (value === null || value === undefined) return '';

  // Narrowed to the primitives an answer can actually be, rather than to
  // "not an object". `String(aSymbol)` throws, and a function would stringify
  // to its source text — neither is reachable from JSON respondent input, but
  // an identity value is the wrong place to rely on that.
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }
  if (typeof value !== 'object') return '';

  return JSON.stringify(value, (_key, val: unknown) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      return Object.fromEntries(
        Object.entries(val as Record<string, unknown>).sort(([a], [b]) =>
          a < b ? -1 : a > b ? 1 : 0,
        ),
      );
    }
    return val;
  });
}

/**
 * The identity of this repeat, or NULL when the step has no cross-session
 * identity to speak of.
 *
 * Three sources, in order:
 *
 *  1. `uniqueBy` answers — "month 3", "final assessment". The explicit case.
 *  2. Failing that, a step that may exist at most ONCE in its scope is its own
 *     identity. This is what turns "registered once, ever" and "one check per
 *     month" into database guarantees rather than hopes, without asking the
 *     author to nominate a key that would only ever hold one value.
 *  3. Otherwise NULL: a step allowing three unkeyed entries has no way to say
 *     which of the three a new one is, so only the count can govern it.
 *
 * The period is folded into the key for SUBJECT_PERIOD scope and deliberately
 * NOT for SUBJECT. Without it, `uniqueBy: ["month_number"]` on a per-period
 * step would let January–June's "month 3" block July–December's, which is
 * precisely the cycle boundary the scope exists to draw.
 */
export function occurrenceKeyFor(
  step: ScopedStep,
  periodId: string | null,
  answers: Record<string, unknown>,
  keyToId: Map<string, string>,
): string | null {
  if (step.scope === 'SESSION') return null;

  const parts: string[] = [`step=${step.id}`];
  if (step.scope === 'SUBJECT_PERIOD') {
    parts.push(`period=${periodId ?? 'none'}`);
  }

  const keys = uniqueByKeys(step);
  const values = keys.map((key) => readAnswer(answers, keyToId, key));
  const hasAnyValue = values.some((value) => value.trim() !== '');

  if (keys.length > 0 && hasAnyValue) {
    keys.forEach((key, i) => {
      parts.push(`${key}=${values[i].trim().toLowerCase()}`);
    });
  } else if (keys.length > 0) {
    // Declared unique but entirely unanswered. Not an identity — the entry will
    // fail its own required-field check instead, and manufacturing a key from
    // emptiness would make every blank entry collide with every other.
    return null;
  } else if (effectiveMax(step) === 1) {
    parts.push('singleton');
  } else {
    return null;
  }

  return createHash('sha256')
    .update(parts.join('|'))
    .digest('hex')
    .slice(0, 40);
}

/**
 * A human name for the occurrence, for error messages and menu labels.
 * "Month 3", "Final assessment" — whatever the author keyed it by.
 */
export function occurrenceLabelFor(
  step: ScopedStep,
  answers: Record<string, unknown>,
  keyToId: Map<string, string>,
): string | null {
  const values = uniqueByKeys(step)
    .map((key) => readAnswer(answers, keyToId, key).trim())
    .filter(Boolean);
  return values.length > 0 ? values.join(' · ') : null;
}

/**
 * The real-world date of this entry, from the step's nominated question.
 *
 * Falls back to the submission time whenever the step nominates no question,
 * the answer is blank, or the value is not a date we can read. A visit recorded
 * with an unparseable date still happened; refusing the submission over it, or
 * storing a null and sorting it last, both serve the operator worse than
 * assuming it happened when it was typed.
 */
export function occurredAtFor(
  step: ScopedStep,
  answers: Record<string, unknown>,
  keyToId: Map<string, string>,
  fallback: Date,
): Date {
  if (!step.occurredAtKey) return fallback;

  const raw = readAnswer(answers, keyToId, step.occurredAtKey).trim();
  if (!raw) return fallback;

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return fallback;

  // A date typed as 2026-02-14 parses as UTC midnight, which is correct for a
  // day-granularity record. Guard only against values so far out that they are
  // certainly a typo rather than a backdated entry.
  const year = parsed.getUTCFullYear();
  if (year < 1900 || year > 2200) return fallback;

  return parsed;
}
