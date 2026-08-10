/**
 * Authoring metadata for the rules panel.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Everything the UI offers is derived from the engine's own tables, never from
 * a hand-written list:
 *
 *   • The operator picker enumerates `OPERATORS`, so it cannot show an
 *     operation the compiler would reject, and a new operator added to the
 *     engine appears here on the next deploy with no edit to this file.
 *   • Argument counts come from each operator's `minArgs`/`maxArgs`, so the
 *     "add input" button disappears exactly when the compiler would start
 *     complaining.
 *
 * The only thing this file adds is presentation — a readable label, a group,
 * and per-argument names. Those decorations are looked up BY operator name and
 * an operator with no entry still renders, with a humanised label. That
 * direction matters: a missing decoration is a cosmetic gap, whereas a
 * hardcoded list would silently omit a working operation or offer one that
 * does not exist.
 */

import {
  OPERATORS,
  type ExprNode,
  type FormRule,
  type OpNode,
  type RuleKind,
  type RuleValue,
} from '@/lib/rules';
import type { QuestionKeyRow } from '@/lib/question-keys';
import type { FormQuestion } from '@/types/form';

// ── Question keys ───────────────────────────────────────────────────────────

/**
 * Re-exported, not defined here.
 *
 * The runner needs the identical derivation to evaluate a compiled plan in the
 * browser, and a second copy that drifted would mean a rule compiling in this
 * panel and then reading `null` at runtime. The one implementation lives in
 * `@/lib/question-keys`; these re-exports keep the existing import sites
 * working.
 */
export { slugifyKey, deriveQuestionKeys } from '@/lib/question-keys';
export type { QuestionKeyRow } from '@/lib/question-keys';

// ── Operators ───────────────────────────────────────────────────────────────

export type OperatorGroup =
  | 'Comparison'
  | 'Logic'
  | 'Presence'
  | 'Maths'
  | 'Dates'
  | 'Text'
  | 'Lists'
  | 'Other';

/** Render order for the picker's option groups. */
export const OPERATOR_GROUPS: readonly OperatorGroup[] = [
  'Comparison',
  'Logic',
  'Presence',
  'Maths',
  'Dates',
  'Text',
  'Lists',
  'Other',
];

export interface OperatorMeta {
  name: string;
  label: string;
  group: OperatorGroup;
  /** Names for each positional argument; index past the end reads "Input n". */
  argLabels?: string[];
  minArgs: number;
  maxArgs: number;
}

interface OperatorDecoration {
  label: string;
  group: OperatorGroup;
  argLabels?: string[];
}

/**
 * Presentation only. Arities are NOT repeated here — they are read from
 * `OPERATORS` — so this table can never disagree with the compiler about how
 * many inputs an operation takes.
 */
