/**
 * Rule compiler — runs at publish time, never on the submit path.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This is the payoff for rules being data instead of code: the whole rule set
 * can be checked before a respondent ever opens the form. We reject unknown
 * operators, unknown field keys, oversized trees, and — most importantly —
 * dependency cycles between calculated fields.
 *
 * Avni cannot do this. Its rules are JavaScript, so a cycle is undetectable
 * until runtime, where it manifests as a value that silently fails to update
 * (their calculated fields are non-transitive by design). Here a cycle fails
 * the publish with the cycle printed.
 *
 * Output is a CompiledPlan stored alongside the immutable FormVersion, so this
 * work happens once per publish and is served from cache thereafter.
 */

import {
  type ExprNode,
  type FormRule,
  type LookupSpec,
  type RefNode,
  RULE_KINDS,
  REF_WHEN_VALUES,
  isField,
  isLiteral,
  isOp,
  isRef,
  refKey,
} from './ast';
import { isKnownOperator, OPERATORS } from './operators';

/** Static ceilings, enforced here so they can never be hit at evaluation time. */
export const COMPILE_LIMITS = {
  maxNodesPerExpression: 256,
  maxDepth: 24,
  maxRulesPerForm: 200,
} as const;

export interface CompileError {
  /** Rule this error belongs to, or null for form-level problems. */
  ruleId: string | null;
  message: string;
}

export interface CompiledPlan {
  /**
   * CALCULATE rules in dependency order. Evaluating them front-to-back
   * guarantees every input is already computed — which is what makes derived
   * values transitive.
   */
  calculations: FormRule[];
  show: FormRule[];
  require: FormRule[];
  validate: FormRule[];
  /**
   * Every distinct cross-form reference the plan can make.
   *
   * Emitted so the resolver can batch its queries and so the reachable data set
   * is knowable statically — a rule cannot widen its own reach at runtime.
   */
  references: RefNode['ref'][];
  /** Keys this plan computes; the API strips these from client input. */
  calculatedKeys: string[];
  /**
   * Every distinct choice-list column this plan reads.
   *
   * Optional so a plan compiled before lookups existed still satisfies the
   * type — `readPlan` defaults it to an empty list.
   *
   * Like `references`, this is emitted so the resolver can batch its queries
   * and so the reachable data set is knowable statically. Unlike references,
   * a spec is only half a key: the resolver pairs each spec with the answer to
   * its `field` to produce the concrete `lookupKey()`.
   */
  lookups?: LookupSpec[];
}

export type CompileResult =
  { ok: true; plan: CompiledPlan } | { ok: false; errors: CompileError[] };

export interface CompileOptions {
  /** Question keys defined on the form version being published. */
  knownKeys: readonly string[];
  /**
   * False for forms not bound to a subject type. Cross-form references need a
   * subject to hang off, so they are rejected rather than silently null.
   */
  allowReferences: boolean;
  /**
   * Choice-list slugs a `lookup` may name.
   *
   * Undefined means "do not check" — used by callers that have no catalogue to
   * hand, such as the builder's live preview before the lists have loaded. The
   * publish path always supplies it, so a rule naming a list that does not
   * exist is rejected before a respondent can meet it.
   */
  knownChoiceLists?: readonly string[];
}

// ── Structural validation ───────────────────────────────────────────────────

interface WalkState {
  nodes: number;
  errors: string[];
  references: Map<string, RefNode['ref']>;
  lookups: Map<string, LookupSpec>;
  fieldsUsed: Set<string>;
}

