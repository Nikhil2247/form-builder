/**
 * Bridge between stored answers and the rules engine.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Two different addressing schemes meet here, and keeping them separate is
 * deliberate:
 *
 *   • Answers are keyed by question **id** — an opaque, permanent handle. It is
 *     the join key for every response ever recorded, so it can never change.
 *   • Rules address questions by **key** — a readable name derived from the
 *     label, so a formula says `yearsBetween(dob, today())`. Keys are meant to
 *     be renameable.
 *
 * Merging the two would force a choice between unreadable formulas and
 * rewriting historical answers whenever a label changes. This module translates
 * instead: project answers id→key, run the plan, map results back key→id.
 *
 * Pure functions, no imports beyond the engine itself.
 */

import type { CompiledPlan } from './compiler';
import type { RuleValue } from './ast';
import { applyRules, type RuleFailure } from './engine';

export interface AdapterQuestion {
  id: string;
  key?: string;
  type?: string;
}

export interface RunFormRulesInput {
  /** FormVersion.questionsJson — needs at least id and key on each entry. */
  questions: AdapterQuestion[];
  plan: CompiledPlan;
  /** Answers keyed by question id. */
  answersById: Record<string, RuleValue>;
  /** Pre-resolved cross-form values, keyed by `refKey()`. */
  refs?: Record<string, RuleValue>;
  /** Pre-resolved choice-list column values, keyed by `lookupKey()`. */
  lookups?: Record<string, RuleValue>;
  evalTime?: Date;
}

export interface RunFormRulesResult {
  /** Answers with calculated values written back under their question ids. */
  answersById: Record<string, RuleValue>;
  /** Question ids hidden by a SHOW rule — their answers must not be persisted. */
  hiddenQuestionIds: Set<string>;
  /** Question ids made mandatory by a REQUIRE rule. */
  requiredQuestionIds: Set<string>;
  /** Question ids whose value the engine owns; strip these from client input. */
  calculatedQuestionIds: Set<string>;
  /** Triggered validation rules, addressed by question id. */
  violations: Array<RuleFailure & { questionId: string }>;
  /** Rules that failed to evaluate. Operational signal, not respondent-facing. */
  errors: RuleFailure[];
}

/** Empty plan — used when a form version predates rules or has none. */
export const EMPTY_PLAN: CompiledPlan = {
  calculations: [],
  show: [],
  require: [],
  validate: [],
  references: [],
  calculatedKeys: [],
  lookups: [],
};

/**
 * Read a stored plan defensively.
 *
 * Versions published before this feature have `{}` in the column, and a
 * hand-edited row could hold anything. A malformed plan degrades to "no rules"
 * rather than throwing on the submit path — the compiler is what guarantees a
 * plan is well-formed, and it already ran at publish.
 */
export function readPlan(stored: unknown): CompiledPlan {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored))
    return EMPTY_PLAN;

  const raw = stored as Partial<CompiledPlan>;
  const list = (v: unknown) => (Array.isArray(v) ? v : []);

  return {
    calculations: list(raw.calculations),
    show: list(raw.show),
    require: list(raw.require),
    validate: list(raw.validate),
    references: list(raw.references),
    calculatedKeys: list(raw.calculatedKeys).filter(
      (k): k is string => typeof k === 'string',
    ),
    // Absent on every plan compiled before choice lists existed, which is the
    // common case for a while yet.
    lookups: list(raw.lookups),
  };
}

/** True when a plan would do nothing, so callers can skip the work entirely. */
export function planIsEmpty(plan: CompiledPlan): boolean {
  return (
    plan.calculations.length === 0 &&
    plan.show.length === 0 &&
    plan.require.length === 0 &&
    plan.validate.length === 0
  );
}

export function buildKeyMaps(questions: AdapterQuestion[]): {
  idByKey: Map<string, string>;
  keyById: Map<string, string>;
} {
  const idByKey = new Map<string, string>();
  const keyById = new Map<string, string>();

  for (const question of questions) {
    if (!question || typeof question.id !== 'string') continue;
    // Versions published before keys existed fall back to the id, so a rule
    // authored against such a version still resolves rather than silently
    // reading null.
    const key =
      typeof question.key === 'string' && question.key
        ? question.key
        : question.id;
    if (!idByKey.has(key)) idByKey.set(key, question.id);
    keyById.set(question.id, key);
  }

  return { idByKey, keyById };
}

/**
 * Run a compiled plan against id-keyed answers.
 *
 * Note the engine is handed answers with calculated fields ALREADY REMOVED.
 * `applyRules` would overwrite them anyway, but stripping first means a
 * client-supplied value cannot be read by another rule in the same pass —
 * otherwise a respondent could still influence a calculation indirectly.
 */
export function runFormRules(input: RunFormRulesInput): RunFormRulesResult {
  const { questions, plan, answersById } = input;
  const { idByKey, keyById } = buildKeyMaps(questions);

  const calculatedQuestionIds = new Set<string>();
  for (const key of plan.calculatedKeys) {
    const id = idByKey.get(key);
    if (id) calculatedQuestionIds.add(id);
  }

  // Project id-keyed answers into key-keyed, dropping anything the engine owns.
  const answersByKey: Record<string, RuleValue> = {};
  for (const [questionId, value] of Object.entries(answersById)) {
    if (calculatedQuestionIds.has(questionId)) continue;
    const key = keyById.get(questionId);
    if (key) answersByKey[key] = value;
  }

  const applied = applyRules({
    plan,
    answers: answersByKey,
    refs: input.refs,
    lookups: input.lookups,
    evalTime: input.evalTime,
  });

  // Map back. Only calculated keys are written to the answer set — everything
  // else already came from the client and must not be rewritten by projection.
  const merged: Record<string, RuleValue> = { ...answersById };
  for (const key of plan.calculatedKeys) {
    const id = idByKey.get(key);
    if (!id) continue;
    merged[id] = applied.answers[key] ?? null;
  }

  const toIds = (keys: Iterable<string>): Set<string> => {
    const ids = new Set<string>();
    for (const key of keys) {
      const id = idByKey.get(key);
      if (id) ids.add(id);
    }
    return ids;
  };

  return {
    answersById: merged,
    hiddenQuestionIds: toIds(applied.hidden),
    requiredQuestionIds: toIds(applied.required),
    calculatedQuestionIds,
    violations: applied.violations.map((violation) => ({
      ...violation,
      questionId: idByKey.get(violation.target) ?? violation.target,
    })),
    errors: applied.errors,
  };
}
