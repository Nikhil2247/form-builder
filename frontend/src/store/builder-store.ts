'use client';

import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type {
  FormConfig,
  FormPage,
  FormQuestion,
  FormTheme,
  LogicRule,
  QuestionType,
} from '@/types/form';

/**
 * Form builder state.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * The builder held the entire form in one `useState<FormConfig>` on the page
 * component. Every keystroke in any field ran `setForm(prev => ({...prev,
 * questions: prev.questions.map(...)}))`, producing a new object identity for
 * the form, the questions array, and — because `EnterpriseFieldCard` took
 * `allQuestions={form.questions}` — new props for *every* card on the canvas.
 *
 * With 40 questions that is 40 card re-renders per character, each re-running
 * dnd-kit's `useSortable`, re-deriving transform styles, and re-rendering the
 * card's own input subtree. Typing a label visibly lagged behind the keyboard,
 * and dragging a card stuttered because the drag overlay competed with the same
 * render pass.
 *
 * ── The fix ────────────────────────────────────────────────────────────────
 * Questions are normalised into `byId` + `order`. A card subscribes only to
 * `byId[itsOwnId]`, so editing Q1 changes one map entry and re-renders exactly
 * one card. The canvas subscribes to `order` alone (shallow-compared), so it
 * re-renders only when questions are added, removed, or reordered — not when
 * their contents change.
 *
 * Selectors below are the supported API. Reading `useBuilderStore(s => s.form)`
 * would reintroduce the original problem, so `form` is not stored as an object
 * at all — it is assembled on demand by `selectFormConfig`.
 */

export interface BuilderState {
  // ── Document ──────────────────────────────────────────────────────────────
  id: string;
  title: string;
  description: string;
  isQuizMode: boolean;
  theme: FormTheme;
  pages: FormPage[];
  logic: LogicRule[];
  /** Question order, by id. */
  order: string[];
  /** Questions keyed by id. Editing one entry touches nothing else. */
  byId: Record<string, FormQuestion>;

  // ── Editor session ────────────────────────────────────────────────────────
  selectedQuestionId: string | null;
  activeView: 'BUILDER' | 'LOGIC';
  status: 'DRAFT' | 'PUBLISHED' | 'CLOSED' | 'ARCHIVED';
  slug: string | null;
  isDirty: boolean;
  hasUnpublishedChanges: boolean;
  isLoading: boolean;
  /** Monotonic counter bumped on every content change; drives autosave. */
  revision: number;

  // ── Actions ───────────────────────────────────────────────────────────────
  load: (form: FormConfig, meta?: { status?: BuilderState['status']; slug?: string | null; hasUnpublishedChanges?: boolean }) => void;
  reset: () => void;
  setLoading: (loading: boolean) => void;

  setTitle: (title: string) => void;
  setDescription: (description: string) => void;
  setQuizMode: (enabled: boolean) => void;
  setTheme: (theme: FormTheme | ((current: FormTheme) => FormTheme)) => void;

  addQuestion: (type: QuestionType, afterId?: string | null) => string;
  /** Partial update — merges into the existing question. */
  patchQuestion: (id: string, patch: Partial<FormQuestion>) => void;
  replaceQuestion: (question: FormQuestion) => void;
  duplicateQuestion: (id: string) => string | null;
  deleteQuestion: (id: string) => void;
  moveQuestion: (activeId: string, overId: string) => void;

  addPage: () => void;
  updatePage: (pageNumber: number, patch: Partial<FormPage>) => void;
  deletePage: (pageNumber: number) => void;

  setLogic: (logic: LogicRule[]) => void;
  addLogicRule: (rule: LogicRule) => void;
  updateLogicRule: (id: string, patch: Partial<LogicRule>) => void;
  deleteLogicRule: (id: string) => void;

  selectQuestion: (id: string | null) => void;
  setActiveView: (view: 'BUILDER' | 'LOGIC') => void;
  markSaved: () => void;
  markPublished: () => void;
}

export const DEFAULT_THEME: FormTheme = {
  preset: 'slate',
  primaryColor: '#18181b',
  backgroundColor: '#ffffff',
  cardColor: '#ffffff',
  textColor: '#18181b',
  fontFamily: 'Inter',
  borderRadius: 'md',
  cardVariant: 'card',
};

