import { BadRequestException } from '@nestjs/common';

/**
 * Normalisation for the form definition the builder sends.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS
 *
 * `pages`, `questions` and `logic` reach the API as `@Allow()`-ed `any` and were
 * written straight into JSONB. Nothing checked them. Whatever a client sent —
 * duplicate question ids, `null` entries, a 40 MB string, logic rules pointing
 * at questions that no longer exist, a question claiming a page that is not in
 * `pages` — became the persisted definition of the form, and then the immutable
 * FormVersion, and then the schema the submission validator graded answers
 * against.
 *
 * Several of those are not cosmetic:
 *   • Two questions sharing an id merge into one key in the answers map, so one
 *     of them silently loses every response ever submitted to it.
 *   • A HIDE rule whose target no longer exists used to be evaluated against a
 *     missing field; a JUMP_TO_PAGE to a deleted page dead-ends the respondent.
 *   • An unbounded options array is a storage-exhaustion vector that also makes
 *     the public form page unusable.
 *
 * WHAT IT DOES NOT DO
 *
 * It is deliberately repair-first, not reject-first. A form is a person's work;
 * refusing an autosave because one option lost its id would lose everything
 * typed since the last successful save. So anything that can be safely repaired
 * is repaired (ids regenerated, dangling references dropped, values clamped),
 * and only genuinely unusable input — wrong container type, no id at all,
 * over-large payloads — is rejected outright.
 */

/** Mirrors QuestionType in the frontend's src/types/form.ts. */
const QUESTION_TYPES = new Set([
  'SHORT_TEXT',
  'LONG_TEXT',
  'NUMBER',
  'EMAIL',
  'PHONE',
  'URL',
  'SINGLE_CHOICE',
  'MULTI_CHOICE',
  'DROPDOWN',
  'STAR_RATING',
  'NPS',
  'SLIDER',
  'DATE',
  'FILE_UPLOAD',
  'SIGNATURE',
  'MATRIX',
  'SECTION_HEADER',
  'REPEATING_SECTION',
]);

const LOGIC_OPERATORS = new Set([
  'EQUALS',
  'NOT_EQUALS',
  'CONTAINS',
  'GREATER_THAN',
  'LESS_THAN',
  'IS_FILLED',
]);

const LOGIC_ACTIONS = new Set(['SHOW', 'HIDE', 'JUMP_TO_PAGE']);

const CHOICE_TYPES = new Set(['SINGLE_CHOICE', 'MULTI_CHOICE', 'DROPDOWN']);

/**
 * Ceilings, independent of anything the author configured. These are what a
 * form can physically be, not what is sensible.
 */
export const STRUCTURE_LIMITS = {
  MAX_QUESTIONS: 500,
  MAX_PAGES: 100,
  MAX_LOGIC_RULES: 1_000,
  MAX_OPTIONS_PER_QUESTION: 500,
  MAX_MATRIX_ROWS: 200,
  MAX_MATRIX_COLUMNS: 50,
  MAX_LABEL_LENGTH: 2_000,
  MAX_DESCRIPTION_LENGTH: 10_000,
  MAX_THEME_KEYS: 60,
  MAX_NOTIFY_EMAILS: 20,
  /** Serialised size of the whole definition. Below the 256 kb body limit. */
  MAX_DEFINITION_BYTES: 200 * 1024,
} as const;

