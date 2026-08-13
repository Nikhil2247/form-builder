/**
 * Operator registry — the closed set of things a rule can do.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Authors pick operators from a list in the UI. There is no mechanism to add
 * one at runtime; extending this table is a code change and a deploy.
 *
 * TOTALITY IS THE CONTRACT. Every operator returns a RuleValue or `null`, and
 * never throws. A rule is evaluated on the submit path, so an operator that
 * threw on unexpected input would turn an author's typo into a 500 for the
 * respondent. Bad input yields `null`, and `null` propagates outward.
 *
 * Evaluation is EAGER, including for `if`/`and`/`or`. Short-circuiting would
 * save a few steps, but every operator here is pure and total, so evaluating an
 * untaken branch cannot cause an error or a side effect — and eager evaluation
 * keeps the interpreter a plain post-order walk with no special forms.
 */

import { lookupKey, type RuleValue } from './ast';

export interface OpContext {
  /**
   * The instant the form is being evaluated against.
   *
   * Passed in rather than read from the clock inside an operator, so that the
   * server's recomputation reproduces exactly what the respondent saw, and so
   * evaluation is a pure function of its inputs.
   */
  evalTime: Date;
  /**
   * Choice-list column values, pre-resolved and keyed by `lookupKey()`.
   *
   * Filled by the caller before evaluation — from the database on the server,
   * from the items the cascade already fetched in the browser. The operator
   * only reads it, so the interpreter stays free of I/O. A missing entry is
   * `null`, never an error: an item with no value recorded in that column is
   * an ordinary state, not a fault.
   */
  lookups?: Record<string, RuleValue>;
}

export interface OperatorDef {
  minArgs: number;
  /** Infinity for variadic operators. */
  maxArgs: number;
  fn: (args: RuleValue[], ctx: OpContext) => RuleValue;
}

// ── Coercion helpers ────────────────────────────────────────────────────────

/**
 * Truthiness for form data.
 *
 * NOTE: `0` is TRUTHY here, unlike JavaScript. A numeric answer of zero is a
 * real answer — "how many children? 0" must not silently behave like "unanswered".
 * Treating it as falsy is the single most common footgun in form logic engines.
 * Emptiness is expressed by `null`, `""`, or `[]`.
 */