function walk(
  node: ExprNode,
  depth: number,
  state: WalkState,
  options: CompileOptions,
): void {
  if (
    state.errors.length > 0 &&
    state.nodes > COMPILE_LIMITS.maxNodesPerExpression
  )
    return;

  if (depth > COMPILE_LIMITS.maxDepth) {
    state.errors.push(
      `Expression is nested deeper than ${COMPILE_LIMITS.maxDepth} levels.`,
    );
    return;
  }

  if (++state.nodes > COMPILE_LIMITS.maxNodesPerExpression) {
    state.errors.push(
      `Expression has more than ${COMPILE_LIMITS.maxNodesPerExpression} parts. Split it into several rules.`,
    );
    return;
  }

  if (node === null || typeof node !== 'object') {
    state.errors.push('Expression contains a malformed node.');
    return;
  }

  if (isLiteral(node)) {
    // Literals are author-typed constants; anything JSON-shaped is fine except
    // objects, which have no meaning in this value system.
    const value = node.lit;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      state.errors.push(
        'A fixed value must be text, a number, true/false, or a list.',
      );
    }
    return;
  }

  if (isField(node)) {
    if (typeof node.field !== 'string' || node.field === '') {
      state.errors.push('A field reference is missing its question.');
      return;
    }
    state.fieldsUsed.add(node.field);
    if (!options.knownKeys.includes(node.field)) {
      state.errors.push(
        `Rule refers to "${node.field}", which is not a question on this form.`,
      );
    }
    return;
  }

  if (isRef(node)) {
    const ref = node.ref;
    if (
      !ref ||
      typeof ref.form !== 'string' ||
      typeof ref.question !== 'string'
    ) {
      state.errors.push('A cross-form reference is incomplete.');
      return;
    }
    if (!REF_WHEN_VALUES.includes(ref.when)) {
      state.errors.push(
        `"${String(ref.when)}" is not a valid time period for a cross-form value.`,
      );
      return;
    }
    if (!options.allowReferences) {
      state.errors.push(
        'This form is not linked to a subject, so it cannot read values from other forms.',
      );
      return;
    }
    state.references.set(refKey(ref), ref);
    return;
  }

  if (isOp(node)) {
    if (typeof node.op !== 'string' || !isKnownOperator(node.op)) {
      state.errors.push(`"${String(node.op)}" is not a known operation.`);
      return;
    }
    if (!Array.isArray(node.args)) {
      state.errors.push(`Operation "${node.op}" is missing its inputs.`);
      return;
    }

    if (node.op === 'lookup') {
      validateLookup(node.args, state, options);
      // Its arguments are fully checked above and none of them may be a
      // nested expression, so there is nothing left to walk.
      return;
    }

    const def = OPERATORS[node.op];
    if (node.args.length < def.minArgs || node.args.length > def.maxArgs) {
      const expected =
        def.maxArgs === Infinity
          ? `at least ${def.minArgs}`
          : def.minArgs === def.maxArgs
            ? `exactly ${def.minArgs}`
            : `between ${def.minArgs} and ${def.maxArgs}`;
      state.errors.push(
        `Operation "${node.op}" takes ${expected} inputs but was given ${node.args.length}.`,
      );
      return;
    }

    for (const arg of node.args) walk(arg, depth + 1, state, options);
    return;
  }

  state.errors.push('Expression contains an unrecognised node.');
}

/**
 * `lookup(<list>, <field>, <column>)` — checked here rather than by the generic
 * operator path, because its argument SHAPES are part of its contract, not just
 * its arity.
 *
 * The middle argument must be a bare field reference. That restriction is what
 * keeps the interpreter free of I/O: it means every (list, value, column) triple
 * the plan can need is determined by the submitted answers alone, so the
 * resolver can fill the whole bag in one pass before evaluation begins. Allowing
 * an expression there would let one lookup's result feed another's key, which
 * needs iterative resolution and a depth analysis this compiler does not do.
 *
 * The outer arguments must be literals for the same reason — a computed list
 * name would not be knowable until evaluation.
 */
function validateLookup(
  args: ExprNode[],
  state: WalkState,
  options: CompileOptions,
): void {
  if (args.length !== 3) {
    state.errors.push(
      `Operation "lookup" takes exactly 3 inputs but was given ${args.length}.`,
    );
    return;
  }

  const [listNode, fieldNode, columnNode] = args;

  if (
    !isLiteral(listNode) ||
    typeof listNode.lit !== 'string' ||
    !listNode.lit
  ) {
    state.errors.push(
      'The list a lookup reads from must be chosen, not calculated.',
    );
    return;
  }
  if (
    !isLiteral(columnNode) ||
    typeof columnNode.lit !== 'string' ||
    !columnNode.lit
  ) {
    state.errors.push(
      'The column a lookup reads must be chosen, not calculated.',
    );
    return;
  }
  if (
    !isField(fieldNode) ||
    typeof fieldNode.field !== 'string' ||
    !fieldNode.field
  ) {
    state.errors.push(
      'A lookup must read the answer to a question directly — it cannot look up a calculated value.',
    );
    return;
  }

  const list = listNode.lit;
  const column = columnNode.lit;
  const field = fieldNode.field;

  state.fieldsUsed.add(field);
  if (!options.knownKeys.includes(field)) {
    state.errors.push(
      `Rule refers to "${field}", which is not a question on this form.`,
    );
    return;
  }

  if (options.knownChoiceLists && !options.knownChoiceLists.includes(list)) {
    state.errors.push(`"${list}" is not a list this organization can use.`);
    return;
  }

  state.lookups.set(`${list}::${field}::${column}`, { list, field, column });
}

// ── Dependency ordering ─────────────────────────────────────────────────────

/**
 * Topologically sort calculated fields so each one runs after its inputs.
 *
 * Kahn's algorithm; whatever remains when the queue empties is part of a cycle.
 * Returns the cycle members rather than just "there is a cycle", so the author
 * is told which fields to look at.
 */
