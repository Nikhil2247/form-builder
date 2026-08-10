/**
 * Applying a compiled plan to a set of answers.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * One function, used by both sides:
 *   • the browser calls it on every keystroke, to show calculated values and
 *     hide irrelevant questions;
 *   • the API calls it before persisting, and its result is the one that counts.
 *
 * TWO PROPERTIES THIS FILE EXISTS TO GUARANTEE
 *
 * 1. Calculated values are always recomputed, never taken from the caller.
 *    `applyRules` writes every calculated key from its own evaluation. The API
 *    additionally strips those keys from client input beforehand, so a
 *    respondent POSTing {"age": 4} to clear an eligibility gate achieves
 *    nothing. This also makes stale values unrepresentable — there is no path
 *    where a previously-computed value survives a change to its inputs.
 *
 * 2. Rules fail CLOSED.
 *    Avni treats a rule that errors as `true`, so a broken visibility rule
 *    reveals a field and a broken eligibility rule grants access. Each kind
 *    here degrades to its safe direction instead (see FAILURE MODES below).
 */

import type { CompiledPlan } from './compiler';
import type { RuleValue } from './ast';
import {
  createBudget,
  evaluateSafe,
  type EvalContext,
  type EvalBudget,
} from './interpreter';
import { truthy } from './operators';

export interface ApplyRulesInput {
  plan: CompiledPlan;
  /** Raw answers keyed by question key. Calculated keys are ignored. */
  answers: Record<string, RuleValue>;
  /** Pre-resolved cross-form values, keyed by `refKey()`. */
  refs?: Record<string, RuleValue>;
  /** Pre-resolved choice-list column values, keyed by `lookupKey()`. */
  lookups?: Record<string, RuleValue>;
  /** Defaults to now. Pass explicitly so server and client agree. */
  evalTime?: Date;
}

export interface RuleFailure {
  ruleId: string;
  target: string;
  message: string;
}

export interface ApplyRulesResult {
  /** Answers with calculated values written in. */
  answers: Record<string, RuleValue>;
  /** Keys hidden by a SHOW rule. Their values must not be persisted. */
  hidden: Set<string>;
  /** Keys made mandatory by a REQUIRE rule. */
  required: Set<string>;
  /** Triggered VALIDATE rules — each is a reason to reject the submission. */
  violations: RuleFailure[];
  /**
   * Rules that could not be evaluated. Not shown to respondents; these are
   * bugs to fix. Each has already been applied in its fail-closed direction.
   */
  errors: RuleFailure[];
}

/**
 * FAILURE MODES — what happens when a rule cannot be evaluated:
 *
 *   CALCULATE  target becomes null      (never a stale or partial value)
 *   SHOW       target is hidden         (never reveal on error)
 *   REQUIRE    target is NOT required   (a broken rule must not make a form
 *                                        impossible to submit)
 *   VALIDATE   submission is REJECTED   (never accept unvalidated data)
 */
export function applyRules(input: ApplyRulesInput): ApplyRulesResult {
  const { plan } = input;
  const evalTime = input.evalTime ?? new Date();
  const budget: EvalBudget = createBudget();

  const answers: Record<string, RuleValue> = { ...input.answers };
  const hidden = new Set<string>();
  const required = new Set<string>();
  const violations: RuleFailure[] = [];
  const errors: RuleFailure[] = [];

  const ctx: EvalContext = {
    fields: answers,
    refs: input.refs ?? {},
    lookups: input.lookups ?? {},
    evalTime,
  };

  // ── 1. Calculations, in dependency order ────────────────────────────────
  // `ctx.fields` aliases `answers`, so each write is visible to the rules that
  // follow. The compiler's topological sort is what makes that correct rather
  // than order-dependent — and is why derived values cascade here, unlike
  // Avni's non-transitive form-element rules.
  for (const rule of plan.calculations) {
    const { value, error } = evaluateSafe(rule.expr, ctx, budget);
    answers[rule.target] = error ? null : value;
    if (error) {
      errors.push({ ruleId: rule.id, target: rule.target, message: error });
    }
  }

  // ── 2. Visibility ───────────────────────────────────────────────────────
  // Multiple SHOW rules on one target are OR-ed: any satisfied rule reveals it.
  // A target with no SHOW rule is visible by default.
  const showEvaluations = new Map<string, boolean>();
  for (const rule of plan.show) {
    const { value, error } = evaluateSafe(rule.expr, ctx, budget);
    if (error) {
      errors.push({ ruleId: rule.id, target: rule.target, message: error });
      // Fail closed: contributes nothing, so the target stays hidden unless
      // another rule shows it.
      showEvaluations.set(rule.target, showEvaluations.get(rule.target) ?? false);
      continue;
    }
    showEvaluations.set(rule.target, (showEvaluations.get(rule.target) ?? false) || truthy(value));
  }
  for (const [target, visible] of showEvaluations) {
    if (!visible) hidden.add(target);
  }

  // ── 3. Conditional requirement ──────────────────────────────────────────
  for (const rule of plan.require) {
    const { value, error } = evaluateSafe(rule.expr, ctx, budget);
    if (error) {
      errors.push({ ruleId: rule.id, target: rule.target, message: error });
      continue; // Not required — a broken rule must not block submission.
    }
    // A hidden question cannot be answered, so requiring it would deadlock the
    // respondent on a field they cannot see.
    if (truthy(value) && !hidden.has(rule.target)) required.add(rule.target);
  }

  // ── 4. Validation ───────────────────────────────────────────────────────
  // The expression describes the PROBLEM: true means reject.
  for (const rule of plan.validate) {
    const { value, error } = evaluateSafe(rule.expr, ctx, budget);
    if (error) {
      errors.push({ ruleId: rule.id, target: rule.target, message: error });
      violations.push({
        ruleId: rule.id,
        target: rule.target,
        message: 'This entry could not be validated. Please contact the form owner.',
      });
      continue;
    }
    if (truthy(value)) {
      violations.push({
        ruleId: rule.id,
        target: rule.target,
        message: rule.message ?? 'This entry is not valid.',
      });
    }
  }

  return { answers, hidden, required, violations, errors };
}
