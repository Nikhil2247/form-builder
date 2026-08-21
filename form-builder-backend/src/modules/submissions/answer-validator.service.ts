import { Injectable, Logger } from '@nestjs/common';

/**
 * AnswerValidatorService
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Validates a submitted `answers` payload against the immutable question schema
 * captured in a FormVersion.
 *
 * WHY THIS EXISTS:
 *  The submit DTO can only assert `answers` is an object. Without a schema-aware
 *  pass, any client can POST arbitrary JSON straight into a JSONB column:
 *  unknown question IDs, wrong types, choice values that were never offered,
 *  unbounded strings, and thousands of junk keys. That corrupts exports and
 *  analytics, and is a storage-exhaustion vector.
 *
 * WHERE IT RUNS:
 *  Synchronously in the API, BEFORE enqueueing. The respondent gets a
 *  field-level 400 they can act on, instead of a silent failure inside a worker
 *  that they never see.
 *
 * WHAT IT IS NOT:
 *  It does not evaluate conditional logic to decide whether a hidden question is
 *  genuinely required — see `visibleQuestionIds` below, which the caller can
 *  supply once logic evaluation is shared between client and server.
 */

export interface ValidationIssue {
  questionId: string;
  label?: string;
  code: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  /** Answers with unknown keys dropped and values coerced to their declared type. */
  sanitized: Record<string, any>;
}

interface QuestionLike {
  id: string;
  type: string;
  label?: string;
  required?: boolean;
  options?: any[];
  validation?: {
    required?: boolean;
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
    pattern?: string;
  };
  /**
   * The names the builder and `normalizeFormStructure` actually write.
   *
   * This interface previously declared `rows`/`columns` and `min`/`max`, none
   * of which exist on a stored question. Every guard that consulted them was
   * therefore reading `undefined`, and because each was written as
   * `if (set.size > 0 && ...)`, every one of them silently passed: a matrix
   * accepted arbitrary row keys and column values, and a slider accepted any
   * number at all.
   */
  matrixRows?: any[];
  matrixColumns?: any[];
  sliderMin?: number;
  sliderMax?: number;
  /** Set when the options come from a managed ChoiceList rather than `options`. */
  optionsSource?: {
    kind?: string;
    listSlug?: string;
    parentQuestionKey?: string;
  };
  key?: string;
}

/**
 * One resolved choice-list item, as far as validation cares.
 *
 * Supplied by the caller (SubmissionsService), which has already batched every
 * lookup this submission needs into one query per list. Passing the result in
 * rather than querying here keeps the validator synchronous and pure — it is
 * called from the request path and must not become N queries per submission.
 */
export interface ResolvedChoiceItem {
  value: string;
  parentValue: string | null;
}

/** Types that never carry an answer. */
const NON_ANSWERABLE = new Set(['SECTION_HEADER']);

