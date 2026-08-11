export type QuestionType =
  | 'SHORT_TEXT'
  | 'LONG_TEXT'
  | 'NUMBER'
  | 'EMAIL'
  | 'PHONE'
  | 'URL'
  | 'SINGLE_CHOICE'
  | 'MULTI_CHOICE'
  | 'DROPDOWN'
  | 'STAR_RATING'
  | 'NPS'
  | 'SLIDER'
  | 'DATE'
  | 'FILE_UPLOAD'
  | 'SIGNATURE'
  | 'MATRIX'
  | 'SECTION_HEADER'
  | 'REPEATING_SECTION';

/** How wide a question sits in a GRID-layout form. */
export type QuestionWidth = 'AUTO' | 'HALF' | 'FULL';

/**
 * Question types that need the full row whatever the author asked for.
 *
 * A matrix squeezed into half a row scrolls sideways, and a long answer box at
 * half width invites one-line replies to a question that wanted a paragraph.
 * These are layout facts about the control, not preferences.
 */
const ALWAYS_FULL_WIDTH: ReadonlySet<QuestionType> = new Set<QuestionType>([
  'LONG_TEXT',
  'MATRIX',
  'FILE_UPLOAD',
  'SIGNATURE',
  'REPEATING_SECTION',
  'SECTION_HEADER',
]);

/**
 * Types `AUTO` gives the whole row to, but which an author may still squeeze
 * into one column if they want to.
 *
 * An NPS is eleven buttons in a row and a slider needs its track plus both end
 * labels; at half width on a laptop both wrap into something unreadable. They
 * are not *impossible* at half width the way a matrix is, though — a short
 * 0–10 scale beside a related question is a legitimate thing to want — so
 * these belong here rather than in ALWAYS_FULL_WIDTH, where the author's
 * choice would be overridden rather than merely defaulted.
 */
const WIDE_BY_DEFAULT: ReadonlySet<QuestionType> = new Set<QuestionType>(['NPS', 'SLIDER']);

/**
 * Columns a question occupies in a two-column GRID form.
 *
 * The single place that decision is made, so the builder's preview, the public
 * form, and the app runner cannot disagree about it.
 *
 * ── Why AUTO is not just "half" ────────────────────────────────────────────
 * It used to be: AUTO and HALF both returned 1 for every type that was not in
 * ALWAYS_FULL_WIDTH, and for the types that *were* in it the builder hid the
 * control altogether. So HALF could not differ from AUTO anywhere, in any
 * form — an author picked it, nothing moved, and the setting looked broken
 * because for all practical purposes it was. AUTO now means what it says: the
 * question type decides, and the two types that read badly in one column take
 * the row. HALF is the override that forces one column anyway.
 */
export function gridSpanOf(question: Pick<FormQuestion, 'type' | 'width'>): 1 | 2 {
  // Not a preference — a matrix or a signature pad in one column is broken,
  // whatever was stored against it.
  if (ALWAYS_FULL_WIDTH.has(question.type)) return 2;

  if (question.width === 'FULL') return 2;
  if (question.width === 'HALF') return 1;

  // AUTO, or absent on a form authored before the setting existed.
  return WIDE_BY_DEFAULT.has(question.type) ? 2 : 1;
}

export interface QuestionOption {
  id: string;
  label: string;
  value: string;
  isCorrect?: boolean;
}

export interface QuestionValidation {
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: string;
  allowedTypes?: string[];
  maxSizeMb?: number;
}

/**
 * Where a choice question's options come from, when not typed in by hand.
 *
 * Absent means the legacy behaviour: the static `options` array on the
 * question. Present means the options are served from a managed ChoiceList,
 * which is what makes a 784-row district dropdown, a District→Block→School
 * cascade, and `lookup()` auto-fill possible at all.
 */
export interface QuestionOptionsSource {
  kind: 'CHOICE_LIST';
  /** ChoiceList.slug, resolved within the org then falling back to global. */
  listSlug: string;
  /**
   * Cascade: offer only the items whose `parentValue` equals the answer to
   * this question.
   *
   * Addressed by KEY, like rules — the same reason. A key can be renamed
   * without touching stored answers; a label cannot be relied on at all.
   * The question must appear EARLIER in the form, or the respondent would meet
   * a dropdown filtered by something they have not been asked yet.
   */
  parentQuestionKey?: string;
  /** Metadata column to display instead of `label`. */
  displayField?: string;
  /** Type-to-search rather than a plain select. Forced on for large lists. */
  searchable?: boolean;
}

