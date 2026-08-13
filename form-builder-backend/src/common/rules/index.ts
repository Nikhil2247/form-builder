/**
 * Rules engine — public surface.
 *
 * Pure TypeScript with no dependency on Nest, Prisma, or any library. That is
 * deliberate: the identical code is intended to run in the browser for live
 * calculation and preview, so lifting this directory into a shared package is a
 * file move rather than a rewrite. Do not import framework code here.
 *
 * Typical use:
 *   • at publish  — `compileRules(rules, { knownKeys, allowReferences })`
 *   • at submit   — `applyRules({ plan, answers, refs, evalTime })`
 */

export * from './ast';
export {
  OPERATORS,
  isKnownOperator,
  truthy,
  toNumber,
  toText,
  toDate,
} from './operators';
export type { OpContext, OperatorDef } from './operators';
export {
  evaluate,
  evaluateSafe,
  createBudget,
  EVAL_LIMITS,
  RuleBudgetExceededError,
} from './interpreter';
export type { EvalContext, EvalBudget, SafeEvalResult } from './interpreter';
export { compileRules, COMPILE_LIMITS } from './compiler';
export type {
  CompiledPlan,
  CompileError,
  CompileResult,
  CompileOptions,
} from './compiler';
export { applyRules } from './engine';
export type { ApplyRulesInput, ApplyRulesResult, RuleFailure } from './engine';
export { planLookupRequests, resolveLookupBag } from './lookup-bag';
export type { LookupRequest } from './lookup-bag';
export {
  runFormRules,
  readPlan,
  planIsEmpty,
  buildKeyMaps,
  EMPTY_PLAN,
} from './form-adapter';
export type {
  AdapterQuestion,
  RunFormRulesInput,
  RunFormRulesResult,
} from './form-adapter';