const DECORATIONS: Readonly<Record<string, OperatorDecoration>> = {
  // Comparison
  eq: { label: 'is equal to', group: 'Comparison', argLabels: ['Value', 'Equals'] },
  neq: { label: 'is not equal to', group: 'Comparison', argLabels: ['Value', 'Not equal to'] },
  gt: { label: 'is greater than', group: 'Comparison', argLabels: ['Value', 'Greater than'] },
  gte: {
    label: 'is greater than or equal to',
    group: 'Comparison',
    argLabels: ['Value', 'At least'],
  },
  lt: { label: 'is less than', group: 'Comparison', argLabels: ['Value', 'Less than'] },
  lte: { label: 'is less than or equal to', group: 'Comparison', argLabels: ['Value', 'At most'] },
  between: {
    label: 'is between',
    group: 'Comparison',
    argLabels: ['Value', 'Lowest', 'Highest'],
  },

  // Logic
  and: { label: 'all of these are true', group: 'Logic' },
  or: { label: 'any of these is true', group: 'Logic' },
  not: { label: 'is not true', group: 'Logic' },
  if: { label: 'if … then … otherwise', group: 'Logic', argLabels: ['When', 'Then', 'Otherwise'] },
  coalesce: { label: 'first value that is filled in', group: 'Logic' },

  // Presence
  isBlank: { label: 'has no answer', group: 'Presence' },
  isFilled: { label: 'has an answer', group: 'Presence' },

  // Maths
  add: { label: 'add', group: 'Maths' },
  sub: { label: 'subtract', group: 'Maths', argLabels: ['From', 'Subtract'] },
  mul: { label: 'multiply', group: 'Maths' },
  div: { label: 'divide', group: 'Maths', argLabels: ['Divide', 'By'] },
  mod: { label: 'remainder of', group: 'Maths', argLabels: ['Divide', 'By'] },
  abs: { label: 'absolute value', group: 'Maths' },
  floor: { label: 'round down', group: 'Maths' },
  ceil: { label: 'round up', group: 'Maths' },
  round: { label: 'round', group: 'Maths', argLabels: ['Value', 'Decimal places'] },
  min: { label: 'smallest of', group: 'Maths' },
  max: { label: 'largest of', group: 'Maths' },

  // Dates
  today: { label: "today's date", group: 'Dates' },
  yearsBetween: { label: 'whole years between', group: 'Dates', argLabels: ['From', 'To'] },
  monthsBetween: { label: 'whole months between', group: 'Dates', argLabels: ['From', 'To'] },
  daysBetween: { label: 'days between', group: 'Dates', argLabels: ['From', 'To'] },
  addDays: { label: 'add days to a date', group: 'Dates', argLabels: ['Date', 'Days'] },
  addMonths: { label: 'add months to a date', group: 'Dates', argLabels: ['Date', 'Months'] },
  formatDate: {
    label: 'format a date',
    group: 'Dates',
    argLabels: ['Date', 'Pattern (YYYY-MM-DD)'],
  },

  // Text
  concat: { label: 'join text together', group: 'Text' },
  upper: { label: 'UPPERCASE', group: 'Text' },
  lower: { label: 'lowercase', group: 'Text' },
  trim: { label: 'trim spaces', group: 'Text' },
  length: { label: 'length of', group: 'Text' },
  contains: { label: 'contains', group: 'Text', argLabels: ['Value', 'Looks for'] },
  startsWith: { label: 'starts with', group: 'Text', argLabels: ['Value', 'Starts with'] },

  // Lists
  count: { label: 'number of answers in', group: 'Lists' },
  includes: { label: 'list includes', group: 'Lists', argLabels: ['List', 'Includes'] },
  sumOf: { label: 'sum of', group: 'Lists' },
  anyOf: { label: 'any entry is true', group: 'Lists' },
  allOf: { label: 'every entry is true', group: 'Lists' },
};

/** `yearsBetween` → "years between", for an operator with no decoration. */
function humanise(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());
}

/**
 * Every operator the engine knows, decorated for display.
 *
 * Built from `Object.entries(OPERATORS)` — the picker is therefore exactly the
 * set the compiler accepts, in both directions.
 */
export const OPERATOR_LIST: readonly OperatorMeta[] = Object.entries(OPERATORS)
  .map(([name, def]): OperatorMeta => {
    const decoration = DECORATIONS[name];
    return {
      name,
      label: decoration?.label ?? humanise(name),
      group: decoration?.group ?? 'Other',
      argLabels: decoration?.argLabels,
      minArgs: def.minArgs,
      maxArgs: def.maxArgs,
    };
  })
  .sort((a, b) => a.label.localeCompare(b.label));

const OPERATOR_BY_NAME = new Map(OPERATOR_LIST.map((op) => [op.name, op]));

export function operatorMeta(name: string): OperatorMeta | undefined {
  return OPERATOR_BY_NAME.get(name);
}

/** Human summary of an operator's arity, for the hint line under the picker. */
export function describeArity(meta: OperatorMeta): string {
  if (meta.maxArgs === Infinity) {
    return meta.minArgs === 1 ? 'Takes one or more inputs.' : `Takes ${meta.minArgs} or more inputs.`;
  }
  if (meta.minArgs === meta.maxArgs) {
    if (meta.minArgs === 0) return 'Takes no inputs.';
    return meta.minArgs === 1 ? 'Takes one input.' : `Takes exactly ${meta.minArgs} inputs.`;
  }
  return `Takes between ${meta.minArgs} and ${meta.maxArgs} inputs.`;
}

export function argLabel(meta: OperatorMeta | undefined, index: number): string {
  return meta?.argLabels?.[index] ?? `Input ${index + 1}`;
}

// ── Node construction ───────────────────────────────────────────────────────