function orderCalculations(
  calculations: FormRule[],
  dependencies: Map<string, Set<string>>,
): { ordered: FormRule[]; cycle: string[] | null } {
  const byTarget = new Map(calculations.map((rule) => [rule.target, rule]));
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const target of byTarget.keys()) indegree.set(target, 0);

  for (const [target, deps] of dependencies) {
    for (const dep of deps) {
      // Only dependencies on OTHER calculated fields constrain ordering; plain
      // answered questions are available from the start.
      if (!byTarget.has(dep) || dep === target) continue;
      indegree.set(target, (indegree.get(target) ?? 0) + 1);
      dependents.set(dep, [...(dependents.get(dep) ?? []), target]);
    }
  }

  // Sorted seed keeps the compiled order deterministic across publishes, so an
  // unchanged rule set produces an identical plan.
  const queue = [...indegree.entries()]
    .filter(([, degree]) => degree === 0)
    .map(([target]) => target)
    .sort();

  const ordered: FormRule[] = [];
  while (queue.length > 0) {
    const target = queue.shift()!;
    const rule = byTarget.get(target);
    if (rule) ordered.push(rule);

    for (const dependent of dependents.get(target) ?? []) {
      const remaining = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, remaining);
      if (remaining === 0) queue.push(dependent);
    }
    queue.sort();
  }

  if (ordered.length !== calculations.length) {
    const cycle = [...byTarget.keys()]
      .filter((t) => !ordered.some((r) => r.target === t))
      .sort();
    return { ordered: [], cycle };
  }

  return { ordered, cycle: null };
}

// ── Entry point ─────────────────────────────────────────────────────────────

export function compileRules(
  rules: FormRule[],
  options: CompileOptions,
): CompileResult {
  const errors: CompileError[] = [];

  if (!Array.isArray(rules)) {
    return {
      ok: false,
      errors: [{ ruleId: null, message: 'Rules must be a list.' }],
    };
  }
  if (rules.length > COMPILE_LIMITS.maxRulesPerForm) {
    return {
      ok: false,
      errors: [
        {
          ruleId: null,
          message: `A form may have at most ${COMPILE_LIMITS.maxRulesPerForm} rules; this one has ${rules.length}.`,
        },
      ],
    };
  }

  const references = new Map<string, RefNode['ref']>();
  const lookups = new Map<string, LookupSpec>();
  const dependencies = new Map<string, Set<string>>();
  const calculations: FormRule[] = [];
  const show: FormRule[] = [];
  const require: FormRule[] = [];
  const validate: FormRule[] = [];
  const seenIds = new Set<string>();
  const calculatedTargets = new Set<string>();

  for (const rule of rules) {
    const ruleId = typeof rule?.id === 'string' ? rule.id : null;
    const push = (message: string) => errors.push({ ruleId, message });

    if (!rule || typeof rule !== 'object') {
      push('Rule is malformed.');
      continue;
    }
    if (!ruleId) {
      push('Rule is missing an id.');
      continue;
    }
    if (seenIds.has(ruleId)) {
      push(`Duplicate rule id "${ruleId}".`);
      continue;
    }
    seenIds.add(ruleId);

    if (!RULE_KINDS.includes(rule.kind)) {
      push(`"${String(rule.kind)}" is not a valid rule type.`);
      continue;
    }
    if (
      typeof rule.target !== 'string' ||
      !options.knownKeys.includes(rule.target)
    ) {
      push(
        `Rule targets "${String(rule.target)}", which is not a question on this form.`,
      );
      continue;
    }
    if (
      rule.kind === 'VALIDATE' &&
      (typeof rule.message !== 'string' || rule.message.trim() === '')
    ) {
      // Without a message the respondent is told only that something is wrong.
      push('A validation rule needs a message to show the respondent.');
      continue;
    }

    const state: WalkState = {
      nodes: 0,
      errors: [],
      references,
      lookups,
      fieldsUsed: new Set<string>(),
    };
    walk(rule.expr, 0, state, options);

    if (state.errors.length > 0) {
      for (const message of state.errors) push(message);
      continue;
    }

    if (rule.kind === 'CALCULATE') {
      if (calculatedTargets.has(rule.target)) {
        // Two rules writing one field has no defined outcome — the second would
        // silently win. Make the author choose.
        push(`"${rule.target}" is calculated by more than one rule.`);
        continue;
      }
      if (state.fieldsUsed.has(rule.target)) {
        push(`"${rule.target}" cannot be calculated from itself.`);
        continue;
      }
      calculatedTargets.add(rule.target);
      calculations.push(rule);
      dependencies.set(rule.target, state.fieldsUsed);
    } else if (rule.kind === 'SHOW') {
      show.push(rule);
    } else if (rule.kind === 'REQUIRE') {
      require.push(rule);
    } else {
      validate.push(rule);
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  const { ordered, cycle } = orderCalculations(calculations, dependencies);
  if (cycle) {
    return {
      ok: false,
      errors: [
        {
          ruleId: null,
          message: `These calculated fields depend on each other in a loop: ${cycle.join(' → ')}. Break the loop before publishing.`,
        },
      ],
    };
  }

  return {
    ok: true,
    plan: {
      calculations: ordered,
      show,
      require,
      validate,
      references: [...references.values()],
      calculatedKeys: ordered.map((rule) => rule.target),
      lookups: [...lookups.values()],
    },
  };
}
