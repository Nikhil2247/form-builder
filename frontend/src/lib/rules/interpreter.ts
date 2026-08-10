/**
 * Expression interpreter.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A post-order walk over the AST. No special forms, no short-circuiting, no
 * recursion the author can influence: the tree's shape is fixed at publish
 * time and its depth is capped by the compiler, so this cannot blow the stack.
 *
 * PURE. The only inputs are the context object and the tree. `today()` reads
 * `ctx.evalTime` rather than the clock, and cross-form values arrive
 * pre-resolved in `ctx.refs` — the interpreter never performs I/O. That is what
 * lets the server reproduce exactly what the browser showed the respondent.
 */

import {
  type ExprNode,
  type RuleValue,
  isField,
  isLiteral,
  isOp,
  isRef,
  refKey,
} from './ast';
import { OPERATORS, type OpContext } from './operators';

/** Ceilings that apply while evaluating, independent of the compiler's static caps. */
export const EVAL_LIMITS = {
  /**
   * Nodes visited per submission, across all rules.
   *
   * The compiler already bounds each tree, so this is the belt-and-braces
   * ceiling for a form carrying many large rules. Exceeding it aborts rather
   * than letting one submission occupy a worker indefinitely.
   */
  maxSteps: 10_000,
  /** Longest string any single operator may return. */
  maxStringLength: 10_000,
} as const;

export interface EvalContext extends OpContext {
  /** Answers on the current form, keyed by question key. */
  fields: Record<string, RuleValue>;
  /**
   * Cross-form values, keyed by `refKey()`. Populated server-side before
   * evaluation. A missing entry is `null`, never an error — the subject may
   * genuinely have no prior submission of that form.
   */
  refs: Record<string, RuleValue>;
  /**
   * Choice-list column values, pre-resolved and keyed by `lookupKey()`.
   *
   * Same contract as `refs`: filled by the caller before evaluation, read-only
   * here. A missing entry is `null`, never an error — the respondent may not
   * have picked an item yet, or the item may have nothing in that column.
   */
  lookups?: Record<string, RuleValue>;
}

/** Raised only for budget exhaustion. Never for bad data — operators are total. */
export class RuleBudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuleBudgetExceededError';
  }
}

/** Mutable step counter, shared across every rule in one submission. */
export interface EvalBudget {
  steps: number;
}

export function createBudget(): EvalBudget {
  return { steps: 0 };
}

/**
 * Evaluate one expression.
 *
 * Throws only `RuleBudgetExceededError`. Callers decide what a budget failure
 * means per rule kind — see `evaluateSafe`, which is what production code
 * should use.
 */
export function evaluate(
  node: ExprNode,
  ctx: EvalContext,
  budget: EvalBudget = createBudget(),
): RuleValue {
  if (++budget.steps > EVAL_LIMITS.maxSteps) {
    throw new RuleBudgetExceededError(
      `Rule evaluation exceeded ${EVAL_LIMITS.maxSteps} steps.`,
    );
  }

  if (isLiteral(node)) return node.lit;

  if (isField(node)) {
    // An unanswered or unknown question is null, not an error: rules are
    // evaluated continuously as the respondent types, so most fields are
    // empty most of the time.
    const value = ctx.fields[node.field];
    return value === undefined ? null : value;
  }

  if (isRef(node)) {
    const value = ctx.refs[refKey(node.ref)];
    return value === undefined ? null : value;
  }

  if (isOp(node)) {
    const def = OPERATORS[node.op];
    // Unreachable via a published form — the compiler rejects unknown
    // operators. Guarded anyway so a hand-edited row degrades to null rather
    // than throwing on the submit path.
    if (!def) return null;

    const args = node.args.map((arg) => evaluate(arg, ctx, budget));
    const result = def.fn(args, ctx);

    if (typeof result === 'string' && result.length > EVAL_LIMITS.maxStringLength) {
      throw new RuleBudgetExceededError(
        `Operator "${node.op}" produced a string longer than ${EVAL_LIMITS.maxStringLength} characters.`,
      );
    }

    return result;
  }

  return null;
}

export interface SafeEvalResult {
  value: RuleValue;
  /** Set when evaluation aborted. The caller applies its fail-closed default. */
  error?: string;
}

/**
 * Evaluate without throwing.
 *
 * Production callers use this. Avni treats a failed rule as `true`, which means
 * a broken visibility rule reveals a field and a broken eligibility check grants
 * access. We return the failure explicitly so each rule kind can fail CLOSED —
 * see `applyRules` in engine.ts.
 */
export function evaluateSafe(
  node: ExprNode,
  ctx: EvalContext,
  budget: EvalBudget = createBudget(),
): SafeEvalResult {
  try {
    return { value: evaluate(node, ctx, budget) };
  } catch (error) {
    return {
      value: null,
      error: error instanceof Error ? error.message : 'Rule evaluation failed.',
    };
  }
}
