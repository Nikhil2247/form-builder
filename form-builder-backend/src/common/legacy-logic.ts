/**
 * Legacy conditional logic (`form.logic`) — the shared evaluator.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This is the show/hide system that predates the rules engine. It is still the
 * only one most existing forms use, so it cannot simply be dropped.
 *
 * WHY THIS FILE EXISTS
 *
 * The evaluation used to live inline in `FormRunner`, and the API had no
 * equivalent at all. The submit path derived `visibleQuestionIds` purely from
 * the compiled rule plan, so a question hidden by a legacy HIDE rule was
 * invisible to the respondent but still considered visible by the validator.
 * If that question was also required, the submission was rejected with
 * "X is required" for a field the respondent was never shown, and there was
 * no way for them to satisfy it. This module is evaluated by BOTH sides so the
 * two cannot disagree.
 *
 * DEPENDENCY RULE: pure TypeScript over plain objects, mirrored byte-for-byte
 * at `frontend/src/lib/legacy-logic.ts`. It imports nothing — not Nest, not
 * Prisma — so the identical code runs in the browser. Keep it that way, and
 * change the two copies together.
 */

export type LegacyOperator =
  | 'EQUALS'
  | 'NOT_EQUALS'
  | 'CONTAINS'
  | 'GREATER_THAN'
  | 'LESS_THAN'
  | 'IS_FILLED';

export type LegacyAction = 'SHOW' | 'HIDE' | 'JUMP_TO_PAGE';

export interface LegacyLogicRule {
  id: string;
  triggerQuestionId: string;
  operator: LegacyOperator;
  value: string;
  action: LegacyAction;
  targetQuestionId?: string;
  targetPageNumber?: number;
}

/** Only the fields this evaluator reads. */
export interface LegacyLogicQuestion {
  id: string;
}

function isAnswered(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

/**
 * Compare an answer against a rule's value.
 *
 * The rule's `value` is ALWAYS a string — `normalizeLogic` stores it as one and
 * the builder's inputs produce one. Answers are not: NPS and star ratings are
 * numbers, multi-choice is an array. A strict `===` therefore silently failed
 * for every numeric question, which is why this compares numerically whenever
 * both sides parse as numbers before falling back to text.
 */
function looseMatches(answer: unknown, value: string): boolean {
  if (Array.isArray(answer))
    return answer.some((item) => looseMatches(item, value));
  if (answer === undefined || answer === null) return false;

  if (typeof answer === 'number' || typeof answer === 'boolean') {
    const asNumber = Number(value);
    if (
      typeof answer === 'number' &&
      value.trim() !== '' &&
      Number.isFinite(asNumber)
    ) {
      return answer === asNumber;
    }
    return String(answer) === value;
  }

  if (typeof answer === 'string') {
    if (answer === value) return true;
    const a = Number(answer);
    const b = Number(value);
    if (
      answer.trim() !== '' &&
      value.trim() !== '' &&
      Number.isFinite(a) &&
      Number.isFinite(b)
    ) {
      return a === b;
    }
    return false;
  }

  return false;
}

function conditionMet(rule: LegacyLogicRule, answer: unknown): boolean {
  switch (rule.operator) {
    case 'EQUALS':
      return looseMatches(answer, rule.value);

    case 'NOT_EQUALS':
      return !looseMatches(answer, rule.value);

    case 'CONTAINS':
      if (Array.isArray(answer)) return looseMatches(answer, rule.value);
      return (
        typeof answer === 'string' &&
        answer.toLowerCase().includes(rule.value.toLowerCase())
      );

    case 'IS_FILLED':
      return isAnswered(answer);

    case 'GREATER_THAN': {
      const a = Number(answer);
      const b = Number(rule.value);
      return Number.isFinite(a) && Number.isFinite(b) && a > b;
    }

    case 'LESS_THAN': {
      const a = Number(answer);
      const b = Number(rule.value);
      return Number.isFinite(a) && Number.isFinite(b) && a < b;
    }

    default:
      // An operator we do not recognise must not reveal anything. Returning
      // false leaves a SHOW rule unsatisfied and a HIDE rule inactive.
      return false;
  }
}

/**
 * Question ids hidden by the legacy logic rules, given the current answers.
 *
 * Semantics, unchanged from the runner's original inline version:
 *   • a question with no rules targeting it is visible;
 *   • if ANY rule targeting it is a SHOW, it starts hidden and a satisfied
 *     SHOW reveals it;
 *   • otherwise it starts visible and a satisfied HIDE conceals it;
 *   • rules are applied in order, so a later satisfied rule wins.
 *
 * `JUMP_TO_PAGE` rules carry no `targetQuestionId` and are ignored here.
 */
export function hiddenByLegacyLogic(
  questions: readonly LegacyLogicQuestion[],
  logic: readonly LegacyLogicRule[] | null | undefined,
  answers: Readonly<Record<string, unknown>>,
): Set<string> {
  const hidden = new Set<string>();
  if (!Array.isArray(logic) || logic.length === 0) return hidden;

  const byTarget = new Map<string, LegacyLogicRule[]>();
  for (const rule of logic) {
    if (!rule || rule.action === 'JUMP_TO_PAGE') continue;
    const target = rule.targetQuestionId;
    if (!target) continue;
    const list = byTarget.get(target);
    if (list) list.push(rule);
    else byTarget.set(target, [rule]);
  }

  for (const question of questions) {
    const rules = byTarget.get(question.id);
    if (!rules || rules.length === 0) continue;

    let visible = !rules.some((rule) => rule.action === 'SHOW');

    for (const rule of rules) {
      if (!conditionMet(rule, answers[rule.triggerQuestionId])) continue;
      if (rule.action === 'SHOW') visible = true;
      if (rule.action === 'HIDE') visible = false;
    }

    if (!visible) hidden.add(question.id);
  }

  return hidden;
}