/** Absolute ceilings, independent of what the form author configured. */
const LIMITS = {
  MAX_ANSWER_KEYS: 500,
  MAX_TEXT_LENGTH: 10_000,
  MAX_LONG_TEXT_LENGTH: 50_000,
  MAX_SIGNATURE_BYTES: 500_000,
  MAX_MULTI_CHOICE_SELECTIONS: 200,
  MAX_PAYLOAD_BYTES: 256 * 1024,
  MAX_REPEAT_ITEMS: 100,
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const URL_RE = /^https?:\/\/[^\s]+$/i;
const PHONE_RE = /^\+?[0-9\s\-().]{6,20}$/;
const UUID_OR_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

@Injectable()
export class AnswerValidatorService {
  private readonly logger = new Logger(AnswerValidatorService.name);

  /**
   * @param questionsJson  The FormVersion.questionsJson snapshot.
   * @param answers        Raw client-supplied answers.
   * @param opts.visibleQuestionIds  When provided, required-checks apply only to
   *                                 these. Questions hidden by conditional logic
   *                                 are otherwise wrongly reported as missing.
   * @param opts.calculatedQuestionIds  Questions whose value the rules engine
   *                                 owns. Never treated as required — see below.
   */
  validate(
    questionsJson: unknown,
    answers: Record<string, any>,
    opts: {
      visibleQuestionIds?: Set<string>;
      extraRequiredIds?: Set<string>;
      calculatedQuestionIds?: Set<string>;
      /**
       * Choice-list items referenced by this submission, keyed
       * `listSlug::value`. Pre-resolved by the caller in one batch.
       */
      choiceItems?: Map<string, ResolvedChoiceItem>;
    } = {},
  ): ValidationResult {
    const issues: ValidationIssue[] = [];
    const sanitized: Record<string, any> = {};

    const questions = Array.isArray(questionsJson)
      ? (questionsJson as QuestionLike[])
      : [];
    if (questions.length === 0) {
      return {
        valid: false,
        issues: [
          {
            questionId: '_form',
            code: 'EMPTY_SCHEMA',
            message:
              'This form version has no questions and cannot accept submissions.',
          },
        ],
        sanitized: {},
      };
    }

    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
      return {
        valid: false,
        issues: [
          {
            questionId: '_form',
            code: 'INVALID_PAYLOAD',
            message: 'Answers must be an object.',
          },
        ],
        sanitized: {},
      };
    }

    const answerKeys = Object.keys(answers);
    if (answerKeys.length > LIMITS.MAX_ANSWER_KEYS) {
      return {
        valid: false,
        issues: [
          {
            questionId: '_form',
            code: 'TOO_MANY_KEYS',
            message: `Payload contains ${answerKeys.length} answers; the maximum is ${LIMITS.MAX_ANSWER_KEYS}.`,
          },
        ],
        sanitized: {},
      };
    }

    const byteLength = Buffer.byteLength(JSON.stringify(answers), 'utf8');
    if (byteLength > LIMITS.MAX_PAYLOAD_BYTES) {
      return {
        valid: false,
        issues: [
          {
            questionId: '_form',
            code: 'PAYLOAD_TOO_LARGE',
            message: `Answer payload is ${byteLength} bytes; the maximum is ${LIMITS.MAX_PAYLOAD_BYTES}.`,
          },
        ],
        sanitized: {},
      };
    }

    for (const q of questions) {
      if (!q || typeof q.id !== 'string' || NON_ANSWERABLE.has(q.type))
        continue;

      const isVisible = opts.visibleQuestionIds
        ? opts.visibleQuestionIds.has(q.id)
        : true;
      const raw = answers[q.id];
      // A REQUIRE rule can make an otherwise-optional question mandatory. It can
      // only ever add: a rule must not be able to waive a requirement the author
      // set on the question itself.
      const requiredByRule = opts.extraRequiredIds?.has(q.id) ?? false;
      // ...with one exception. A CALCULATE rule owns its target's value: the
      // respondent's input for it is stripped and the value recomputed. If such
      // a field is also marked required and its formula yields nothing, the
      // respondent is told to fill in a field they are structurally forbidden
      // from filling, and the form becomes impossible for anyone to submit.
      // Requiredness is meaningless for a derived value, so it is not applied.
      const isCalculated = opts.calculatedQuestionIds?.has(q.id) ?? false;
      const required =
        !isCalculated &&
        ((q.required ?? q.validation?.required ?? false) || requiredByRule) &&
        isVisible;

      if (isEmpty(raw)) {
        if (required) {
          issues.push({
            questionId: q.id,
            label: q.label,
            code: 'REQUIRED',
            message: `"${q.label ?? q.id}" is required.`,
          });
        }
        continue;
      }

      // A hidden question that still carries a value is dropped rather than
      // rejected — logic may legitimately have hidden it after the user typed.
      if (!isVisible) continue;

      const outcome = this.validateOne(q, raw);
      if (outcome.issue) {
        issues.push({ questionId: q.id, label: q.label, ...outcome.issue });
        continue;
      }

      // Options that came from a managed list are checked against the list,
      // not against `q.options` — which is empty for such a question, and
      // whose emptiness `validateOne` deliberately reads as "unconfigured,
      // accept anything". Without this a list-backed dropdown would accept
      // any string at all.
      const listIssue = this.validateAgainstChoiceList(
        q,
        outcome.value,
        answers,
        questions,
        opts,
      );
      if (listIssue) {
        issues.push({ questionId: q.id, label: q.label, ...listIssue });
        continue;
      }

      sanitized[q.id] = outcome.value;
    }

    // Unknown keys are silently dropped rather than rejected: a stale client
    // submitting against a question removed in a newer version should still
    // succeed, but the junk must never reach the database.
    const knownIds = new Set(questions.map((q) => q.id));
    const unknown = answerKeys.filter((k) => !knownIds.has(k));
    if (unknown.length > 0) {
      this.logger.debug(
        `Dropped ${unknown.length} unknown answer key(s): ${unknown.slice(0, 5).join(', ')}`,
      );
    }

    return { valid: issues.length === 0, issues, sanitized };
  }

  /**
   * Membership and cascade consistency for a list-backed choice question.
   *
   * TWO CHECKS, AND THE SECOND IS THE ONE THAT MATTERS.
   *
   *  1. Membership — the submitted value is a real item of the named list.
   *  2. Cascade consistency — if the question is filtered by another, the
   *     submitted item's `parentValue` must equal the answer to that other
   *     question.
   *
   * Without (2) the UI is the only thing enforcing the hierarchy, and the UI is
   * not a security boundary. A crafted payload could pair a Kohima block with a
   * Phek district and the row would look entirely plausible in every export and
   * dashboard forever after. This is the kind of wrong data nobody finds.
   */
  private validateAgainstChoiceList(
    q: QuestionLike,
    value: any,
    answers: Record<string, any>,
    questions: QuestionLike[],
    opts: { choiceItems?: Map<string, ResolvedChoiceItem> },
  ): { code: string; message: string } | undefined {
    const source = q.optionsSource;
    if (!source || source.kind !== 'CHOICE_LIST' || !source.listSlug)
      return undefined;

    const label = q.label ?? q.id;
    const items = opts.choiceItems;
    // No catalogue supplied means the caller could not resolve one — fail
    // closed rather than accepting anything, since the alternative is silently
    // storing values that are not on the list.
    if (!items) {
      return {
        code: 'OPTION_SOURCE',
        message: `"${label}" could not be checked against its list.`,
      };
    }

    const submitted = Array.isArray(value) ? value : [value];

    for (const entry of submitted) {
      if (typeof entry !== 'string') {
        return {
          code: 'TYPE',
          message: `"${label}" must be a value from its list.`,
        };
      }

      const item = items.get(`${source.listSlug}::${entry}`);
      if (!item) {
        return {
          code: 'OPTION',
          message: `"${entry}" is not a valid option for "${label}".`,
        };
      }

      if (!source.parentQuestionKey) continue;

      const parentQuestion = questions.find(
        (other) => other.key === source.parentQuestionKey,
      );
      // A parent that is not on this version can only mean the form changed
      // under an in-flight respondent. Skip the consistency check rather than
      // reject: membership already passed, and the pairing is unverifiable.
      if (!parentQuestion) continue;

      const parentAnswer = answers[parentQuestion.id];
      if (typeof parentAnswer !== 'string' || parentAnswer === '') continue;

      if (item.parentValue !== parentAnswer) {
        return {
          code: 'CASCADE',
          message: `"${label}" does not belong to the selected "${parentQuestion.label ?? source.parentQuestionKey}".`,
        };
      }
    }

    return undefined;
  }

  // ──────────────────────────────────────────────────────────────────────────
  private validateOne(
    q: QuestionLike,
    raw: any,
  ): { value?: any; issue?: { code: string; message: string } } {
    const label = q.label ?? q.id;
    const v = q.validation ?? {};

    switch (q.type) {
      case 'SHORT_TEXT':
      case 'LONG_TEXT': {
        if (typeof raw !== 'string')
          return bad('TYPE', `"${label}" must be text.`);
        const cap =
          q.type === 'LONG_TEXT'
            ? LIMITS.MAX_LONG_TEXT_LENGTH
            : LIMITS.MAX_TEXT_LENGTH;
        const maxLen = Math.min(v.maxLength ?? cap, cap);
        if (raw.length > maxLen)
          return bad(
            'MAX_LENGTH',
            `"${label}" must be at most ${maxLen} characters.`,
          );
        if (v.minLength != null && raw.length < v.minLength)
          return bad(
            'MIN_LENGTH',
            `"${label}" must be at least ${v.minLength} characters.`,
          );
        if (v.pattern && !safeRegexTest(v.pattern, raw))
          return bad('PATTERN', `"${label}" is not in the expected format.`);
        return { value: raw };
      }

      case 'EMAIL': {
        if (typeof raw !== 'string')
          return bad('TYPE', `"${label}" must be text.`);
        const s = raw.trim().toLowerCase();
        if (s.length > 320 || !EMAIL_RE.test(s))
          return bad('EMAIL', `"${label}" must be a valid email address.`);
        return { value: s };
      }

      case 'URL': {
        if (typeof raw !== 'string')
          return bad('TYPE', `"${label}" must be text.`);
        const s = raw.trim();
        if (s.length > 2048 || !URL_RE.test(s))
          return bad('URL', `"${label}" must be a valid http(s) URL.`);
        return { value: s };
      }

      case 'PHONE': {
        if (typeof raw !== 'string')
          return bad('TYPE', `"${label}" must be text.`);
        const s = raw.trim();
        // A custom pattern (e.g. "exactly 10 digits") overrides the generic
        // format rather than adding to it — the author asked for something
        // narrower than "any plausible phone number", not something broader.
        const ok = v.pattern ? safeRegexTest(v.pattern, s) : PHONE_RE.test(s);
        if (!ok) return bad('PHONE', `"${label}" must be a valid phone number.`);
        return { value: s };
      }

      case 'NUMBER':
      case 'SLIDER': {
        const n = typeof raw === 'number' ? raw : Number(raw);
        if (!Number.isFinite(n))
          return bad('TYPE', `"${label}" must be a number.`);
        // A slider's bounds live on the question (`sliderMin`/`sliderMax`,
        // written by normalizeFormStructure); a number's live in `validation`.
        const min = q.type === 'SLIDER' ? (q.sliderMin ?? v.min) : v.min;
        const max = q.type === 'SLIDER' ? (q.sliderMax ?? v.max) : v.max;
        if (min != null && n < min)
          return bad('MIN', `"${label}" must be at least ${min}.`);
        if (max != null && n > max)
          return bad('MAX', `"${label}" must be at most ${max}.`);
        return { value: n };
      }

      case 'STAR_RATING': {
        // The runner renders a fixed 1–5 scale; `validation.max` narrows it.
        const ceiling = v.max ?? 5;
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 1 || n > ceiling)
          return bad(
            'RANGE',
            `"${label}" must be a whole number between 1 and ${ceiling}.`,
          );
        return { value: n };
      }

      case 'NPS': {
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 0 || n > 10)
          return bad(
            'RANGE',
            `"${label}" must be a whole number between 0 and 10.`,
          );
        return { value: n };
      }

      case 'DATE': {
        if (typeof raw !== 'string')
          return bad('TYPE', `"${label}" must be a date string.`);
        const d = new Date(raw);
        if (Number.isNaN(d.getTime()))
          return bad('DATE', `"${label}" must be a valid date.`);
        return { value: raw };
      }

      case 'SINGLE_CHOICE':
      case 'DROPDOWN': {
        if (typeof raw !== 'string')
          return bad('TYPE', `"${label}" must be a single choice.`);
        const allowed = optionValues(q);
        // An empty option list means the author left the question unconfigured;
        // accept the value rather than blocking the respondent.
        if (allowed.size > 0 && !allowed.has(raw))
          return bad(
            'OPTION',
            `"${raw}" is not a valid option for "${label}".`,
          );
        return { value: raw };
      }

      case 'MULTI_CHOICE': {
        if (!Array.isArray(raw))
          return bad('TYPE', `"${label}" must be a list of choices.`);
        if (raw.length > LIMITS.MAX_MULTI_CHOICE_SELECTIONS)
          return bad('TOO_MANY', `"${label}" has too many selections.`);
        const allowed = optionValues(q);
        const cleaned: string[] = [];
        for (const item of raw) {
          if (typeof item !== 'string')
            return bad('TYPE', `"${label}" contains a non-text selection.`);
          if (allowed.size > 0 && !allowed.has(item))
            return bad(
              'OPTION',
              `"${item}" is not a valid option for "${label}".`,
            );
          if (!cleaned.includes(item)) cleaned.push(item);
        }
        if (v.min != null && cleaned.length < v.min)
          return bad(
            'MIN',
            `"${label}" requires at least ${v.min} selection(s).`,
          );
        if (v.max != null && cleaned.length > v.max)
          return bad('MAX', `"${label}" allows at most ${v.max} selection(s).`);
        return { value: cleaned };
      }

      case 'MATRIX': {
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
          return bad('TYPE', `"${label}" must be a row/column map.`);
        const rowKeys = labelSet(q.matrixRows);
        const colKeys = labelSet(q.matrixColumns);
        const out: Record<string, any> = {};
        for (const [rowKey, colVal] of Object.entries(raw)) {
          if (rowKeys.size > 0 && !rowKeys.has(rowKey))
            return bad(
              'OPTION',
              `"${rowKey}" is not a valid row for "${label}".`,
            );
          if (Array.isArray(colVal)) {
            for (const c of colVal) {
              if (
                typeof c !== 'string' ||
                (colKeys.size > 0 && !colKeys.has(c))
              )
                return bad(
                  'OPTION',
                  `"${c}" is not a valid column for "${label}".`,
                );
            }
            out[rowKey] = colVal;
          } else if (typeof colVal === 'string') {
            if (colKeys.size > 0 && !colKeys.has(colVal))
              return bad(
                'OPTION',
                `"${colVal}" is not a valid column for "${label}".`,
              );
            out[rowKey] = colVal;
          } else {
            return bad('TYPE', `"${label}" has an invalid cell value.`);
          }
        }
        return { value: out };
      }

      case 'SIGNATURE': {
        if (typeof raw !== 'string')
          return bad('TYPE', `"${label}" must be a signature image.`);
        if (!raw.startsWith('data:image/'))
          return bad('SIGNATURE', `"${label}" must be a data-URL image.`);
        if (Buffer.byteLength(raw, 'utf8') > LIMITS.MAX_SIGNATURE_BYTES)
          return bad(
            'SIGNATURE_TOO_LARGE',
            `"${label}" signature image is too large.`,
          );
        return { value: raw };
      }

      case 'FILE_UPLOAD': {
        // The value is a FormSubmissionFile id (or a list of them). Existence and
        // ownership are checked separately by SubmissionsService against the DB —
        // here we only enforce shape so a caller cannot smuggle an object in.
        const ids = Array.isArray(raw) ? raw : [raw];
        if (ids.length > 20)
          return bad('TOO_MANY', `"${label}" has too many files.`);
        for (const id of ids) {
          if (typeof id !== 'string' || !UUID_OR_ID_RE.test(id))
            return bad(
              'FILE_REF',
              `"${label}" contains an invalid file reference.`,
            );
        }
        return { value: Array.isArray(raw) ? ids : ids[0] };
      }

      case 'REPEATING_SECTION': {
        if (!Array.isArray(raw))
          return bad('TYPE', `"${label}" must be a list of repeated entries.`);
        if (raw.length > LIMITS.MAX_REPEAT_ITEMS)
          return bad('TOO_MANY', `"${label}" has too many entries.`);
        for (const item of raw) {
          if (typeof item !== 'object' || item === null || Array.isArray(item))
            return bad('TYPE', `"${label}" contains an invalid entry.`);
        }
        return { value: raw };
      }

      case 'GPS_LOCATION': {
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
          return bad('TYPE', `"${label}" must be a location.`);
        const lat = Number((raw as Record<string, unknown>).lat);
        const lng = Number((raw as Record<string, unknown>).lng);
        if (!Number.isFinite(lat) || lat < -90 || lat > 90)
          return bad('LAT', `"${label}" has an invalid latitude.`);
        if (!Number.isFinite(lng) || lng < -180 || lng > 180)
          return bad('LNG', `"${label}" has an invalid longitude.`);

        const out: Record<string, any> = { lat, lng };
        const accuracy = Number((raw as Record<string, unknown>).accuracy);
        if (Number.isFinite(accuracy) && accuracy >= 0) out.accuracy = accuracy;
        const capturedAt = (raw as Record<string, unknown>).capturedAt;
        if (typeof capturedAt === 'string') out.capturedAt = capturedAt.slice(0, 40);

        return { value: out };
      }

      default: {
        // Unknown/forward-compatible type: accept primitives only, so a future
        // question type cannot be used as an arbitrary-JSON smuggling channel.
        if (typeof raw === 'object' && raw !== null)
          return bad('TYPE', `"${label}" has an unsupported value.`);
        return { value: raw };
      }
    }
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