export type NodeKind = 'lit' | 'field' | 'ref' | 'op';

export function nodeKind(node: ExprNode): NodeKind {
  if (node && typeof node === 'object') {
    if ('lit' in node) return 'lit';
    if ('field' in node) return 'field';
    if ('ref' in node) return 'ref';
    if ('op' in node) return 'op';
  }
  // Anything unrecognised is shown as a literal so the author can see and
  // replace it, rather than the row rendering blank.
  return 'lit';
}

/** A fresh, valid node of the requested kind. */
export function blankNode(kind: NodeKind, fields: QuestionKeyRow[]): ExprNode {
  switch (kind) {
    case 'field':
      return { field: fields[0]?.key ?? '' };
    case 'ref':
      return { ref: { form: '', question: '', when: 'LATEST' } };
    case 'op':
      return { op: 'eq', args: [{ lit: '' }, { lit: '' }] };
    case 'lit':
    default:
      return { lit: '' };
  }
}

/**
 * Re-shape an operation's arguments for a newly chosen operator.
 *
 * Existing arguments are kept — switching `eq` to `gt` should not throw away
 * the two sides the author already filled in — then trimmed to `maxArgs` and
 * padded to `minArgs`. The result always satisfies the arity check, so a
 * change of operator can never itself produce a compile error.
 */
export function fitArgs(args: ExprNode[], meta: OperatorMeta): ExprNode[] {
  const next = args.slice(0, meta.maxArgs === Infinity ? args.length : meta.maxArgs);
  while (next.length < meta.minArgs) next.push({ lit: '' });
  return next;
}

// ── Literals ────────────────────────────────────────────────────────────────

export type LiteralKind = 'text' | 'number' | 'boolean' | 'list' | 'empty';

export function literalKind(value: RuleValue): LiteralKind {
  if (value === null) return 'empty';
  if (Array.isArray(value)) return 'list';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'text';
}

/** Convert a literal to another kind, preserving what can be preserved. */
export function coerceLiteral(value: RuleValue, kind: LiteralKind): RuleValue {
  switch (kind) {
    case 'empty':
      return null;
    case 'boolean':
      return value === true || value === 'true' || value === 1;
    case 'number': {
      const n = Number(Array.isArray(value) ? value[0] : value);
      return Number.isFinite(n) ? n : 0;
    }
    case 'list':
      return Array.isArray(value) ? value : value === null || value === '' ? [] : [value];
    case 'text':
    default:
      if (Array.isArray(value)) return value.map((v) => String(v ?? '')).join(', ');
      return value === null ? '' : String(value);
  }
}

// ── Read-back ───────────────────────────────────────────────────────────────

/**
 * One-line formula rendering of a tree, e.g. `yearsBetween(dob, today())`.
 *
 * Shown collapsed at the top of each rule card. A tree of pickers is what you
 * need to *edit* an expression and the worst possible way to *check* one, so
 * the card carries both: the formula tells the author at a glance whether the
 * rule says what they meant.
 */
export function formatExpr(node: ExprNode, depth = 0): string {
  if (depth > 12) return '…';
  if (!node || typeof node !== 'object') return '?';

  if ('lit' in node) {
    const value = node.lit;
    if (value === null) return 'blank';
    if (Array.isArray(value)) return `[${value.map((v) => String(v ?? '')).join(', ')}]`;
    if (typeof value === 'string') return `"${value}"`;
    return String(value);
  }
  if ('field' in node) return node.field || '?';
  if ('ref' in node) {
    return `${node.ref.question || '?'}@${node.ref.when.toLowerCase()}`;
  }
  if ('op' in node) {
    const args = Array.isArray(node.args) ? node.args : [];
    return `${node.op}(${args.map((arg) => formatExpr(arg, depth + 1)).join(', ')})`;
  }
  return '?';
}

// ── Rule kinds ──────────────────────────────────────────────────────────────

export interface RuleKindMeta {
  kind: RuleKind;
  label: string;
  /** Heading above the expression editor, phrased for this kind. */
  exprLabel: string;
  hint: string;
}

