'use client';

import { useCallback } from 'react';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type {
  FormConfig,
  FormPage,
  FormQuestion,
  FormRule,
  FormSettings,
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
  /**
   * Rule set (calculations, visibility, requiredness, validation).
   *
   * Held as one array rather than normalised: rules are authored in a single
   * panel, there are at most 200 of them, and the compiler needs the whole set
   * anyway to detect cycles — so per-rule subscriptions would buy nothing.
   */
  rules: FormRule[];
  /**
   * Whether this form is bound to a subject type, and so whether cross-form
   * `ref` nodes are legal. Mirrors the compiler's `allowReferences` option, so
   * the panel can only offer what the publish step will accept.
   */
  allowReferences: boolean;
  /** Question order, by id. */
  order: string[];
  /** Questions keyed by id. Editing one entry touches nothing else. */
  byId: Record<string, FormQuestion>;
  /** Form-level settings (access, limits, notifications). */
  settings: FormSettings;
  /**
   * A password typed in the settings panel, waiting to be sent. Write-only —
   * the API never returns it — and cleared as soon as a save succeeds so it is
   * not retained for the rest of the session.
   */
  pendingPassword: string | null;

  // ── Editor session ────────────────────────────────────────────────────────
  selectedQuestionId: string | null;
  activeView: 'BUILDER' | 'LOGIC';
  status: 'DRAFT' | 'PUBLISHED' | 'CLOSED' | 'ARCHIVED';
  isDirty: boolean;
  hasUnpublishedChanges: boolean;
  isLoading: boolean;
  /**
   * Monotonic counter bumped on every content change; drives autosave.
   *
   * Never reset — not even by `load` or `reset`. Selectors memoise against it,
   * so a counter that can go backwards would hand back a snapshot of a
   * different document.
   */
  revision: number;
  /** The highest revision known to be persisted. `revision > savedRevision` ⇒ unsaved work. */
  savedRevision: number;
  /** `updatedAt` of the last server response, for optimistic-concurrency checks. */
  baseUpdatedAt: string | null;

  // ── Actions ───────────────────────────────────────────────────────────────
  load: (
    form: FormConfig,
    meta?: {
      status?: BuilderState['status'];
      hasUnpublishedChanges?: boolean;
      settings?: Partial<FormSettings>;
      updatedAt?: string | null;
      allowReferences?: boolean;
    },
  ) => void;
  reset: () => void;
  setLoading: (loading: boolean) => void;

  setTitle: (title: string) => void;
  setDescription: (description: string) => void;
  setQuizMode: (enabled: boolean) => void;
  setTheme: (theme: FormTheme | ((current: FormTheme) => FormTheme)) => void;
  patchSettings: (patch: Partial<FormSettings>) => void;
  setPendingPassword: (password: string | null) => void;

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

  /** Replace the whole rule set. The rules panel edits it as one value. */
  setRules: (rules: FormRule[]) => void;

  setLogic: (logic: LogicRule[]) => void;
  addLogicRule: (rule: LogicRule) => void;
  updateLogicRule: (id: string, patch: Partial<LogicRule>) => void;
  deleteLogicRule: (id: string) => void;

  selectQuestion: (id: string | null) => void;
  setActiveView: (view: 'BUILDER' | 'LOGIC') => void;
  /**
   * Record a successful save.
   *
   * Takes the revision that was *sent*, not the current one: a save takes
   * hundreds of milliseconds and the user keeps typing through it. Clearing
   * `isDirty` unconditionally on completion marks those in-flight keystrokes as
   * persisted and they are silently lost until the next unrelated edit.
   */
  markSaved: (savedRevision: number, meta?: { id?: string; slug?: string; updatedAt?: string | null }) => void;
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

export const DEFAULT_SETTINGS: FormSettings = {
  slug: '',
  layoutMode: 'DOCUMENT',
  requireAuth: false,
  allowMultiple: true,
  maxSubmissions: null,
  expiresAt: null,
  isPasswordProtected: false,
  notifyEmails: [],
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
    rules: [] as FormRule[],
    allowReferences: false,
    order: [] as string[],
    byId: {} as Record<string, FormQuestion>,
    settings: { ...DEFAULT_SETTINGS },
    pendingPassword: null,
    selectedQuestionId: null,
    activeView: 'BUILDER' as const,
    status: 'DRAFT' as const,
    isDirty: false,
    hasUnpublishedChanges: false,
    isLoading: true,
    baseUpdatedAt: null,
  };
}