export interface NormalizedStructure {
  pages: any[];
  questions: any[];
  logic: any[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Primitives
// ─────────────────────────────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function str(value: unknown, max: number, fallback = ''): string {
  if (typeof value !== 'string') return fallback;
  return value.length > max ? value.slice(0, max) : value;
}

function intOrUndefined(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

let idCounter = 0;
function generatedId(prefix: string) {
  idCounter = (idCounter + 1) % Number.MAX_SAFE_INTEGER;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pages
// ─────────────────────────────────────────────────────────────────────────────

function normalizePages(input: unknown): any[] {
  if (input == null) return [{ pageNumber: 1, title: 'Page 1', description: '' }];
  if (!Array.isArray(input)) {
    throw new BadRequestException('`pages` must be an array.');
  }
  if (input.length > STRUCTURE_LIMITS.MAX_PAGES) {
    throw new BadRequestException(`A form cannot have more than ${STRUCTURE_LIMITS.MAX_PAGES} pages.`);
  }

  const seen = new Set<number>();
  const pages: any[] = [];

  for (const raw of input) {
    if (!isPlainObject(raw)) continue;
    const pageNumber = intOrUndefined(raw.pageNumber);
    // A page without a usable number cannot be referenced by a question or a
    // JUMP_TO_PAGE rule, so it is not a page.
    if (pageNumber === undefined || pageNumber < 1) continue;
    if (seen.has(pageNumber)) continue;
    seen.add(pageNumber);

    pages.push({
      pageNumber,
      title: str(raw.title, STRUCTURE_LIMITS.MAX_LABEL_LENGTH, `Page ${pageNumber}`),
      description: str(raw.description, STRUCTURE_LIMITS.MAX_DESCRIPTION_LENGTH),
    });
  }

  if (pages.length === 0) return [{ pageNumber: 1, title: 'Page 1', description: '' }];
  return pages.sort((a, b) => a.pageNumber - b.pageNumber);
}

// ─────────────────────────────────────────────────────────────────────────────
// Questions
// ─────────────────────────────────────────────────────────────────────────────

function normalizeOptions(raw: unknown, questionLabel: string): any[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  if (raw.length > STRUCTURE_LIMITS.MAX_OPTIONS_PER_QUESTION) {
    throw new BadRequestException(
      `"${questionLabel}" has more than ${STRUCTURE_LIMITS.MAX_OPTIONS_PER_QUESTION} options.`,
    );
  }

  const seenIds = new Set<string>();
  const options: any[] = [];

  for (const option of raw) {
    if (!isPlainObject(option)) continue;

    // Option ids key the answer payload. A duplicate would make two options
    // indistinguishable in every response and every export.
    let id = typeof option.id === 'string' && option.id ? option.id : generatedId('opt');
    if (seenIds.has(id)) id = generatedId('opt');
    seenIds.add(id);

    const label = str(option.label, STRUCTURE_LIMITS.MAX_LABEL_LENGTH, 'Option');
    options.push({
      id,
      label,
      value: str(option.value, STRUCTURE_LIMITS.MAX_LABEL_LENGTH, label),
      ...(option.isCorrect === true ? { isCorrect: true } : {}),
    });
  }

  return options;
}

function normalizeValidation(raw: unknown): Record<string, any> {
  if (!isPlainObject(raw)) return {};

  const out: Record<string, any> = {};
  if (typeof raw.required === 'boolean') out.required = raw.required;

  for (const key of ['minLength', 'maxLength', 'min', 'max', 'maxSizeMb'] as const) {
    const n = intOrUndefined(raw[key]);
    if (n !== undefined) out[key] = n;
  }

  if (typeof raw.pattern === 'string' && raw.pattern.length <= 500) {
    // Stored, never compiled here. A pathological pattern is a ReDoS risk for
    // whoever *does* compile it, so cap the length and let the consumer decide.
    out.pattern = raw.pattern;
  }

  if (Array.isArray(raw.allowedTypes)) {
    out.allowedTypes = raw.allowedTypes
      .filter((t: unknown): t is string => typeof t === 'string')
      .slice(0, 50)
      .map((t) => t.slice(0, 100));
  }

  return out;
}

function normalizeQuestions(input: unknown, validPages: Set<number>): any[] {
  if (input == null) return [];
  if (!Array.isArray(input)) {
    throw new BadRequestException('`questions` must be an array.');
  }
  if (input.length > STRUCTURE_LIMITS.MAX_QUESTIONS) {
    throw new BadRequestException(
      `A form cannot have more than ${STRUCTURE_LIMITS.MAX_QUESTIONS} questions.`,
    );
  }

  const firstPage = validPages.values().next().value ?? 1;
  const seenIds = new Set<string>();
  const questions: any[] = [];

  for (const raw of input) {
    if (!isPlainObject(raw)) continue;

    const type = typeof raw.type === 'string' ? raw.type : '';
    if (!QUESTION_TYPES.has(type)) {
      throw new BadRequestException(
        `Unknown question type "${type || '(missing)'}". This form cannot be saved.`,
      );
    }

    // Ids are the join key between the schema and every answer ever recorded.
    // A duplicate merges two questions' responses; a missing one detaches all
    // of them. Neither is recoverable after the fact, so neither is allowed
    // through — but a *new* id is safe here, since a question the client failed
    // to identify cannot have answers bound to it yet.
    let id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : generatedId('q');
    if (seenIds.has(id)) id = generatedId('q');
    seenIds.add(id);

    const label = str(raw.label, STRUCTURE_LIMITS.MAX_LABEL_LENGTH, 'Untitled question');

    // A question on a page that does not exist is unreachable — the runner
    // renders pages, not orphans, so it would silently never be shown.
    const declaredPage = intOrUndefined(raw.pageNumber);
    const pageNumber =
      declaredPage !== undefined && validPages.has(declaredPage) ? declaredPage : firstPage;

    const question: Record<string, any> = {
      id,
      type,
      label,
      description: str(raw.description, STRUCTURE_LIMITS.MAX_DESCRIPTION_LENGTH),
      placeholder: str(raw.placeholder, STRUCTURE_LIMITS.MAX_LABEL_LENGTH),
      validation: normalizeValidation(raw.validation),
      pageNumber,
      colSpan: raw.colSpan === 1 ? 1 : 2,
    };

    // `required` was duplicated on the question and inside `validation`, and
    // the two disagreed depending on which control last wrote. `validation` is
    // what the submission validator reads, so that is the source of truth and
    // the mirror is kept consistent with it rather than the other way round.
    question.required = question.validation.required === true;
    question.validation.required = question.required;

    const options = normalizeOptions(raw.options, label);
    if (options) {
      if (CHOICE_TYPES.has(type) && options.length === 0) {
        throw new BadRequestException(
          `"${label}" is a choice question with no options. Add at least one.`,
        );
      }
      question.options = options;
    } else if (CHOICE_TYPES.has(type)) {
      throw new BadRequestException(
        `"${label}" is a choice question with no options. Add at least one.`,
      );
    }

    if (type === 'SLIDER') {
      const min = intOrUndefined(raw.sliderMin) ?? 0;
      const max = intOrUndefined(raw.sliderMax) ?? 100;
      const step = intOrUndefined(raw.sliderStep) ?? 1;
      question.sliderMin = min;
      // An inverted or zero-width range renders a slider the respondent cannot
      // move, and a step of 0 makes the control divide by zero.
      question.sliderMax = max > min ? max : min + 1;
      question.sliderStep = step > 0 ? step : 1;
    }

    if (type === 'MATRIX') {
      const rows = Array.isArray(raw.matrixRows) ? raw.matrixRows : [];
      const columns = Array.isArray(raw.matrixColumns) ? raw.matrixColumns : [];
      question.matrixRows = rows
        .filter((r: unknown): r is string => typeof r === 'string')
        .slice(0, STRUCTURE_LIMITS.MAX_MATRIX_ROWS)
        .map((r) => r.slice(0, STRUCTURE_LIMITS.MAX_LABEL_LENGTH));
      question.matrixColumns = columns
        .filter((c: unknown): c is string => typeof c === 'string')
        .slice(0, STRUCTURE_LIMITS.MAX_MATRIX_COLUMNS)
        .map((c) => c.slice(0, STRUCTURE_LIMITS.MAX_LABEL_LENGTH));
    }

    // ── Quiz ────────────────────────────────────────────────────────────────
    const points = intOrUndefined(raw.points);
    if (points !== undefined) question.points = Math.min(Math.max(points, 0), 1_000);

    if (typeof raw.correctAnswer === 'string') {
      question.correctAnswer = str(raw.correctAnswer, STRUCTURE_LIMITS.MAX_LABEL_LENGTH);
    } else if (Array.isArray(raw.correctAnswer)) {
      question.correctAnswer = raw.correctAnswer
        .filter((a: unknown): a is string => typeof a === 'string')
        .slice(0, STRUCTURE_LIMITS.MAX_OPTIONS_PER_QUESTION);
    }

    if (typeof raw.explanation === 'string') {
      question.explanation = str(raw.explanation, STRUCTURE_LIMITS.MAX_DESCRIPTION_LENGTH);
    }

    if (raw.defaultValue !== undefined && raw.defaultValue !== null) {
      question.defaultValue = raw.defaultValue;
    }

    questions.push(question);
  }

  return questions;
}

// ─────────────────────────────────────────────────────────────────────────────
// Logic
// ─────────────────────────────────────────────────────────────────────────────

function normalizeLogic(input: unknown, questionIds: Set<string>, pageNumbers: Set<number>): any[] {
  if (input == null) return [];
  if (!Array.isArray(input)) {
    throw new BadRequestException('`logic` must be an array.');
  }
  if (input.length > STRUCTURE_LIMITS.MAX_LOGIC_RULES) {
    throw new BadRequestException(
      `A form cannot have more than ${STRUCTURE_LIMITS.MAX_LOGIC_RULES} logic rules.`,
    );
  }

  const seenIds = new Set<string>();
  const rules: any[] = [];

  for (const raw of input) {
    if (!isPlainObject(raw)) continue;

    const operator = typeof raw.operator === 'string' ? raw.operator : '';
    const action = typeof raw.action === 'string' ? raw.action : '';
    if (!LOGIC_OPERATORS.has(operator) || !LOGIC_ACTIONS.has(action)) continue;

    // Dangling references are dropped rather than rejected. Deleting a question
    // is a normal, intentional act; it should not make the form unsaveable, and
    // a rule that can never fire is worse than no rule — a HIDE with a stale
    // target used to hide a live field with no way to find out why.
    const triggerQuestionId = typeof raw.triggerQuestionId === 'string' ? raw.triggerQuestionId : '';
    if (!questionIds.has(triggerQuestionId)) continue;

    let id = typeof raw.id === 'string' && raw.id ? raw.id : generatedId('logic');
    if (seenIds.has(id)) id = generatedId('logic');
    seenIds.add(id);

    const rule: Record<string, any> = {
      id,
      triggerQuestionId,
      operator,
      action,
      value: str(raw.value, STRUCTURE_LIMITS.MAX_LABEL_LENGTH),
    };

    if (action === 'JUMP_TO_PAGE') {
      const target = intOrUndefined(raw.targetPageNumber);
      if (target === undefined || !pageNumbers.has(target)) continue;
      rule.targetPageNumber = target;
    } else {
      const target = typeof raw.targetQuestionId === 'string' ? raw.targetQuestionId : '';
      if (!questionIds.has(target)) continue;
      // A rule whose trigger is its own target can never settle: showing the
      // field changes the answer that decides whether to show it.
      if (target === triggerQuestionId) continue;
      rule.targetQuestionId = target;
    }

    rules.push(rule);
  }

  return rules;
}

// ─────────────────────────────────────────────────────────────────────────────
// Theme
// ─────────────────────────────────────────────────────────────────────────────

const THEME_URL_KEYS = new Set(['coverImageUrl', 'logoUrl']);

export function normalizeTheme(input: unknown): Record<string, any> {
  if (input == null) return {};
  if (!isPlainObject(input)) {
    throw new BadRequestException('`themeConfig` must be an object.');
  }

  const entries = Object.entries(input).slice(0, STRUCTURE_LIMITS.MAX_THEME_KEYS);
  const theme: Record<string, any> = {};

  for (const [key, value] of entries) {
    if (typeof value === 'boolean' || typeof value === 'number') {
      theme[key] = value;
      continue;
    }
    if (typeof value !== 'string') continue;

    if (THEME_URL_KEYS.has(key)) {
      // These are interpolated straight into `src`/`background-image` on the
      // public page. `javascript:` and `data:text/html` there are stored XSS
      // against every respondent.
      const trimmed = value.trim();
      if (!trimmed) continue;
      if (!/^https?:\/\//i.test(trimmed)) continue;
      theme[key] = trimmed.slice(0, 2_000);
      continue;
    }

    theme[key] = value.slice(0, 500);
  }

  return theme;
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate and repair a form definition.
 *
 * Any of the three parts may be `undefined`, meaning "not being changed" — in
 * that case pass the currently persisted value in as `current` so cross-part
 * checks (a logic rule against a question, a question against a page) are made
 * against the definition that will actually exist after the write, not against
 * a fragment of it.
 */
export function normalizeFormStructure(
  input: { pages?: unknown; questions?: unknown; logic?: unknown },
  current: { pages?: unknown; questions?: unknown; logic?: unknown } = {},
): NormalizedStructure {
  const pages = normalizePages(input.pages !== undefined ? input.pages : current.pages);
  const pageNumbers = new Set<number>(pages.map((p) => p.pageNumber));

  const questions = normalizeQuestions(
    input.questions !== undefined ? input.questions : current.questions,
    pageNumbers,
  );
  const questionIds = new Set<string>(questions.map((q) => q.id));

  const logic = normalizeLogic(
    input.logic !== undefined ? input.logic : current.logic,
    questionIds,
    pageNumbers,
  );

  const bytes = Buffer.byteLength(JSON.stringify({ pages, questions, logic }), 'utf8');
  if (bytes > STRUCTURE_LIMITS.MAX_DEFINITION_BYTES) {
    throw new BadRequestException(
      `This form is too large to save (${Math.round(bytes / 1024)} kb of ` +
        `${Math.round(STRUCTURE_LIMITS.MAX_DEFINITION_BYTES / 1024)} kb). ` +
        'Split it across multiple forms or shorten long descriptions.',
    );
  }

  return { pages, questions, logic };
}

/** Trim, lowercase and de-duplicate notification addresses. */
export function normalizeNotifyEmails(input: unknown): string[] {
  if (!Array.isArray(input)) return [];

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const seen = new Set<string>();

  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const email = raw.trim().toLowerCase();
    if (!email || email.length > 254 || !emailRe.test(email)) continue;
    seen.add(email);
    if (seen.size >= STRUCTURE_LIMITS.MAX_NOTIFY_EMAILS) break;
  }

  return [...seen];
}