function bad(code: string, message: string) {
  return { issue: { code, message } };
}

function isEmpty(v: any): boolean {
  return (
    v === undefined ||
    v === null ||
    (typeof v === 'string' && v.trim() === '') ||
    (Array.isArray(v) && v.length === 0) ||
    (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0)
  );
}

/**
 * Options may be authored as plain strings or as { label, value } objects.
 * Accept BOTH the label and the value so a client that echoes either one still
 * validates — the builder emits both fields and the runner has historically
 * submitted the label.
 */
function optionValues(q: QuestionLike): Set<string> {
  const out = new Set<string>();
  for (const o of q.options ?? []) {
    if (typeof o === 'string') out.add(o);
    else if (o && typeof o === 'object') {
      if (typeof o.value === 'string') out.add(o.value);
      if (typeof o.label === 'string') out.add(o.label);
    }
  }
  return out;
}

function labelSet(items?: any[]): Set<string> {
  const out = new Set<string>();
  for (const i of items ?? []) {
    if (typeof i === 'string') out.add(i);
    else if (i && typeof i === 'object') {
      if (typeof i.value === 'string') out.add(i.value);
      if (typeof i.label === 'string') out.add(i.label);
    }
  }
  return out;
}

/**
 * Author-supplied regex is untrusted input executed on the request path — a
 * catastrophic-backtracking pattern would hang the event loop. Cap the pattern
 * length and the subject length, and fail open on a malformed pattern.
 */
function safeRegexTest(pattern: string, subject: string): boolean {
  if (pattern.length > 200 || subject.length > 2000) return true;
  try {
    return new RegExp(pattern).test(subject);
  } catch {
    return true;
  }
}