const CHOICE_TYPES: QuestionType[] = ['SINGLE_CHOICE', 'MULTI_CHOICE', 'DROPDOWN'];

const TYPE_LABELS: Partial<Record<QuestionType, string>> = {
  SHORT_TEXT: 'Short answer',
  LONG_TEXT: 'Long answer',
  NUMBER: 'Number',
  EMAIL: 'Email address',
  PHONE: 'Phone number',
  URL: 'Website',
  SINGLE_CHOICE: 'Choose one',
  MULTI_CHOICE: 'Choose all that apply',
  DROPDOWN: 'Select an option',
  STAR_RATING: 'Rating',
  NPS: 'How likely are you to recommend us?',
  SLIDER: 'Select a value',
  DATE: 'Date',
  FILE_UPLOAD: 'Upload a file',
  SIGNATURE: 'Signature',
  MATRIX: 'Rate the following',
  SECTION_HEADER: 'Section',
  REPEATING_SECTION: 'Repeating section',
};

/**
 * Ids must be unique within a form and stable across a session.
 * `Date.now()` alone — the previous scheme — collides whenever two questions
 * are added within the same millisecond, which the "duplicate" and paste paths
 * do routinely. Colliding ids silently merge two questions' answers on submit.
 */
let idCounter = 0;
function newId(prefix: string) {
  idCounter += 1;
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${random}${idCounter.toString(36)}`;
}

function createQuestion(type: QuestionType): FormQuestion {
  return {
    id: newId('q'),
    type,
    label: TYPE_LABELS[type] ?? 'Untitled question',
    description: '',
    placeholder: '',
    required: false,
    validation: { required: false },
    colSpan: 2,
    pageNumber: 1,
    options: CHOICE_TYPES.includes(type)
      ? [
          { id: newId('opt'), label: 'Option 1', value: 'option_1' },
          { id: newId('opt'), label: 'Option 2', value: 'option_2' },
        ]
      : undefined,
    ...(type === 'SLIDER' ? { sliderMin: 0, sliderMax: 100, sliderStep: 1 } : {}),
    ...(type === 'MATRIX'
      ? { matrixRows: ['Row 1', 'Row 2'], matrixColumns: ['Poor', 'Fair', 'Good'] }
      : {}),
  };
}

function emptyState() {
  return {
    id: '',
    title: 'Untitled form',
    description: '',
    isQuizMode: false,
    theme: { ...DEFAULT_THEME },
    pages: [{ pageNumber: 1, title: 'Page 1', description: '' }] as FormPage[],
    logic: [] as LogicRule[],
    order: [] as string[],
    byId: {} as Record<string, FormQuestion>,
    selectedQuestionId: null,
    activeView: 'BUILDER' as const,
    status: 'DRAFT' as const,
    slug: null,
    isDirty: false,
    hasUnpublishedChanges: false,
    isLoading: true,
    revision: 0,
  };
}

export const useBuilderStore = create<BuilderState>()((set, get) => ({
  ...emptyState(),

  load: (form, meta) => {
    const order: string[] = [];
    const byId: Record<string, FormQuestion> = {};

    // Defensive: the API's JSON columns are untyped, and forms saved by older
    // builds contain nulls and stray arrays that used to crash the canvas.
    for (const q of Array.isArray(form.questions) ? form.questions : []) {
      if (!q || typeof q !== 'object' || Array.isArray(q) || !q.id) continue;
      if (byId[q.id]) continue; // duplicate id — keep the first
      byId[q.id] = { ...q, validation: q.validation ?? {} };
      order.push(q.id);
    }

    const pages = (Array.isArray(form.pages) ? form.pages : []).filter(
      (p): p is FormPage => !!p && typeof p === 'object' && !Array.isArray(p),
    );

    set({
      id: form.id ?? '',
      title: form.title || 'Untitled form',
      description: form.description ?? '',
      isQuizMode: form.isQuizMode ?? false,
      theme:
        form.theme && Object.keys(form.theme).length
          ? { ...DEFAULT_THEME, ...form.theme }
          : { ...DEFAULT_THEME },
      pages: pages.length ? pages : [{ pageNumber: 1, title: 'Page 1', description: '' }],
      logic: (Array.isArray(form.logic) ? form.logic : []).filter(Boolean),
      order,
      byId,
      selectedQuestionId: order[0] ?? null,
      status: meta?.status ?? (form.status as BuilderState['status']) ?? 'DRAFT',
      slug: meta?.slug ?? form.slug ?? null,
      hasUnpublishedChanges: meta?.hasUnpublishedChanges ?? false,
      isDirty: false,
      isLoading: false,
      revision: 0,
    });
  },

  reset: () => set({ ...emptyState(), isLoading: false }),
  setLoading: (isLoading) => set({ isLoading }),

  setTitle: (title) => set((s) => ({ title, isDirty: true, revision: s.revision + 1 })),
  setDescription: (description) =>
    set((s) => ({ description, isDirty: true, revision: s.revision + 1 })),
  setQuizMode: (isQuizMode) => set((s) => ({ isQuizMode, isDirty: true, revision: s.revision + 1 })),
  setTheme: (theme) =>
    set((s) => ({
      theme: typeof theme === 'function' ? theme(s.theme) : theme,
      isDirty: true,
      revision: s.revision + 1,
    })),

  addQuestion: (type, afterId) => {
    const question = createQuestion(type);
    set((s) => {
      const order = [...s.order];
      const at = afterId ? order.indexOf(afterId) : -1;
      if (at >= 0) order.splice(at + 1, 0, question.id);
      else order.push(question.id);

      return {
        order,
        byId: { ...s.byId, [question.id]: question },
        selectedQuestionId: question.id,
        isDirty: true,
        revision: s.revision + 1,
      };
    });
    return question.id;
  },

  patchQuestion: (id, patch) =>
    set((s) => {
      const current = s.byId[id];
      if (!current) return s;
      return {
        // Only this key's identity changes. Cards bound to other ids do not
        // re-render, which is the entire point of the normalised shape.
        byId: { ...s.byId, [id]: { ...current, ...patch } },
        isDirty: true,
        revision: s.revision + 1,
      };
    }),

  replaceQuestion: (question) =>
    set((s) =>
      s.byId[question.id]
        ? {
            byId: { ...s.byId, [question.id]: question },
            isDirty: true,
            revision: s.revision + 1,
          }
        : s,
    ),

  duplicateQuestion: (id) => {
    const source = get().byId[id];
    if (!source) return null;

    const copy: FormQuestion = {
      ...structuredClone(source),
      id: newId('q'),
      label: `${source.label} (copy)`,
      // Option ids must be regenerated too, or the two questions share option
      // identity and answer-key edits on one silently rewrite the other.
      options: source.options?.map((o) => ({ ...o, id: newId('opt') })),
    };

    set((s) => {
      const order = [...s.order];
      order.splice(order.indexOf(id) + 1, 0, copy.id);
      return {
        order,
        byId: { ...s.byId, [copy.id]: copy },
        selectedQuestionId: copy.id,
        isDirty: true,
        revision: s.revision + 1,
      };
    });
    return copy.id;
  },

  deleteQuestion: (id) =>
    set((s) => {
      if (!s.byId[id]) return s;
      const { [id]: _removed, ...byId } = s.byId;
      const order = s.order.filter((q) => q !== id);

      return {
        byId,
        order,
        // Logic rules pointing at a deleted question used to survive and were
        // serialised into the published version, where the runner evaluated a
        // trigger that could never fire and hid the target field forever.
        logic: s.logic.filter((r) => r.triggerQuestionId !== id && r.targetQuestionId !== id),
        selectedQuestionId:
          s.selectedQuestionId === id ? (order[0] ?? null) : s.selectedQuestionId,
        isDirty: true,
        revision: s.revision + 1,
      };
    }),

  moveQuestion: (activeId, overId) =>
    set((s) => {
      const from = s.order.indexOf(activeId);
      const to = s.order.indexOf(overId);
      if (from === -1 || to === -1 || from === to) return s;

      const order = [...s.order];
      order.splice(to, 0, order.splice(from, 1)[0]);
      return { order, isDirty: true, revision: s.revision + 1 };
    }),

  addPage: () =>
    set((s) => {
      const pageNumber = Math.max(0, ...s.pages.map((p) => p.pageNumber)) + 1;
      return {
        pages: [...s.pages, { pageNumber, title: `Page ${pageNumber}`, description: '' }],
        isDirty: true,
        revision: s.revision + 1,
      };
    }),

  updatePage: (pageNumber, patch) =>
    set((s) => ({
      pages: s.pages.map((p) => (p.pageNumber === pageNumber ? { ...p, ...patch } : p)),
      isDirty: true,
      revision: s.revision + 1,
    })),

  deletePage: (pageNumber) =>
    set((s) => {
      if (s.pages.length <= 1) return s;
      const byId = { ...s.byId };
      // Questions on the removed page move to page 1 rather than vanishing.
      for (const id of s.order) {
        if (byId[id]?.pageNumber === pageNumber) byId[id] = { ...byId[id], pageNumber: 1 };
      }
      return {
        pages: s.pages.filter((p) => p.pageNumber !== pageNumber),
        byId,
        isDirty: true,
        revision: s.revision + 1,
      };
    }),

  setLogic: (logic) => set((s) => ({ logic, isDirty: true, revision: s.revision + 1 })),
  addLogicRule: (rule) =>
    set((s) => ({ logic: [...s.logic, rule], isDirty: true, revision: s.revision + 1 })),
  updateLogicRule: (id, patch) =>
    set((s) => ({
      logic: s.logic.map((r) => (r.id === id ? { ...r, ...patch } : r)),
      isDirty: true,
      revision: s.revision + 1,
    })),
  deleteLogicRule: (id) =>
    set((s) => ({
      logic: s.logic.filter((r) => r.id !== id),
      isDirty: true,
      revision: s.revision + 1,
    })),

  selectQuestion: (selectedQuestionId) => set({ selectedQuestionId }),
  setActiveView: (activeView) => set({ activeView }),

  markSaved: () =>
    set((s) => ({
      isDirty: false,
      // Saving writes the draft columns but not a FormVersion, so a published
      // form now differs from what respondents see.
      hasUnpublishedChanges: s.status === 'PUBLISHED' ? true : s.hasUnpublishedChanges,
    })),

  markPublished: () => set({ status: 'PUBLISHED', hasUnpublishedChanges: false, isDirty: false }),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Selectors
//
// Use these rather than reading the store wholesale — each is scoped so that a
// component re-renders only when the data it actually displays changes.
// ─────────────────────────────────────────────────────────────────────────────

/** A single question. The card's only subscription. */
export function useQuestion(id: string): FormQuestion | undefined {
  return useBuilderStore((s) => s.byId[id]);
}

/** Ordered ids. Shallow-compared, so content edits do not re-render the canvas. */
export function useQuestionOrder(): string[] {
  return useBuilderStore(useShallow((s) => s.order));
}

export function useQuestionCount(): number {
  return useBuilderStore((s) => s.order.length);
}

/** Lightweight summaries for the outline panel — no option or validation data. */
export function useQuestionOutline() {
  return useBuilderStore(
    useShallow((s) =>
      s.order.map((id) => ({
        id,
        label: s.byId[id]?.label ?? '',
        type: s.byId[id]?.type,
        pageNumber: s.byId[id]?.pageNumber ?? 1,
        required: s.byId[id]?.validation?.required ?? false,
      })),
    ),
  );
}

/** Editor chrome state, as one shallow-compared object. */
export function useBuilderMeta() {
  return useBuilderStore(
    useShallow((s) => ({
      id: s.id,
      title: s.title,
      status: s.status,
      slug: s.slug,
      isDirty: s.isDirty,
      hasUnpublishedChanges: s.hasUnpublishedChanges,
      isLoading: s.isLoading,
      activeView: s.activeView,
      questionCount: s.order.length,
    })),
  );
}

/**
 * Assemble the full FormConfig. Call this at save/publish/preview boundaries —
 * never during a render of the canvas, since it allocates the whole document.
 */
export function selectFormConfig(state: BuilderState): FormConfig {
  return {
    id: state.id,
    title: state.title,
    description: state.description,
    isQuizMode: state.isQuizMode,
    theme: state.theme,
    pages: state.pages,
    questions: state.order.map((id) => state.byId[id]).filter(Boolean),
    logic: state.logic,
    status: state.status,
    slug: state.slug ?? undefined,
    createdAt: '',
    updatedAt: '',
  };
}

/** Snapshot outside React (event handlers, autosave timers). */
export function getFormConfig(): FormConfig {
  return selectFormConfig(useBuilderStore.getState());
}