export function truthy(v: RuleValue): boolean {
  if (v === null || v === false) return false;
  if (v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

export function toNumber(v: RuleValue): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const trimmed = v.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function toText(v: RuleValue): string | null {
  if (v === null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}

export function toArray(v: RuleValue): RuleValue[] {
  if (v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * Parse a date answer. Accepts `YYYY-MM-DD` and full ISO datetimes, both of
 * which our DATE questions and `today()` produce.
 *
 * Everything is handled in UTC. Date arithmetic that silently depends on the
 * server's local timezone would make the server's recomputation disagree with
 * the browser's — the exact class of bug this engine exists to avoid.
 */
export function toDate(v: RuleValue): Date | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (trimmed === '') return null;

  // Date-only strings are parsed as UTC midnight by spec; datetimes keep their
  // own offset. Anything else is rejected rather than guessed at.
  if (!/^\d{4}-\d{2}-\d{2}([T ].*)?$/.test(trimmed)) return null;

  const ms = Date.parse(
    trimmed.length === 10 ? `${trimmed}T00:00:00Z` : trimmed,
  );
  return Number.isNaN(ms) ? null : new Date(ms);
}

/** `YYYY-MM-DD` in UTC. */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Whole years from `from` to `to` — i.e. how many birthdays have passed. */
function wholeYearsBetween(from: Date, to: Date): number {
  let years = to.getUTCFullYear() - from.getUTCFullYear();
  const monthDelta = to.getUTCMonth() - from.getUTCMonth();
  if (
    monthDelta < 0 ||
    (monthDelta === 0 && to.getUTCDate() < from.getUTCDate())
  ) {
    years -= 1;
  }
  return years;
}

function wholeMonthsBetween(from: Date, to: Date): number {
  let months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) months -= 1;
  return months;
}

const MS_PER_DAY = 86_400_000;

/** Apply a numeric binary op, yielding null if either side isn't a number. */
function numeric2(
  a: RuleValue,
  b: RuleValue,
  fn: (x: number, y: number) => number,
): RuleValue {
  const x = toNumber(a);
  const y = toNumber(b);
  if (x === null || y === null) return null;
  const result = fn(x, y);
  return Number.isFinite(result) ? result : null;
}

/**
 * Ordered comparison over numbers OR dates.
 *
 * Numbers are tried first; if either side isn't numeric, both are tried as
 * dates. This lets `gt` work on date questions without the author choosing a
 * different operator for dates than for numbers.
 */
function compare(a: RuleValue, b: RuleValue): number | null {
  const x = toNumber(a);
  const y = toNumber(b);
  if (x !== null && y !== null) return x === y ? 0 : x < y ? -1 : 1;

  const dx = toDate(a);
  const dy = toDate(b);
  if (dx && dy) {
    const tx = dx.getTime();
    const ty = dy.getTime();
    return tx === ty ? 0 : tx < ty ? -1 : 1;
  }
  return null;
}

/** Equality across primitives and arrays (order-insensitive for arrays). */
function looseEquals(a: RuleValue, b: RuleValue): boolean {
  if (a === null || b === null) return a === b;

  if (Array.isArray(a) || Array.isArray(b)) {
    // MULTI_CHOICE answers are sets; ["a","b"] and ["b","a"] are the same answer.
    const xs = toArray(a).map((v) => toText(v));
    const ys = toArray(b).map((v) => toText(v));
    if (xs.length !== ys.length) return false;
    const remaining = [...ys];
    for (const x of xs) {
      const at = remaining.indexOf(x);
      if (at === -1) return false;
      remaining.splice(at, 1);
    }
    return true;
  }

  // Numeric comparison when both sides look numeric, so the string "5" coming
  // from a select option matches the number 5 stored on a slider.
  const nx = toNumber(a);
  const ny = toNumber(b);
  if (nx !== null && ny !== null) return nx === ny;

  return toText(a) === toText(b);
}

// ── Registry ────────────────────────────────────────────────────────────────

export const OPERATORS: Readonly<Record<string, OperatorDef>> = {
  // ── Arithmetic ──
  add: {
    minArgs: 2,
    maxArgs: Infinity,
    fn: (a) => reduceNumeric(a, (x, y) => x + y),
  },
  sub: {
    minArgs: 2,
    maxArgs: 2,
    fn: (a) => numeric2(a[0], a[1], (x, y) => x - y),
  },
  mul: {
    minArgs: 2,
    maxArgs: Infinity,
    fn: (a) => reduceNumeric(a, (x, y) => x * y),
  },
  // Division by zero is null, not Infinity — a form should show "no value"
  // rather than a value no respondent can interpret.
  div: {
    minArgs: 2,
    maxArgs: 2,
    fn: (a) => numeric2(a[0], a[1], (x, y) => (y === 0 ? NaN : x / y)),
  },
  mod: {
    minArgs: 2,
    maxArgs: 2,
    fn: (a) => numeric2(a[0], a[1], (x, y) => (y === 0 ? NaN : x % y)),
  },
  abs: { minArgs: 1, maxArgs: 1, fn: (a) => unaryNumeric(a[0], Math.abs) },
  floor: { minArgs: 1, maxArgs: 1, fn: (a) => unaryNumeric(a[0], Math.floor) },
  ceil: { minArgs: 1, maxArgs: 1, fn: (a) => unaryNumeric(a[0], Math.ceil) },
  round: {
    minArgs: 1,
    maxArgs: 2,
    fn: (a) => {
      const x = toNumber(a[0]);
      if (x === null) return null;
      const digits = a.length > 1 ? toNumber(a[1]) : 0;
      if (digits === null) return null;
      // Clamped: toFixed throws outside 0..100, and no form needs 10^15 places.
      const places = Math.min(Math.max(Math.trunc(digits), 0), 12);
      const factor = 10 ** places;
      return Math.round(x * factor) / factor;
    },
  },
  min: {
    minArgs: 1,
    maxArgs: Infinity,
    fn: (a) => reduceNumeric(a, (x, y) => Math.min(x, y)),
  },
  max: {
    minArgs: 1,
    maxArgs: Infinity,
    fn: (a) => reduceNumeric(a, (x, y) => Math.max(x, y)),
  },

  // ── Comparison ──
  eq: { minArgs: 2, maxArgs: 2, fn: (a) => looseEquals(a[0], a[1]) },
  neq: { minArgs: 2, maxArgs: 2, fn: (a) => !looseEquals(a[0], a[1]) },
  gt: {
    minArgs: 2,
    maxArgs: 2,
    fn: (a) => cmpResult(a[0], a[1], (c) => c > 0),
  },
  gte: {
    minArgs: 2,
    maxArgs: 2,
    fn: (a) => cmpResult(a[0], a[1], (c) => c >= 0),
  },
  lt: {
    minArgs: 2,
    maxArgs: 2,
    fn: (a) => cmpResult(a[0], a[1], (c) => c < 0),
  },
  lte: {
    minArgs: 2,
    maxArgs: 2,
    fn: (a) => cmpResult(a[0], a[1], (c) => c <= 0),
  },
  between: {
    minArgs: 3,
    maxArgs: 3,
    fn: (a) => {
      const lower = compare(a[0], a[1]);
      const upper = compare(a[0], a[2]);
      if (lower === null || upper === null) return null;
      return lower >= 0 && upper <= 0;
    },
  },

  // ── Logic ──
  and: { minArgs: 1, maxArgs: Infinity, fn: (a) => a.every(truthy) },
  or: { minArgs: 1, maxArgs: Infinity, fn: (a) => a.some(truthy) },
  not: { minArgs: 1, maxArgs: 1, fn: (a) => !truthy(a[0]) },
  if: { minArgs: 3, maxArgs: 3, fn: (a) => (truthy(a[0]) ? a[1] : a[2]) },
  coalesce: {
    minArgs: 1,
    maxArgs: Infinity,
    fn: (a) => {
      for (const v of a) if (v !== null && v !== '') return v;
      return null;
    },
  },

  // ── Presence ──
  isBlank: { minArgs: 1, maxArgs: 1, fn: (a) => !truthy(a[0]) },
  isFilled: { minArgs: 1, maxArgs: 1, fn: (a) => truthy(a[0]) },

  // ── Dates ──
  today: { minArgs: 0, maxArgs: 0, fn: (_a, ctx) => isoDate(ctx.evalTime) },
  yearsBetween: {
    minArgs: 2,
    maxArgs: 2,
    fn: (a) => dates2(a, wholeYearsBetween),
  },
  monthsBetween: {
    minArgs: 2,
    maxArgs: 2,
    fn: (a) => dates2(a, wholeMonthsBetween),
  },
  daysBetween: {
    minArgs: 2,
    maxArgs: 2,
    fn: (a) =>
      dates2(a, (from, to) =>
        Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY),
      ),
  },
  addDays: {
    minArgs: 2,
    maxArgs: 2,
    fn: (a) => {
      const d = toDate(a[0]);
      const n = toNumber(a[1]);
      if (!d || n === null) return null;
      return isoDate(new Date(d.getTime() + Math.trunc(n) * MS_PER_DAY));
    },
  },
  addMonths: {
    minArgs: 2,
    maxArgs: 2,
    fn: (a) => {
      const d = toDate(a[0]);
      const n = toNumber(a[1]);
      if (!d || n === null) return null;
      const result = new Date(d.getTime());
      const targetDay = result.getUTCDate();
      result.setUTCDate(1);
      result.setUTCMonth(result.getUTCMonth() + Math.trunc(n));
      // Clamp: 31 Jan + 1 month is 28/29 Feb, not 2/3 March.
      const daysInTarget = new Date(
        Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
      ).getUTCDate();
      result.setUTCDate(Math.min(targetDay, daysInTarget));
      return isoDate(result);
    },
  },
  formatDate: {
    minArgs: 2,
    maxArgs: 2,
    fn: (a) => {
      const d = toDate(a[0]);
      const pattern = toText(a[1]);
      if (!d || pattern === null) return null;
      const pad = (n: number) => String(n).padStart(2, '0');
      // A fixed token set, applied in one pass so replacements can't cascade.
      return pattern.replace(/YYYY|MM|DD|HH|mm/g, (token) => {
        switch (token) {
          case 'YYYY':
            return String(d.getUTCFullYear());
          case 'MM':
            return pad(d.getUTCMonth() + 1);
          case 'DD':
            return pad(d.getUTCDate());
          case 'HH':
            return pad(d.getUTCHours());
          case 'mm':
            return pad(d.getUTCMinutes());
          default:
            return token;
        }
      });
    },
  },

  // ── Text ──
  concat: {
    minArgs: 1,
    maxArgs: Infinity,
    // Nulls contribute nothing rather than the literal "null".
    fn: (a) => a.map((v) => toText(v) ?? '').join(''),
  },
  upper: {
    minArgs: 1,
    maxArgs: 1,
    fn: (a) => toText(a[0])?.toUpperCase() ?? null,
  },
  lower: {
    minArgs: 1,
    maxArgs: 1,
    fn: (a) => toText(a[0])?.toLowerCase() ?? null,
  },
  trim: { minArgs: 1, maxArgs: 1, fn: (a) => toText(a[0])?.trim() ?? null },
  length: {
    minArgs: 1,
    maxArgs: 1,
    fn: (a) =>
      Array.isArray(a[0]) ? a[0].length : (toText(a[0])?.length ?? null),
  },
  contains: {
    minArgs: 2,
    maxArgs: 2,
    fn: (a) => {
      // Overloaded on purpose: "does this multi-select include X" and "does
      // this text contain X" are the same question to an author.
      if (Array.isArray(a[0])) return a[0].some((v) => looseEquals(v, a[1]));
      const haystack = toText(a[0]);
      const needle = toText(a[1]);
      if (haystack === null || needle === null) return null;
      return haystack.toLowerCase().includes(needle.toLowerCase());
    },
  },
  startsWith: {
    minArgs: 2,
    maxArgs: 2,
    fn: (a) => {
      const haystack = toText(a[0]);
      const needle = toText(a[1]);
      if (haystack === null || needle === null) return null;
      return haystack.toLowerCase().startsWith(needle.toLowerCase());
    },
  },

  // ── Choice lists ──
  /**
   * A column of the choice-list item the respondent picked.
   *
   * `lookup('ng-schools', school_name, 'udise_code')`
   *
   * The value has already been resolved into `ctx.lookups` by the caller — see
   * LookupSpec in ast.ts for why the second argument is compiler-restricted to
   * a bare field reference. Everything here is a total, pure map lookup.
   */
  lookup: {
    minArgs: 3,
    maxArgs: 3,
    fn: (a, ctx) => {
      const list = toText(a[0]);
      const column = toText(a[2]);
      if (list === null || column === null) return null;

      // The picked value. Multi-select answers have no single item to look up,
      // and an unanswered question has none yet — both are null, not an error.
      const raw = a[1];
      if (Array.isArray(raw)) return null;
      const value = toText(raw);
      if (value === null || value === '') return null;

      const resolved = ctx.lookups?.[lookupKey(list, value, column)];
      return resolved === undefined ? null : resolved;
    },
  },

  // ── Choices / repeating sections ──
  count: { minArgs: 1, maxArgs: 1, fn: (a) => toArray(a[0]).length },
  includes: {
    minArgs: 2,
    maxArgs: 2,
    fn: (a) => toArray(a[0]).some((v) => looseEquals(v, a[1])),
  },
  sumOf: {
    minArgs: 1,
    maxArgs: 1,
    fn: (a) =>
      toArray(a[0]).reduce<number>((total, v) => total + (toNumber(v) ?? 0), 0),
  },
  anyOf: { minArgs: 1, maxArgs: 1, fn: (a) => toArray(a[0]).some(truthy) },
  allOf: {
    minArgs: 1,
    maxArgs: 1,
    // Vacuously true on an empty list, matching `and` with no false members.
    fn: (a) => toArray(a[0]).every(truthy),
  },
};

// ── Small shared shapes ─────────────────────────────────────────────────────

/** Apply a two-date function, yielding null unless both sides parse as dates. */
function dates2(
  args: RuleValue[],
  fn: (from: Date, to: Date) => number,
): RuleValue {
  const from = toDate(args[0]);
  const to = toDate(args[1]);
  if (!from || !to) return null;
  const result = fn(from, to);
  return Number.isFinite(result) ? result : null;
}

function unaryNumeric(v: RuleValue, fn: (x: number) => number): RuleValue {
  const x = toNumber(v);
  if (x === null) return null;
  const result = fn(x);
  return Number.isFinite(result) ? result : null;
}

function reduceNumeric(
  args: RuleValue[],
  fn: (x: number, y: number) => number,
): RuleValue {
  const nums: number[] = [];
  for (const arg of args) {
    const n = toNumber(arg);
    // One unusable operand makes the whole result meaningless — better a blank
    // field than a total that silently ignored an answer.
    if (n === null) return null;
    nums.push(n);
  }
  const result = nums.reduce(fn);
  return Number.isFinite(result) ? result : null;
}

function cmpResult(
  a: RuleValue,
  b: RuleValue,
  decide: (comparison: number) => boolean,
): RuleValue {
  const c = compare(a, b);
  return c === null ? null : decide(c);
}

export function isKnownOperator(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(OPERATORS, name);
}