export const useBuilderStore = create<BuilderState>()((set, get) => ({
  ...emptyState(),
  revision: 0,
  savedRevision: 0,

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

    // Logic rules that point at questions this form no longer contains can
    // never fire, but a HIDE rule with a dangling target still hid a live field
    // in the runner. Drop them at the door rather than round-tripping them.
    const logic = (Array.isArray(form.logic) ? form.logic : []).filter(
      (r): r is LogicRule =>
        !!r &&
        typeof r === 'object' &&
        !!r.id &&
        !!byId[r.triggerQuestionId] &&
        (r.action === 'JUMP_TO_PAGE' || !r.targetQuestionId || !!byId[r.targetQuestionId]),
    );

    // Rules are kept even when their target key no longer resolves. Unlike a
    // dangling logic rule — which silently hid a live field — an unresolvable
    // rule is caught by `compileRules` and shown to the author inline, so
    // dropping it here would delete work without telling anyone.
    const rules = (Array.isArray(form.rules) ? form.rules : []).filter(
      (r): r is FormRule => !!r && typeof r === 'object' && !Array.isArray(r) && !!r.id,
    );

    set((s) => ({
      id: form.id ?? '',
      title: form.title || 'Untitled form',
      description: form.description ?? '',
      isQuizMode: form.isQuizMode ?? false,
      theme:
        form.theme && Object.keys(form.theme).length
          ? { ...DEFAULT_THEME, ...form.theme }
          : { ...DEFAULT_THEME },
      pages: pages.length ? pages : [{ pageNumber: 1, title: 'Page 1', description: '' }],
      logic,
      rules,
      allowReferences: meta?.allowReferences ?? false,
      order,
      byId,
      settings: { ...DEFAULT_SETTINGS, slug: form.slug ?? '', ...(meta?.settings ?? {}) },
      pendingPassword: null,
      selectedQuestionId: order[0] ?? null,
      status: meta?.status ?? (form.status as BuilderState['status']) ?? 'DRAFT',
      hasUnpublishedChanges: meta?.hasUnpublishedChanges ?? false,
      isDirty: false,
      isLoading: false,
      baseUpdatedAt: meta?.updatedAt ?? form.updatedAt ?? null,
      // Monotonic. Selectors cache against this, so it must never repeat a
      // value it has already handed out for different content.
      revision: s.revision + 1,
      savedRevision: s.revision + 1,
    }));
  },

  reset: () =>
    set((s) => ({
      ...emptyState(),
      isLoading: false,
      revision: s.revision + 1,
      savedRevision: s.revision + 1,
    })),
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

  patchSettings: (patch) =>
    set((s) => ({ settings: { ...s.settings, ...patch }, isDirty: true, revision: s.revision + 1 })),

  setPendingPassword: (pendingPassword) =>
    set((s) => ({ pendingPassword, isDirty: true, revision: s.revision + 1 })),

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

  setRules: (rules) => set((s) => ({ rules, isDirty: true, revision: s.revision + 1 })),

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

  markSaved: (savedRevision, meta) =>
    set((s) => ({
      // A save that started at revision 7 says nothing about revision 8, which
      // the user produced while the request was in flight.
      savedRevision: Math.max(s.savedRevision, savedRevision),
      isDirty: s.revision > savedRevision,
      // Saving writes the draft columns but not a FormVersion, so a published
      // form now differs from what respondents see.
      hasUnpublishedChanges: s.status === 'PUBLISHED' ? true : s.hasUnpublishedChanges,
      ...(meta?.id && meta.id !== s.id ? { id: meta.id } : {}),
      // Only when it actually moved: the server echoes the slug on every save,
      // and rebuilding `settings` each time would churn its identity and
      // re-render every settings subscriber a couple of times a second.
      ...(meta?.slug && meta.slug !== s.settings.slug
        ? { settings: { ...s.settings, slug: meta.slug } }
        : {}),
      ...(meta?.updatedAt !== undefined ? { baseUpdatedAt: meta.updatedAt } : {}),
      // The password has reached the server; there is no reason to keep it.
      pendingPassword: null,
    })),

  markPublished: () =>
    set((s) => ({
      status: 'PUBLISHED',
      hasUnpublishedChanges: false,
      isDirty: s.revision > s.savedRevision,
    })),
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

export interface QuestionOutlineRow {
  id: string;
  label: string;
  type: QuestionType | undefined;
  pageNumber: number;
  required: boolean;
}

/**
 * Lightweight summaries for the outline panel — no option or validation data.
 *
 * ── Why this is memoised by hand ───────────────────────────────────────────
 * This selector previously read:
 *
 *     useBuilderStore(useShallow((s) => s.order.map((id) => ({ id, ... }))))
 *
 * which crashed the builder outright with "Maximum update depth exceeded"
 * whenever a form containing at least one question was opened.
 *
 * `useShallow` compares exactly one level deep. The value here is an array
 * whose *elements* are freshly allocated objects, so element-wise `Object.is`
 * is false on every single call and the comparison can never report equality.
 * zustand feeds the selector's result to `useSyncExternalStore`, which
 * re-renders whenever the snapshot's identity differs from the last one — so
 * the component rendered, produced a new array, was told the snapshot changed,
 * rendered again, forever, until React tripped its nested-update limit.
 *
 * An empty form was unaffected, because `[]` and `[]` *are* shallow-equal.
 * That is precisely why the crash only appeared when editing a saved form and
 * never when creating a new one.
 *
 * The cache below compares the derived rows field by field and returns the
 * previous array by identity when nothing a row displays has changed, which is
 * both a correct `getSnapshot` and cheaper than the broken version.
 */
let outlineCache: QuestionOutlineRow[] = [];

export function selectQuestionOutline(s: BuilderState): QuestionOutlineRow[] {
  const next: QuestionOutlineRow[] = s.order.map((id) => {
    const q = s.byId[id];
    return {
      id,
      label: q?.label ?? '',
      type: q?.type,
      pageNumber: q?.pageNumber ?? 1,
      required: q?.validation?.required ?? false,
    };
  });

  const unchanged =
    next.length === outlineCache.length &&
    next.every((row, i) => {
      const prev = outlineCache[i];
      return (
        prev.id === row.id &&
        prev.label === row.label &&
        prev.type === row.type &&
        prev.pageNumber === row.pageNumber &&
        prev.required === row.required
      );
    });

  if (unchanged) return outlineCache;
  outlineCache = next;
  return next;
}

export function useQuestionOutline(): QuestionOutlineRow[] {
  return useBuilderStore(selectQuestionOutline);
}

/** Editor chrome state, as one shallow-compared object. */
export function useBuilderMeta() {
  return useBuilderStore(
    useShallow((s) => ({
      id: s.id,
      title: s.title,
      status: s.status,
      slug: s.settings.slug,
      isDirty: s.isDirty,
      hasUnpublishedChanges: s.hasUnpublishedChanges,
      isLoading: s.isLoading,
      activeView: s.activeView,
      questionCount: s.order.length,
      logicRuleCount: s.logic.length,
      ruleCount: s.rules.length,
    })),
  );
}

/** Form-level settings. Shallow-compared — every field is a primitive bar one. */
export function useFormSettings(): FormSettings {
  return useBuilderStore((s) => s.settings);
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
    rules: state.rules,
    status: state.status,
    slug: state.settings.slug || undefined,
    layoutMode: state.settings.layoutMode,
    requireAuth: state.settings.requireAuth,
    isPasswordProtected: state.settings.isPasswordProtected,
    createdAt: '',
    updatedAt: state.baseUpdatedAt ?? '',
  };
}

/** Snapshot outside React (event handlers, autosave timers). */
export function getFormConfig(): FormConfig {
  return selectFormConfig(useBuilderStore.getState());
}

/**
 * The whole document, for the panels that render it (theme, logic, preview).
 *
 * Memoised on `revision`, which is why that counter is monotonic. The previous
 * approach — a `useMemo` on the page component keyed on
 * `[meta.isDirty, meta.activeView, isThemeOpen, isPreviewOpen, order.length]` —
 * looked plausible but latched: `isDirty` goes false → true on the *first* edit
 * and then stays true, so every subsequent theme tweak or logic-rule edit
 * recomputed nothing and the panel redrew stale data. Adding a logic rule
 * appeared to do nothing at all until an autosave happened to flip `isDirty`
 * back to false and unstick the memo.
 *
 * Subscribe to this from a small wrapper component, never from the page — it
 * allocates the entire document and would put the canvas back on the
 * re-render-per-keystroke path the store exists to avoid.
 */
let snapshotCache: { revision: number; value: FormConfig } | null = null;

export function selectFormSnapshot(s: BuilderState): FormConfig {
  if (snapshotCache && snapshotCache.revision === s.revision) return snapshotCache.value;
  const value = selectFormConfig(s);
  snapshotCache = { revision: s.revision, value };
  return value;
}

export function useFormSnapshot(): FormConfig {
  return useBuilderStore(selectFormSnapshot);
}

/**
 * Bridges panels that still take React's `(form, setForm)` shape onto the
 * store's granular actions.
 *
 * Comparison is by reference, which is exactly right for immutable updates: a
 * panel doing `setForm(prev => ({ ...prev, theme: { ...prev.theme, x } }))`
 * produces a new `theme` object and leaves every other key identical, so only
 * `setTheme` fires and only theme subscribers re-render.
 */
export function useFormConfigAdapter(): (
  action: FormConfig | ((current: FormConfig) => FormConfig),
) => void {
  return useCallback((action) => {
    const state = useBuilderStore.getState();
    const current = selectFormConfig(state);
    const next = typeof action === 'function' ? action(current) : action;

    if (next.theme !== current.theme) state.setTheme(next.theme);
    if (next.logic !== current.logic) state.setLogic(next.logic);
    if (next.rules !== current.rules) state.setRules(next.rules ?? []);
    if (next.title !== current.title) state.setTitle(next.title);
    if (next.description !== current.description) state.setDescription(next.description);
    if (next.isQuizMode !== current.isQuizMode) state.setQuizMode(!!next.isQuizMode);
  }, []);
}

/**
 * The request body for POST/PUT /organizations/:orgId/forms.
 *
 * Assembled in one place so the create path, the update path and autosave can
 * never disagree about what a form consists of. Before this existed the builder
 * sent only title/description/isQuizMode/theme/pages/questions/logic — every
 * access, limit and notification setting was silently dropped on every save.
 *
 * Keys must match CreateFormDto exactly: the API's global ValidationPipe runs
 * with `forbidNonWhitelisted`, so one stray property fails the whole request.
 */
export interface FormSavePayload {
  title: string;
  description: string;
  isQuizMode: boolean;
  themeConfig: FormTheme;
  pages: FormPage[];
  questions: FormQuestion[];
  logic: LogicRule[];
  /**
   * Always sent, even when empty. The API treats an absent key as "leave the
   * column alone", so omitting it would make deleting the last rule a no-op.
   */
  rules: FormRule[];
  slug?: string;
  layoutMode: string;
  requireAuth: boolean;
  allowMultiple: boolean;
  /** `null` clears the cap. Omitting the key would leave a stale one in place. */
  maxSubmissions: number | null;
  expiresAt: string | null;
  isPasswordProtected: boolean;
  password?: string;
  notifyEmails: string[];
  expectedUpdatedAt?: string;
}

export function selectSavePayload(state: BuilderState): FormSavePayload {
  const { settings } = state;

  return {
    title: state.title.trim() || 'Untitled form',
    description: state.description,
    isQuizMode: state.isQuizMode,
    themeConfig: state.theme,
    pages: state.pages,
    questions: state.order.map((id) => state.byId[id]).filter(Boolean),
    logic: state.logic,
    rules: state.rules,
    // An empty slug means "keep whatever the server generated"; sending `''`
    // would fail @MaxLength/@IsString or, worse, claim the empty slug.
    ...(settings.slug ? { slug: settings.slug } : {}),
    layoutMode: settings.layoutMode,
    requireAuth: settings.requireAuth,
    allowMultiple: settings.allowMultiple,
    // Sent explicitly as `null` rather than omitted, so that clearing a cap or
    // an expiry actually clears it server-side. An absent key means "leave
    // alone", which is not what an emptied input should mean.
    maxSubmissions: settings.maxSubmissions,
    expiresAt: settings.expiresAt,
    isPasswordProtected: settings.isPasswordProtected,
    ...(state.pendingPassword ? { password: state.pendingPassword } : {}),
    notifyEmails: settings.notifyEmails,
    ...(state.baseUpdatedAt ? { expectedUpdatedAt: state.baseUpdatedAt } : {}),
  };
}
