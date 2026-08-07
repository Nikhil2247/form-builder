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

export interface FormQuestion {
  id: string;
  type: QuestionType;
  label: string;
  description?: string;
  placeholder?: string;
  required?: boolean;
  defaultValue?: string | number | string[];
  options?: QuestionOption[];
  matrixRows?: string[];
  matrixColumns?: string[];
  validation: QuestionValidation;
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
  notifyEmails: string | null;
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
