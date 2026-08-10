'use client';

import { useMemo } from 'react';

import {
  compileRules,
  planIsEmpty,
  readPlan,
  runFormRules,
  EMPTY_PLAN,
  type CompiledPlan,
  type FormRule,
  type RuleValue,
} from '@/lib/rules';
import { hiddenByLegacyLogic, type LegacyLogicRule } from '@/lib/legacy-logic';
import { deriveQuestionKeys } from '@/lib/question-keys';
import { useChoiceLookups } from './use-choice-lookups';
import type { FormQuestion } from '@/types/form';

/**
 * Live rule evaluation in the browser.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The engine at `@/lib/rules` is a byte-for-byte mirror of the backend's, and
 * has been since it was written — but nothing on the client ever called it.
 * The compiled plan was shipped to the browser by the public form endpoint and
 * dropped on the floor, so a CALCULATE rule showed the respondent an empty
 * editable box, a SHOW rule hid nothing, and every VALIDATE message arrived as
 * a single anonymous error after submitting. This hook is the missing link.
 *
 * ── The client is a preview, not an authority ──────────────────────────────
 * Everything here is for the respondent's benefit only. The API re-runs the
 * identical plan on submit, strips every client-supplied value for a calculated
 * field first, and its answer is the one that is stored. A respondent who edits
 * the DOM to change a calculated value achieves nothing.
 *
 * ── Two plan shapes, one hook ──────────────────────────────────────────────
 * The runner is used in two places that hold rules in different forms:
 *
 *   • the PUBLIC form receives the COMPILED plan from the API — already
 *     validated, already topologically sorted, nothing to do but read it;
 *   • the BUILDER PREVIEW holds the AUTHORED rules straight out of the editor,
 *     which have never been compiled. Compiling them here is what lets an
 *     author watch a formula work before publishing it, and it is the same
 *     `compileRules` the publish endpoint runs, so the preview cannot flatter
 *     a rule set that would be rejected.
 *
 * A rule set that does not compile yields an empty plan rather than a partial
 * one: half-applied rules would show the author a form that behaves in a way
 * no published version ever will.
 */

export interface FormRulesInput {
  questions: FormQuestion[];
  /** Compiled plan (public form) or authored rules (builder preview). */
  rules: FormRule[] | CompiledPlan | Record<string, unknown> | null | undefined;
  /** Legacy show/hide rules, evaluated alongside the plan. */
  logic?: LegacyLogicRule[] | null;
  /** Raw answers keyed by question id, as the runner holds them. */
  answers: Record<string, unknown>;
  /** Cross-form `ref` values are resolved server-side only; blank in browser. */
  allowReferences?: boolean;
  /**
   * Public slug, so `lookup()` can be resolved for live auto-fill. Absent in
   * the builder preview, where those fields stay blank until submit.
   */
  formSlug?: string;
}

export interface FormRulesResult {
  /** True when neither system has anything to say — callers can skip work. */
  isInert: boolean;
  /**
   * Answers with calculated values written in, keyed by question id.
   *
   * This is what the runner renders and submits. It is never fed back into the
   * runner's own state: a calculated value is derived, so storing it would
   * create a value that outlives the inputs it came from.
   */
  answers: Record<string, unknown>;
  /** Hidden by a SHOW rule OR by a legacy HIDE rule. */
  hiddenQuestionIds: Set<string>;
  /** Made mandatory by a REQUIRE rule, on top of the question's own flag. */
  requiredQuestionIds: Set<string>;
  /** Owned by a CALCULATE rule — render these read-only. */
  calculatedQuestionIds: Set<string>;
  /** Triggered VALIDATE rules, keyed by the question the message hangs off. */
  violationsByQuestionId: Map<string, string[]>;
}

const EMPTY_SET: ReadonlySet<string> = new Set<string>();

/** A compiled plan is an object with rule buckets; authored rules are an array. */
function isAuthoredRuleList(value: unknown): value is FormRule[] {
  return Array.isArray(value);
}