export interface FormQuestion {
  id: string;
  /**
   * Short, formula-safe name rules address this question by — "Date of birth"
   * becomes `date_of_birth`.
   *
   * Derived from the label server-side (and de-duplicated there), so it is
   * absent on a question that has not been through a save yet. Rules are
   * written against keys rather than ids so a formula reads
   * `yearsBetween(dob, today())` instead of `yearsBetween(q_7f3a91, today())`,
   * and so a key can be renamed without touching a single stored answer —
   * answers stay keyed by `id`, which never changes.
   */
  key?: string;
  type: QuestionType;
  label: string;
  description?: string;
  placeholder?: string;
  required?: boolean;
  defaultValue?: string | number | string[];
  options?: QuestionOption[];
  /** Present = options come from a managed list rather than `options`. */
  optionsSource?: QuestionOptionsSource;
  matrixRows?: string[];
  matrixColumns?: string[];
  validation: QuestionValidation;
  /**
   * How wide this question sits in a GRID-layout form. Ignored by DOCUMENT and
   * CONVERSATIONAL, which are single-column by definition.
   *
   * `AUTO` (the default) picks by question type — a short answer takes half a
   * row, a long answer or a matrix takes the whole one. See `gridSpanOf`.
   *
   * REPLACES `colSpan`, which could not express this. `colSpan` defaulted to 2
   * in three separate places and the builder never offered a control for it, so
   * every question on every form carried "full width" and GRID rendered exactly
   * like DOCUMENT. Those stored 2s are indistinguishable from a deliberate
   * choice, and no author ever made one, so the runner ignores `colSpan`
   * entirely rather than honouring a preference nobody expressed.
   */
  width?: QuestionWidth;
  /** @deprecated Superseded by `width`. Still normalised so old forms load. */
  colSpan?: 1 | 2;
  pageNumber?: number;
  
  // For repeating sections
  subQuestions?: FormQuestion[];

  // Slider Props
  sliderMin?: number;
  sliderMax?: number;
  sliderStep?: number;

  // Answer Key & Marks
  points?: number; // 0 = no marks assigned, >0 = assigned marks
  correctAnswer?: string | string[];
  explanation?: string;
}

/**
 * The rules engine's own types are the single source of truth for what a rule
 * is; re-exported here so form consumers have one import for the document
 * shape. `src/lib/rules` is a byte-for-byte mirror of the backend package and
 * must not be edited.
 */
export type { FormRule, RuleKind, ExprNode } from '@/lib/rules';
import type { FormRule } from '@/lib/rules';

export type LogicOperator = 'EQUALS' | 'NOT_EQUALS' | 'CONTAINS' | 'GREATER_THAN' | 'LESS_THAN' | 'IS_FILLED';
export type LogicAction = 'SHOW' | 'HIDE' | 'JUMP_TO_PAGE';

export interface LogicRule {
  id: string;
  triggerQuestionId: string;
  operator: LogicOperator;
  value: string;
  action: LogicAction;
  targetQuestionId?: string;
  targetPageNumber?: number;
}

export type ThemePreset = 'purple' | 'indigo' | 'emerald' | 'sunset' | 'midnight' | 'glass' | 'neon' | 'slate';

export interface FormTheme {
  preset: ThemePreset;
  primaryColor: string;
  backgroundColor: string;
  cardColor: string;
  textColor: string;
  fontFamily: 'Inter' | 'Roboto' | 'Outfit' | 'Plus Jakarta Sans';
  borderRadius: 'none' | 'sm' | 'md' | 'lg' | 'full';
  cardVariant: 'card' | 'elevated' | 'glass' | 'minimal';
  coverImageUrl?: string;
  logoUrl?: string;
}

export interface FormPage {
  pageNumber: number;
  title: string;
  description?: string;
}

export type FormLayoutMode = 'DOCUMENT' | 'CONVERSATIONAL' | 'GRID' | 'PORTAL';

/**
 * Form-level settings.
 *
 * Every field here maps to a real column on `Form`. They all existed in the
 * schema and in the API DTOs, but the builder had no UI for any of them and
 * never sent them, so an org could not close a form, cap responses, restrict it
 * to signed-in users, or get notified of a submission — the columns just sat at
 * their defaults forever.
 *
 * `password` is deliberately absent: it is write-only, never read back from the
 * API (only `isPasswordProtected` is), and is carried separately so it is not
 * held in memory for the lifetime of the editing session.
 */
