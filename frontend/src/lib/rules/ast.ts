/**
 * Rule expression AST.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Rules are DATA, not code. An author builds them in the UI; we store the tree;
 * our own interpreter walks it. There is no `eval`, no `Function`, no VM, and
 * therefore no sandbox to escape — a tenant cannot execute anything on our
 * infrastructure. (Avni, the inspiration for this feature, runs
 * `const ruleFunc = eval(code)` on a shared multi-tenant service. We are
 * deliberately not doing that.)
 *
 * The second benefit of rules-as-data is static analysis: because the tree can
 * be inspected without running it, `compiler.ts` resolves every reference,
 * detects dependency cycles, and enforces size budgets AT PUBLISH TIME. A rule
 * set that would misbehave is rejected before a respondent ever sees the form.
 *
 * DEPENDENCY RULE: this directory imports nothing — not Nest, not Prisma, not
 * a date library. It is pure TypeScript over plain objects so the identical
 * code can run in the browser for live preview. Keep it that way.
 */

/** Everything an expression can produce. Deliberately small. */
export type RuleValue = string | number | boolean | null | RuleValue[];

// ── Expression nodes ────────────────────────────────────────────────────────

/** A constant written by the author. */
export interface LiteralNode {
  lit: RuleValue;
}

/** The answer to a question on THIS form, addressed by its author-set key. */
export interface FieldNode {
  field: string;
}

/**
 * A value from another form, for the same subject.
 *
 * `when` is a closed enum rather than a query the author writes — which is
 * what keeps historical lookups both safe and authorable. Resolution happens
 * server-side BEFORE interpretation (see `EvalContext.refs`); the interpreter
 * itself never touches a database.
 */
export interface RefNode {
  ref: {
    /** Form id the value comes from. */
    form: string;
    /** Question key within that form. */
    question: string;
    when: RefWhen;
  };
}

export type RefWhen =
  /** Most recent submission of that form for this subject. */
  | 'LATEST'
  /** Earliest submission of that form for this subject. */
  | 'FIRST'
  /** The submission that registered the subject. */
  | 'REGISTRATION';

export const REF_WHEN_VALUES: readonly RefWhen[] = ['LATEST', 'FIRST', 'REGISTRATION'];

/** Application of a built-in operator. The operator set is closed (operators.ts). */
export interface OpNode {
  op: string;
  args: ExprNode[];
}

export type ExprNode = LiteralNode | FieldNode | RefNode | OpNode;

// Narrowing helpers. Nodes are discriminated by which key is present, which
// keeps the stored JSON compact and readable for a human debugging a form.
export const isLiteral = (n: ExprNode): n is LiteralNode =>
  typeof n === 'object' && n !== null && 'lit' in n;
export const isField = (n: ExprNode): n is FieldNode =>
  typeof n === 'object' && n !== null && 'field' in n;
export const isRef = (n: ExprNode): n is RefNode =>
  typeof n === 'object' && n !== null && 'ref' in n;
export const isOp = (n: ExprNode): n is OpNode =>
  typeof n === 'object' && n !== null && 'op' in n;

// ── Rules ───────────────────────────────────────────────────────────────────

export type RuleKind =
  /** Derive the target's value. The field is read-only to the respondent. */
  | 'CALCULATE'
  /** Target is visible only when the expression is true. */
  | 'SHOW'
  /** Target is required only when the expression is true. */
  | 'REQUIRE'
  /** Submission is rejected when the expression is true. */
  | 'VALIDATE';

export const RULE_KINDS: readonly RuleKind[] = ['CALCULATE', 'SHOW', 'REQUIRE', 'VALIDATE'];

export interface FormRule {
  id: string;
  kind: RuleKind;
  /**
   * Question key this rule acts on.
   *
   * For VALIDATE this is the field the error is attached to, so the respondent
   * sees the message next to something they can actually fix.
   */
  target: string;
  expr: ExprNode;
  /** VALIDATE only — shown to the respondent. Required for VALIDATE. */
  message?: string;
}

// ── Reference keys ──────────────────────────────────────────────────────────

/**
 * Canonical string key for a cross-form reference.
 *
 * The compiler emits the full list of these for a form version, the resolver
 * fills a bag keyed by them, and the interpreter does a plain lookup. Using one
 * shared function is what guarantees the three stay in agreement — computing
 * the key differently in any of them would silently yield `null` everywhere.
 */
export function refKey(ref: RefNode['ref']): string {
  return `${ref.form}::${ref.question}::${ref.when}`;
}

// ── Choice-list lookups ─────────────────────────────────────────────────────

/**
 * A column of a choice list, read for whichever item the respondent picked.
 *
 * This is what makes a field auto-fill: pick a school, and its UDISE code
 * appears in a read-only box. Expressed as
 *
 *   lookup('ng-schools', school_name, 'udise_code')
 *
 * WHY THE SECOND ARGUMENT IS RESTRICTED TO A BARE `field` NODE
 *
 * The interpreter performs no I/O — that is what lets the identical code run
 * in the browser and lets the server reproduce exactly what the respondent
 * saw. A lookup obviously needs data, so it is resolved BEFORE evaluation into
 * a plain bag, the same way cross-form `ref` values are.
 *
 * That only works if the set of (list, value) pairs a plan can need is knowable
 * without evaluating anything. Restricting the value argument to a raw field
 * reference guarantees it: every pair is determined by the submitted answers
 * alone. An arbitrary expression there would force multi-pass evaluation with
 * a lookup-depth analysis in the compiler, for no case anyone has asked for.
 *
 * The compiler enforces the restriction (see `walk`), so an author cannot
 * write one that would need a second pass.
 */
export interface LookupSpec {
  /** ChoiceList.slug the value is looked up in. */
  list: string;
  /** Question key whose answer identifies the item. */
  field: string;
  /** Key within the item's `metadata` to return. */
  column: string;
}

/**
 * Canonical key for one resolved lookup.
 *
 * Includes the VALUE, not just the spec, because two respondents answering the
 * same question pick different items. The compiler emits specs; the resolver
 * expands each spec against the actual answer and fills the bag under this key;
 * the interpreter does a plain lookup. One shared function keeps the three in
 * agreement — computing it differently anywhere would silently yield `null`.
 */
export function lookupKey(list: string, value: string, column: string): string {
  return `${list}::${value}::${column}`;
}