export function useFormRules({
  questions,
  rules,
  logic,
  answers,
  allowReferences = false,
  formSlug,
}: FormRulesInput): FormRulesResult {
  // Keys must match the ones the plan was compiled against. For a published
  // form the server already assigned them; for an unsaved draft they are
  // derived with the server's own algorithm.
  const keyRows = useMemo(() => deriveQuestionKeys(questions ?? []), [questions]);

  const plan: CompiledPlan = useMemo(() => {
    if (!rules) return EMPTY_PLAN;

    if (isAuthoredRuleList(rules)) {
      const knownKeys = keyRows.map((row) => row.key);
      const compiled = compileRules(rules, { knownKeys, allowReferences });
      // An uncompilable set is treated as no rules at all — see the header.
      return compiled.ok ? compiled.plan : EMPTY_PLAN;
    }

    return readPlan(rules);
  }, [rules, keyRows, allowReferences]);

  // The plan addresses questions by key; `runFormRules` needs the id↔key pairs
  // to project answers in and results back out.
  const adapterQuestions = useMemo(
    () => keyRows.map((row) => ({ id: row.id, key: row.key, type: row.type })),
    [keyRows],
  );

  const legacyHidden = useMemo(
    () => hiddenByLegacyLogic(questions ?? [], logic, answers),
    [questions, logic, answers],
  );

  // Lookups address questions by key, so the answers must be projected before
  // the bag can be planned — the same projection `runFormRules` does below.
  const answersByKey = useMemo(() => {
    const byKey: Record<string, RuleValue> = {};
    for (const row of keyRows) {
      const value = answers[row.id];
      if (value !== undefined) byKey[row.key] = value as RuleValue;
    }
    return byKey;
  }, [keyRows, answers]);

  const lookups = useChoiceLookups({ formSlug, questions: questions ?? [], plan, answersByKey });

  return useMemo(() => {
    const planInert = planIsEmpty(plan);

    if (planInert && legacyHidden.size === 0) {
      return {
        isInert: true,
        answers,
        hiddenQuestionIds: EMPTY_SET as Set<string>,
        requiredQuestionIds: EMPTY_SET as Set<string>,
        calculatedQuestionIds: EMPTY_SET as Set<string>,
        violationsByQuestionId: new Map(),
      };
    }

    if (planInert) {
      return {
        isInert: false,
        answers,
        hiddenQuestionIds: legacyHidden,
        requiredQuestionIds: EMPTY_SET as Set<string>,
        calculatedQuestionIds: EMPTY_SET as Set<string>,
        violationsByQuestionId: new Map(),
      };
    }

    const evaluated = runFormRules({
      questions: adapterQuestions,
      plan,
      answersById: answers as Record<string, RuleValue>,
      lookups,
      // Cross-form references are resolved from the database before evaluation
      // and there is no database here. They read as `null`, which is exactly
      // what a subject with no prior submission yields server-side too.
      refs: {},
    });

    const hidden = new Set<string>(evaluated.hiddenQuestionIds);
    for (const id of legacyHidden) hidden.add(id);

    // A question hidden by either system cannot be answered, so requiring it
    // would deadlock the respondent on a field they cannot see. The engine
    // already applies this for its own SHOW rules; repeating it here covers
    // the case where the legacy system is what hid it.
    const required = new Set<string>();
    for (const id of evaluated.requiredQuestionIds) {
      if (!hidden.has(id)) required.add(id);
    }

    const violationsByQuestionId = new Map<string, string[]>();
    for (const violation of evaluated.violations) {
      // A violation on a hidden question is not actionable — the respondent
      // cannot see the field the message hangs off.
      if (hidden.has(violation.questionId)) continue;
      const existing = violationsByQuestionId.get(violation.questionId);
      if (existing) existing.push(violation.message);
      else violationsByQuestionId.set(violation.questionId, [violation.message]);
    }

    return {
      isInert: false,
      answers: evaluated.answersById as Record<string, unknown>,
      hiddenQuestionIds: hidden,
      requiredQuestionIds: required,
      calculatedQuestionIds: evaluated.calculatedQuestionIds,
      violationsByQuestionId,
    };
  }, [plan, adapterQuestions, answers, legacyHidden, lookups]);
}