export interface FormSettings {
  /** Public URL segment: /f/{slug}. Unique across the whole platform. */
  slug: string;
  layoutMode: FormLayoutMode;
  /** Respondent must be a signed-in user. */
  requireAuth: boolean;
  /** When false, one response per respondent fingerprint. */
  allowMultiple: boolean;
  /** Form auto-closes after this many responses. null = unlimited. */
  maxSubmissions: number | null;
  /** ISO datetime after which responses are rejected. null = never. */
  expiresAt: string | null;
  isPasswordProtected: boolean;
  /** Addresses notified on each new response. */
  notifyEmails: string[];
}

/**
 * The form as the builder and runner work with it.
 *
 * NOTE: these fields were previously declared as pagesJson/questionsJson/
 * logicJson/themeConfig — the database column names — while every consumer
 * (builder page, FormCanvas, FormRunner, LogicBuilder, ThemeCustomizer,
 * SubmissionsView, excelExport) accessed pages/questions/logic/theme. The type
 * therefore never matched the code and the frontend did not typecheck.
 *
 * The API-shaped payload is `Form` below; mapping between the two happens where
 * the form is loaded.
 */
export interface FormConfig {
  id: string;
  title: string;
  description: string;
  isQuizMode?: boolean;
  pages: FormPage[];
  questions: FormQuestion[];
  logic: LogicRule[];
  /**
   * Calculation, visibility, requiredness and validation rules — the safe JSON
   * expression trees authored in RulesBuilder. Compiled at publish by
   * `compileRules`; absent on forms saved before the feature existed.
   */
  rules?: FormRule[];
  theme: FormTheme;
  createdAt: string;
  updatedAt: string;

  // ── Present when loaded from the public endpoint ──────────────────────────
  /** Immutable version the respondent is filling; echoed back on submit. */
  formVersionId?: string;
  version?: number;
  slug?: string;
  status?: 'DRAFT' | 'PUBLISHED' | 'CLOSED' | 'ARCHIVED';
  layoutMode?: string;
  isPasswordProtected?: boolean;
  requireAuth?: boolean;
}

/**
 * Map the API/persisted `Form` shape onto the domain `FormConfig` the builder
 * and viewer components work with.
 */
export function toFormConfig(form: Form): FormConfig {
  return {
    id: form.id,
    title: form.title,
    description: form.description ?? '',
    isQuizMode: form.isQuizMode,
    pages: form.pagesJson ?? [],
    questions: form.questionsJson ?? [],
    logic: form.logicJson ?? [],
    rules: form.rulesJson ?? [],
    theme: form.themeConfig,
    createdAt: form.createdAt,
    updatedAt: form.updatedAt,
    slug: form.slug,
    status: form.status,
    layoutMode: form.layoutMode,
    isPasswordProtected: form.isPasswordProtected,
    requireAuth: form.requireAuth,
  };
}

export interface Form {
  id: string;
  organizationId: string;
  createdById: string;
  slug: string;
  title: string;
  description: string;
  status: 'DRAFT' | 'PUBLISHED' | 'CLOSED' | 'ARCHIVED';
  layoutMode: string;
  isQuizMode: boolean;
  isPasswordProtected: boolean;
  passwordHash: string | null;
  requireAuth: boolean;
  allowMultiple: boolean;
  maxSubmissions: number | null;
  expiresAt: string | null;
  currentVersion: number;
  themeConfig: FormTheme;
  pagesJson: FormPage[];
  questionsJson: FormQuestion[];
  logicJson: LogicRule[];
  /** JSONB array column. Optional because older API builds do not project it. */
  rulesJson?: FormRule[];
  /**
   * Subject type the form is bound to, when it is one.
   *
   * This is what decides whether cross-form `ref` nodes are legal: a reference
   * reads another form's answer *for the same subject*, so without a subject
   * there is nothing to look the value up against and the compiler rejects it.
   */
  subjectTypeId?: string | null;
  /** JSONB array column. Was typed `string | null`, which it never is. */
  notifyEmails: string[] | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
  _count?: {
    submissions: number;
  };
}

export interface FormSubmission {
  id: string;
  formId: string;
  submittedAt: string;
  completionTimeMs: number;
  answers: Record<string, any>;
  quizScore?: number;
  maxQuizScore?: number;
}