export const RULE_KIND_META: Readonly<Record<RuleKind, RuleKindMeta>> = {
  CALCULATE: {
    kind: 'CALCULATE',
    label: 'Calculate the answer',
    exprLabel: 'Set it to',
    hint: 'The respondent cannot edit a calculated field — the formula owns its value.',
  },
  SHOW: {
    kind: 'SHOW',
    label: 'Show the question',
    exprLabel: 'Only when',
    hint: 'The question is hidden whenever this is not true, and its answer is not stored.',
  },
  REQUIRE: {
    kind: 'REQUIRE',
    label: 'Require an answer',
    exprLabel: 'Only when',
    hint: 'The question becomes mandatory whenever this is true.',
  },
  VALIDATE: {
    kind: 'VALIDATE',
    label: 'Reject the submission',
    exprLabel: 'Reject when',
    hint: 'Write the condition that is WRONG — the message shows next to the target question.',
  },
};

// ── Starting templates ──────────────────────────────────────────────────────

export interface RuleTemplate {
  id: string;
  label: string;
  description: string;
  kind: RuleKind;
  message?: string;
  /** Prefers a question of a fitting type, falling back to the first key. */
  build: (fields: QuestionKeyRow[]) => ExprNode;
}

const DATE_TYPES: ReadonlyArray<FormQuestion['type']> = ['DATE'];
const NUMBER_TYPES: ReadonlyArray<FormQuestion['type']> = ['NUMBER', 'SLIDER', 'NPS', 'STAR_RATING'];

function pick(fields: QuestionKeyRow[], types: ReadonlyArray<FormQuestion['type']>): string {
  return (fields.find((f) => types.includes(f.type)) ?? fields[0])?.key ?? '';
}

/**
 * Presets, so the common shapes are one click rather than four nested pickers.
 * Each produces a tree that compiles as-is against a form with the right kind
 * of question, and only needs the author to swap a field or a constant.
 */
export const RULE_TEMPLATES: readonly RuleTemplate[] = [
  {
    id: 'age-from-dob',
    label: 'Age from date of birth',
    description: 'Whole years between a date question and today.',
    kind: 'CALCULATE',
    build: (fields): OpNode => ({
      op: 'yearsBetween',
      args: [{ field: pick(fields, DATE_TYPES) }, { op: 'today', args: [] }],
    }),
  },
  {
    id: 'sum-two',
    label: 'Add two answers together',
    description: 'A running total from two numeric questions.',
    kind: 'CALCULATE',
    build: (fields): OpNode => ({
      op: 'add',
      args: [{ field: pick(fields, NUMBER_TYPES) }, { lit: 0 }],
    }),
  },
  {
    id: 'show-when-equals',
    label: 'Show when an answer matches',
    description: 'Reveal a question only when another has a particular value.',
    kind: 'SHOW',
    build: (fields): OpNode => ({
      op: 'eq',
      args: [{ field: fields[0]?.key ?? '' }, { lit: '' }],
    }),
  },
  {
    id: 'show-when-answered',
    label: 'Show once something is answered',
    description: 'Reveal a follow-up as soon as an earlier question is filled in.',
    kind: 'SHOW',
    build: (fields): OpNode => ({
      op: 'isFilled',
      args: [{ field: fields[0]?.key ?? '' }],
    }),
  },
  {
    id: 'require-when-answered',
    label: 'Require a follow-up',
    description: 'Make a question mandatory once another has an answer.',
    kind: 'REQUIRE',
    build: (fields): OpNode => ({
      op: 'isFilled',
      args: [{ field: fields[0]?.key ?? '' }],
    }),
  },
  {
    id: 'validate-range',
    label: 'Reject a value outside a range',
    description: 'Block the submission when a number falls outside the allowed band.',
    kind: 'VALIDATE',
    message: 'Enter a value between 0 and 100.',
    build: (fields): OpNode => ({
      op: 'not',
      args: [
        {
          op: 'between',
          args: [{ field: pick(fields, NUMBER_TYPES) }, { lit: 0 }, { lit: 100 }],
        },
      ],
    }),
  },
];

/** The rule a plain "Add rule" produces: a condition the author can read. */
export function blankRule(id: string, fields: QuestionKeyRow[]): FormRule {
  return {
    id,
    kind: 'SHOW',
    target: fields[1]?.key ?? fields[0]?.key ?? '',
    expr: { op: 'isFilled', args: [{ field: fields[0]?.key ?? '' }] },
  };
}
