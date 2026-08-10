'use client';

import React, {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react';
import confetti from 'canvas-confetti';
import { AlertCircle, ArrowLeft, ArrowRight, Award, Check, CheckCircle2, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useFormRules } from '@/hooks/use-form-rules';
import { applyDefaultValues, checkAnswer, isBlank } from '@/lib/answer-checks';
import { cn, generateId } from '@/lib/utils';
import type { FormConfig, FormQuestion, FormSubmission } from '@/types/form';

import { FormRunnerField } from './FormRunnerField';
import { cardVariantClass } from './FormThemeScope';

export type RunnerLayoutMode = 'DOCUMENT' | 'CONVERSATIONAL' | 'GRID';

/** A field-level problem reported by the API's answer validator. */
export interface SubmitIssue {
  questionId: string;
  code?: string;
  message: string;
}

interface FormRunnerProps {
  form: FormConfig;
  onSubmitResponse?: (submission: FormSubmission) => Promise<void> | void;
  onBackToBuilder?: () => void;
  initialAnswers?: Record<string, unknown>;
  onProgressSave?: (answers: Record<string, unknown>) => void;
  layoutMode?: RunnerLayoutMode;
  /**
   * The form requires an access password. The runner collects it and hands it
   * back on submit — previously nothing anywhere in the runner asked for one,
   * so a password-protected form rejected every submission with a 403 the
   * respondent had no way to satisfy.
   */
  requiresPassword?: boolean;
  /**
   * Whether cross-form `ref` nodes are legal for this form. Only relevant to
   * the builder preview, which compiles authored rules live; the public form
   * receives an already-compiled plan.
   */
  allowReferences?: boolean;
  /**
   * Public slug. Present only on the real form — a list-backed question fetches
   * its options against it, and the builder preview has no published slug to
   * fetch with, so it says so rather than rendering an empty dropdown.
   */
  formSlug?: string;
  /** Rendered above the questions — cover image, logo, title. */
  header?: React.ReactNode;
  /**
   * Strip the runner down to its fields.
   *
   * Used when something else owns the surrounding experience — a form-app
   * session, where the app supplies the heading, the progress and the single
   * submit button for the whole report. Without this the respondent would face
   * a "Submit" under every school visit, each of which submits nothing.
   *
   * It also flattens the form's pages into one block. A multi-page form embedded
   * in a step is otherwise unfillable: the Next button is part of the chrome
   * that was just hidden, so pages two and three cannot be reached, and their
   * questions come back from the server as "required" with nothing on screen to
   * answer.
   */
  hideChrome?: boolean;
  /**
   * Field-level problems from outside — the app session's submit response.
   *
   * Keyed by question id, and merged into the same channel as this runner's own
   * checks, so a server rejection lands on the field that caused it rather than
   * as a sentence at the top of a report with twenty entries in it.
   */
  issues?: Record<string, string>;
  /**
   * Show every problem now, without waiting for a field to be touched.
   *
   * The embedded runner never sees a submit press of its own, so this is how a
   * failed report tells each entry to stop holding its errors back.
   */
  showAllProblems?: boolean;
  /**
   * Fires whenever the respondent's own answers change.
   *
   * The RAW answers, not the rule-evaluated ones: the server recomputes every
   * calculated field at submit anyway, and staging a derived value would freeze
   * it against inputs that may still change.
   */
  onAnswersChange?: (answers: Record<string, unknown>) => void;
}

/**
 * The form as a respondent fills it.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The rules engine now runs here ─────────────────────────────────────────
 * This component previously evaluated only the legacy `form.logic` array. The
 * compiled rule plan was shipped to the browser by the public form endpoint and
 * ignored, so a CALCULATE rule presented the respondent with an empty editable
 * box, a SHOW rule hid nothing, a REQUIRE rule was discovered only as a
 * rejection, and a VALIDATE message arrived as one anonymous string at the
 * bottom of the page. `useFormRules` closes that gap, and evaluates the legacy
 * system alongside it so both are honoured everywhere.
 *
 * The client's evaluation is a courtesy. The API re-runs the identical plan,
 * discards every client-supplied value for a calculated field, and its result
 * is what is stored.
 *
 * ── Errors ─────────────────────────────────────────────────────────────────
 * Problems are held back until a field has been touched or Submit has been
 * pressed, then rendered against the field, summarised at the top of the page,
 * and focused. Field-level issues returned by the API are merged into the same
 * channel rather than flattened into a single line.
 */
export function FormRunner({
  form,
  onSubmitResponse,
  onBackToBuilder,
  initialAnswers,
  onProgressSave,
  layoutMode = 'DOCUMENT',
  requiresPassword = false,
  allowReferences = false,
  formSlug,
  header,
  hideChrome = false,
  issues: externalIssues,
  showAllProblems = false,
  onAnswersChange,
}: FormRunnerProps) {
  const questions = useMemo(() => form.questions ?? [], [form.questions]);
  const pages = useMemo(() => form.pages ?? [], [form.pages]);

  const [answers, setAnswers] = useState<Record<string, unknown>>(() =>
    applyDefaultValues(questions, initialAnswers ?? {}),
  );
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const [serverIssues, setServerIssues] = useState<Record<string, string>>({});
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  const [currentPage, setCurrentPage] = useState<number>(1);
  const [conversationalId, setConversationalId] = useState<string | null>(null);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [quizScore, setQuizScore] = useState(0);
  const [totalMarks, setTotalMarks] = useState(0);
  const [startTime] = useState<number>(() => Date.now());

  const summaryRef = useRef<HTMLDivElement | null>(null);
  const cardClass = cardVariantClass(form.theme?.cardVariant);
  const isGrid = layoutMode === 'GRID';
  const isConversational = layoutMode === 'CONVERSATIONAL';

  // ── Rules ─────────────────────────────────────────────────────────────────
  const rules = useFormRules({
    questions,
    // Either the authored rule array (builder preview) or a compiled plan
    // (public form) — `useFormRules` discriminates on the shape.
    rules: form.rules,
    logic: form.logic,
    answers,
    allowReferences,
    // Lets `lookup()` resolve in the browser, so an auto-filled field (a UDISE
    // code from a school, a GSTIN from a vendor) appears the moment its source
    // question is answered rather than only after submit.
    formSlug,
  });

  /** Answers with calculated values written in — what is rendered and sent. */
  const effectiveAnswers = rules.answers;

  const isVisible = useCallback(
    (q: FormQuestion) => !rules.hiddenQuestionIds.has(q.id),
    [rules.hiddenQuestionIds],
  );

  /**
   * A calculated question is never required of the respondent.
   *
   * They cannot influence its value — the API strips whatever they send and
   * recomputes it — so requiring it turns a formula that happens to yield null
   * into a form that can never be submitted by anyone. The API applies the same
   * exemption.
   */
  const isRequired = useCallback(
    (q: FormQuestion) => {
      if (rules.calculatedQuestionIds.has(q.id)) return false;
      return !!q.validation?.required || rules.requiredQuestionIds.has(q.id);
    },
    [rules.calculatedQuestionIds, rules.requiredQuestionIds],
  );

  /** Answerable, visible questions in form order. */
  const activeQuestions = useMemo(
    () => questions.filter((q) => q.type !== 'SECTION_HEADER' && isVisible(q)),
    [questions, isVisible],
  );

  // ── Paging ────────────────────────────────────────────────────────────────
  //
  // Conversational mode tracks the current question BY ID, not by ordinal. The
  // visible list is recomputed from live answers, so any show/hide that fired
  // re-indexed it underneath a fixed counter — the respondent silently skipped
  // a question or saw one twice.
  //
  // Derived, not synchronised: an unset id (first render) or one that a rule
  // has just hidden resolves to the first question, so there is no effect and
  // no window in which the two disagree.
  const conversationalIndex = useMemo(() => {
    if (!isConversational) return 0;
    const index = activeQuestions.findIndex((q) => q.id === conversationalId);
    return index >= 0 ? index : 0;
  }, [isConversational, activeQuestions, conversationalId]);

  /**
   * Embedded in something that owns the navigation — a form-app step.
   *
   * Pages collapse into one block here. They are a pacing device for a form
   * filled on its own page, and the app already provides that pacing with its
   * steps; keeping them would hide every page after the first behind a Next
   * button that `hideChrome` has removed.
   */
  const isEmbedded = hideChrome && !isConversational;

  const totalPages = isConversational
    ? Math.max(activeQuestions.length, 1)
    : isEmbedded
      ? 1
      : Math.max(pages.length || 1, 1);
  const stepNumber = isConversational ? conversationalIndex + 1 : isEmbedded ? 1 : currentPage;
  const isLastStep = stepNumber >= totalPages;

  const questionsOnStep = useMemo(() => {
    if (isConversational) {
      const q = activeQuestions[conversationalIndex];
      return q ? [q] : [];
    }
    if (isEmbedded) return questions.filter((q) => isVisible(q));
    return questions.filter((q) => (q.pageNumber || 1) === currentPage && isVisible(q));
  }, [
    isConversational,
    isEmbedded,
    activeQuestions,
    conversationalIndex,
    questions,
    currentPage,
    isVisible,
  ]);

  /**
   * Page titles, re-used as group headings in the flattened layout.
   *
   * Keyed by the id of the first question on each page. A twenty-question
   * monitoring form printed as one undifferentiated list loses the "Monitoring
   * checklist" / "APAAR and SDP" structure its author put there.
   */
  const pageHeadingBefore = useMemo(() => {
    const map = new Map<string, { title?: string; description?: string }>();
    if (!isEmbedded || pages.length < 2) return map;

    const seen = new Set<number>();
    for (const q of questionsOnStep) {
      const pageNumber = q.pageNumber || 1;
      if (seen.has(pageNumber)) continue;
      seen.add(pageNumber);
      const page = pages.find((p) => p.pageNumber === pageNumber);
      if (page && (page.title || page.description)) {
        map.set(q.id, { title: page.title, description: page.description });
      }
    }
    return map;
  }, [isEmbedded, pages, questionsOnStep]);

  // ── Answer reporting ──────────────────────────────────────────────────────
  //
  // `answers` is the ONLY dependency, and that is load-bearing. The natural way
  // to pass this prop is an inline arrow — `onAnswersChange={(a) => save(k, a)}`
  // — which has a new identity on every render. With the callback in the
  // dependency array the effect re-fires on every render, reports the same
  // answers, updates state in the parent, and re-renders: "Maximum update depth
  // exceeded", from a caller that did nothing wrong. An Effect Event reads the
  // latest prop without being a dependency, which is exactly this situation.
  const reportAnswers = useEffectEvent((next: Record<string, unknown>) => {
    onAnswersChange?.(next);
  });

  // Skips the first render: an app session already holds these answers (it
  // seeded them), and echoing them straight back would mark a freshly-resumed
  // report dirty and re-stage every entry on load.
  const hasReportedAnswers = useRef(false);
  useEffect(() => {
    if (!hasReportedAnswers.current) {
      hasReportedAnswers.current = true;
      return;
    }
    reportAnswers(answers);
  }, [answers]);

  // ── Draft autosave ────────────────────────────────────────────────────────
  // Same reasoning as the reporting effect above, with a quieter failure: an
  // inline `onProgressSave` re-armed the 2s timer on every render, so a parent
  // that re-rendered at all often meant the draft was never written.
  const saveProgress = useEffectEvent((next: Record<string, unknown>) => {
    // The respondent's own input only. Calculated values are derived, and
    // persisting them would resurrect a stale value on the next visit.
    onProgressSave?.(next);
  });

  // Whether autosave is wanted at all, as a boolean: the callback's identity
  // must not re-arm the timer, but its presence or absence has to.
  const wantsProgressSave = !!onProgressSave;

  useEffect(() => {
    if (!wantsProgressSave) return;
    const timer = setTimeout(() => saveProgress(answers), 2000);
    return () => clearTimeout(timer);
  }, [answers, wantsProgressSave]);

  // ── Validation ────────────────────────────────────────────────────────────
  /** Every problem on the form right now, keyed by question id. */
  const problems = useMemo(() => {
    const map = new Map<string, string>();
    for (const q of activeQuestions) {
      const issue = checkAnswer(q, effectiveAnswers[q.id], isRequired(q));
      if (issue) map.set(q.id, issue);
    }
    // A field-level issue from the API outranks the local check: the server saw
    // the whole picture, including anything this side cannot evaluate. Issues
    // handed in from an owning surface — an app session's submit — are the same
    // kind of thing and are merged into the same channel.
    for (const [questionId, message] of Object.entries(externalIssues ?? {})) {
      map.set(questionId, message);
    }
    for (const [questionId, message] of Object.entries(serverIssues)) {
      map.set(questionId, message);
    }
    return map;
  }, [activeQuestions, effectiveAnswers, isRequired, serverIssues, externalIssues]);

  const showProblemsFor = useCallback(
    (questionId: string) => showAllProblems || hasAttemptedSubmit || touched.has(questionId),
    [showAllProblems, hasAttemptedSubmit, touched],
  );

  /** Problems the respondent should be told about now, in form order. */
  const visibleProblems = useMemo(() => {
    const list: Array<{ questionId: string; label: string; message: string }> = [];
    for (const q of activeQuestions) {
      if (!showProblemsFor(q.id)) continue;
      const message = problems.get(q.id) ?? rules.violationsByQuestionId.get(q.id)?.[0];
      if (message) list.push({ questionId: q.id, label: q.label, message });
    }
    return list;
  }, [activeQuestions, problems, rules.violationsByQuestionId, showProblemsFor]);

  const focusQuestion = useCallback((questionId: string) => {
    const container = document.querySelector<HTMLElement>(`[data-question-id="${questionId}"]`);
    container?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const focusable = container?.querySelector<HTMLElement>(
      'input:not([type="hidden"]), select, textarea, button[role="radio"], [role="radiogroup"] button',
    );
    focusable?.focus({ preventScroll: true });
  }, []);

  const pageOf = useCallback(
    (questionId: string) => {
      const q = questions.find((item) => item.id === questionId);
      return q?.pageNumber || 1;
    },
    [questions],
  );

  /**
   * Every blocking problem across the WHOLE form, not just this page.
   *
   * Only the current page was ever checked, so a question on page 1 that a
   * later answer made required or revealed was never re-examined — it surfaced
   * as an opaque rejection on the final page with no way back to it.
   */
  const blockingProblems = useCallback(() => {
    const list: Array<{ questionId: string; message: string }> = [];
    for (const q of activeQuestions) {
      const message = problems.get(q.id) ?? rules.violationsByQuestionId.get(q.id)?.[0];
      if (message) list.push({ questionId: q.id, message });
    }
    return list;
  }, [activeQuestions, problems, rules.violationsByQuestionId]);

  /** Problems on the current step only — what gates "Next". */
  const stepProblems = useCallback(() => {
    const ids = new Set(questionsOnStep.map((q) => q.id));
    return blockingProblems().filter((problem) => ids.has(problem.questionId));
  }, [questionsOnStep, blockingProblems]);

  // ── Cascading choice lists ────────────────────────────────────────────────
  //
  // Bindings are authored by KEY (a rename-safe handle), but the runner holds
  // answers by ID. These two maps bridge that once, rather than scanning the
  // question list on every render of every dropdown.
  const cascade = useMemo(() => {
    const byKey = new Map<string, FormQuestion>();
    for (const q of questions) {
      if (q.key) byKey.set(q.key, q);
    }

    /** child question id → the question it is filtered by. */
    const parentOf = new Map<string, FormQuestion>();
    /** parent question id → the children that depend on it. */
    const childrenOf = new Map<string, string[]>();

    for (const q of questions) {
      const parentKey = q.optionsSource?.parentQuestionKey;
      if (!parentKey) continue;
      const parent = byKey.get(parentKey);
      if (!parent) continue;
      parentOf.set(q.id, parent);
      childrenOf.set(parent.id, [...(childrenOf.get(parent.id) ?? []), q.id]);
    }

    return { parentOf, childrenOf };
  }, [questions]);

  const markTouched = (questionId: string) =>
    setTouched((prev) => (prev.has(questionId) ? prev : new Set(prev).add(questionId)));

  const setAnswer = (questionId: string, value: unknown) => {
    setAnswers((prev) => {
      const next = { ...prev, [questionId]: value };

      // Changing a parent invalidates every answer beneath it. Leaving a block
      // selected under a newly-chosen district is the classic cascade bug: the
      // control looks answered, the option is no longer on offer, and the
      // server now rejects the pair outright as inconsistent. Cleared
      // transitively, so District → Block → School all reset together.
      if (prev[questionId] !== value) {
        const queue = [questionId];
        while (queue.length > 0) {
          const current = queue.shift()!;
          for (const childId of cascade.childrenOf.get(current) ?? []) {
            if (next[childId] === undefined || next[childId] === '') continue;
            next[childId] = Array.isArray(next[childId]) ? [] : '';
            queue.push(childId);
          }
        }
      }

      return next;
    });
    // Engaging with a field is what earns it the right to complain. Editing it
    // and clearing it therefore still shows "required" — merely passing through
    // it does not.
    markTouched(questionId);
    // A field the respondent has just corrected must stop showing the API's
    // stale complaint about it. This was done for text inputs and not for
    // multi-choice, so a checkbox error survived being fixed.
    setServerIssues((prev) => {
      if (!(questionId in prev)) return prev;
      const next = { ...prev };
      delete next[questionId];
      return next;
    });
    setSubmitError('');
  };

  /**
   * Blur alone does not mark a field touched unless something was entered.
   *
   * Otherwise tabbing down a long form paints every required question red
   * before the respondent has had a chance to answer any of them.
   */
  const handleBlur = (questionId: string) => {
    if (!isBlank(effectiveAnswers[questionId])) markTouched(questionId);
  };

  // ── Navigation ────────────────────────────────────────────────────────────
  const goToStep = (direction: 1 | -1) => {
    if (isConversational) {
      const next = conversationalIndex + direction;
      const target = activeQuestions[next];
      if (target) setConversationalId(target.id);
      return;
    }
    setCurrentPage((page) => Math.min(Math.max(page + direction, 1), totalPages));
  };

  const revealProblems = (found: Array<{ questionId: string }>) => {
    setHasAttemptedSubmit(true);
    const first = found[0];
    if (!first) return;
    if (!isConversational) setCurrentPage(pageOf(first.questionId));
    else setConversationalId(first.questionId);
    // After the step switch has rendered.
    requestAnimationFrame(() => {
      summaryRef.current?.focus();
      focusQuestion(first.questionId);
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isLastStep) {
      const found = stepProblems();
      if (found.length > 0) {
        revealProblems(found);
        return;
      }
      goToStep(1);
      return;
    }

    const found = blockingProblems();
    if (found.length > 0) {
      revealProblems(found);
      return;
    }

    if (requiresPassword && !formPassword.trim()) {
      setHasAttemptedSubmit(true);
      setPasswordError('Enter the access password for this form.');
      document.getElementById('form-access-password')?.focus();
      return;
    }

    // ── Quiz grading (indicative only; the worker grades authoritatively) ──
    let score = 0;
    let maxScore = 0;

    for (const q of questions) {
      if (q.type === 'SECTION_HEADER') continue;
      const points = q.points || 0;
      maxScore += points;
      if (points <= 0) continue;

      const answer = effectiveAnswers[q.id];
      if (q.type === 'SINGLE_CHOICE' || q.type === 'DROPDOWN') {
        const correct = q.options?.find((o) => o.isCorrect);
        if (correct && answer === correct.label) score += points;
      } else if (q.type === 'MULTI_CHOICE') {
        const correct = q.options?.filter((o) => o.isCorrect).map((o) => o.label) ?? [];
        const given = Array.isArray(answer) ? (answer as string[]) : [];
        if (
          correct.length > 0 &&
          correct.every((item) => given.includes(item)) &&
          given.every((item) => correct.includes(item))
        ) {
          score += points;
        }
      }
    }

    setQuizScore(score);
    setTotalMarks(maxScore);

    // Hidden questions carry no answer. The API drops them anyway; sending them
    // would leak a value the respondent could not see they were submitting.
    const payload: Record<string, unknown> = {};
    for (const [questionId, value] of Object.entries(effectiveAnswers)) {
      if (rules.hiddenQuestionIds.has(questionId)) continue;
      if (isBlank(value)) continue;
      payload[questionId] = value;
    }

    const submission: FormSubmission = {
      id: generateId('sub'),
      formId: form.id,
      submittedAt: new Date().toISOString(),
      completionTimeMs: Date.now() - startTime,
      answers: payload,
      quizScore: maxScore > 0 ? score : undefined,
      maxQuizScore: maxScore > 0 ? maxScore : undefined,
    };

    // Carried out-of-band rather than as an answer: it is a gate on the form,
    // not a response to it, and must never be stored with the answers.
    if (requiresPassword) {
      (submission as FormSubmission & { formPassword?: string }).formPassword = formPassword;
    }

    setIsSubmitting(true);
    setSubmitError('');

    try {
      await onSubmitResponse?.(submission);
      setIsSubmitted(true);
      try {
        // Respect a stated preference for reduced motion.
        const reduced =
          typeof window !== 'undefined' &&
          window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        if (!reduced) confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
      } catch {
        /* confetti is decorative; never let it break a successful submit */
      }
    } catch (err: unknown) {
      // The API returns field-level issues. They used to be attached to the
      // error and then dropped, collapsing every one of them — including an
      // author's own VALIDATE message — into a single anonymous red line.
      const failure = err as { issues?: SubmitIssue[]; message?: string } | null;
      const issues = failure?.issues;
      if (Array.isArray(issues) && issues.length > 0) {
        const mapped: Record<string, string> = {};
        const formLevel: string[] = [];
        for (const issue of issues) {
          if (!issue?.message) continue;
          if (issue.questionId && issue.questionId !== '_form') {
            mapped[issue.questionId] = issue.message;
          } else {
            formLevel.push(issue.message);
          }
        }
        setServerIssues(mapped);
        setHasAttemptedSubmit(true);
        setSubmitError(formLevel.join(' ') || '');

        const firstId = Object.keys(mapped)[0];
        if (firstId) {
          if (!isConversational) setCurrentPage(pageOf(firstId));
          else setConversationalId(firstId);
          requestAnimationFrame(() => {
            summaryRef.current?.focus();
            focusQuestion(firstId);
          });
        }
      } else {
        setSubmitError(failure?.message || 'Failed to submit form. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Done ──────────────────────────────────────────────────────────────────
  if (isSubmitted) {
    return (
      <div className="mx-auto max-w-md space-y-6 p-8 text-center" role="status">
        <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary shadow-sm">
          <CheckCircle2 size={36} aria-hidden />
        </div>

        <div className="space-y-2">
          <h2 className="text-xl font-bold text-foreground">{form.title}</h2>
          <p className="text-sm text-muted-foreground">Your response has been recorded successfully.</p>
        </div>

        {totalMarks > 0 && (
          <Card className="space-y-2 border-primary/20 bg-primary/5 p-5">
            <div className="flex items-center justify-center gap-2 text-sm font-semibold text-primary">
              <Award size={18} aria-hidden />
              <span>Quiz result</span>
            </div>
            <div className="text-3xl font-black text-primary">
              {quizScore} / {totalMarks} <span className="text-sm font-semibold opacity-80">points</span>
            </div>
          </Card>
        )}

        <Button
          onClick={() => {
            setIsSubmitted(false);
            setAnswers(applyDefaultValues(questions, {}));
            setTouched(new Set());
            setServerIssues({});
            setHasAttemptedSubmit(false);
            setCurrentPage(1);
            setConversationalId(activeQuestions[0]?.id ?? null);
            onBackToBuilder?.();
          }}
          className="mt-4 w-full gap-2"
        >
          <Check size={16} aria-hidden /> Done
        </Button>
      </div>
    );
  }

  const currentPageMeta = isConversational ? null : pages.find((p) => p.pageNumber === currentPage);

  return (
    <div className="space-y-6">
      {/* Sticky, because on a long step the only thing worse than not knowing
          how far through you are is having to scroll back up to find out. */}
      {!hideChrome && totalPages > 1 && (
        <div className="sticky top-0 z-30 -mx-4 space-y-2 bg-[var(--color-background)]/85 px-4 py-3 backdrop-blur-sm sm:-mx-6 sm:px-6">
          <div className="flex items-center justify-between gap-3 text-xs font-medium text-muted-foreground">
            <span>
              {isConversational ? 'Question' : 'Step'} {stepNumber} of {totalPages}
              {currentPageMeta?.title ? ` · ${currentPageMeta.title}` : ''}
            </span>
            <span className="tabular shrink-0">
              {Math.round((stepNumber / totalPages) * 100)}%
            </span>
          </div>
          <div
            role="progressbar"
            aria-valuenow={stepNumber}
            aria-valuemin={1}
            aria-valuemax={totalPages}
            aria-label="Form progress"
            className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
              style={{ width: `${(stepNumber / totalPages) * 100}%` }}
            />
          </div>
        </div>
      )}

      {!hideChrome && (!isConversational || stepNumber === 1) &&
        (header ?? (
          <Card className={cn('space-y-2 bg-card p-6', cardClass)}>
            <h1 className="text-2xl font-bold text-foreground">{form.title}</h1>
            {form.description && <p className="text-sm text-muted-foreground">{form.description}</p>}
          </Card>
        ))}

      {/* ── Error summary ──────────────────────────────────────────────────
          A long form gave the respondent a red border somewhere below the fold
          and nothing else. This lists every problem and jumps to it. */}
      {!hideChrome && visibleProblems.length > 0 && (
        <div
          ref={summaryRef}
          tabIndex={-1}
          role="alert"
          className="space-y-2 rounded-[var(--radius)] border border-destructive/40 bg-destructive/10 p-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
        >
          <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
            <AlertCircle className="size-4 shrink-0" aria-hidden />
            {visibleProblems.length === 1
              ? 'There is a problem with your answers'
              : `There are ${visibleProblems.length} problems with your answers`}
          </p>
          <ul className="space-y-1 pl-6">
            {visibleProblems.map((problem) => (
              <li key={problem.questionId}>
                <button
                  type="button"
                  onClick={() => {
                    if (!isConversational) setCurrentPage(pageOf(problem.questionId));
                    else setConversationalId(problem.questionId);
                    requestAnimationFrame(() => focusQuestion(problem.questionId));
                  }}
                  className="text-left text-xs text-destructive underline underline-offset-2 hover:no-underline"
                >
                  {problem.label || 'Question'}: {problem.message}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-6">
        {currentPageMeta && (currentPageMeta.title || currentPageMeta.description) && (
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-foreground">{currentPageMeta.title}</h2>
            {currentPageMeta.description && (
              <p className="text-sm text-muted-foreground">{currentPageMeta.description}</p>
            )}
          </div>
        )}

        {/* GRID lays two questions per row on wide screens, honouring each
            question's own `colSpan`. */}
        <div className={cn(isGrid ? 'grid grid-cols-1 gap-4 md:grid-cols-2' : 'space-y-4')}>
          {questionsOnStep.map((q, position) => {
            // Numbered among the ANSWERABLE questions only — a section header
            // is not question 3, and counting it as one makes every subsequent
            // number disagree with what the respondent sees.
            const questionNumber =
              questionsOnStep.slice(0, position).filter((item) => item.type !== 'SECTION_HEADER')
                .length + 1;

            if (q.type === 'SECTION_HEADER') {
              return (
                <div
                  key={q.id}
                  className={cn('space-y-1 pb-1 pt-6 first:pt-0', isGrid && 'md:col-span-2')}
                >
                  <h3 className="text-base font-semibold tracking-tight text-foreground">
                    {q.label}
                  </h3>
                  {q.description && (
                    <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
                      {q.description}
                    </p>
                  )}
                  <div className="!mt-3 h-px w-full bg-border" />
                </div>
              );
            }

            const parent = cascade.parentOf.get(q.id);
            const parentAnswer = parent ? effectiveAnswers[parent.id] : undefined;
            const heading = pageHeadingBefore.get(q.id);

            const field = (
              <FormRunnerField
                key={q.id}
                question={q}
                index={questionNumber}
                formId={form.id}
                formSlug={formSlug}
                parentValue={typeof parentAnswer === 'string' ? parentAnswer : undefined}
                parentLabel={parent?.label}
                value={effectiveAnswers[q.id]}
                onChange={(value) => setAnswer(q.id, value)}
                onBlur={() => handleBlur(q.id)}
                required={isRequired(q)}
                calculated={rules.calculatedQuestionIds.has(q.id)}
                error={problems.get(q.id)}
                violations={rules.violationsByQuestionId.get(q.id)}
                showProblems={showProblemsFor(q.id)}
                className={cn(isGrid && (q.colSpan ?? 2) === 2 && 'md:col-span-2')}
              />
            );

            if (!heading) return field;

            return (
              <React.Fragment key={q.id}>
                <div className={cn('space-y-1 pt-4 first:pt-0', isGrid && 'md:col-span-2')}>
                  {heading.title && (
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      {heading.title}
                    </h3>
                  )}
                  {heading.description && (
                    <p className="text-[0.8125rem] leading-relaxed text-muted-foreground">
                      {heading.description}
                    </p>
                  )}
                </div>
                {field}
              </React.Fragment>
            );
          })}
        </div>

        {/* Access password — asked for on the final step only, since that is
            when it is checked. */}
        {requiresPassword && isLastStep && (
          <Card className={cn('space-y-3 bg-card p-6', cardClass)}>
            <Label htmlFor="form-access-password" className="text-base font-semibold text-foreground">
              Access password
              <span className="ml-1 text-destructive" aria-hidden>
                *
              </span>
              <span className="sr-only"> (required)</span>
            </Label>
            <p id="form-access-password-hint" className="text-sm text-muted-foreground">
              This form is password protected. Enter the password you were given to submit your
              response.
            </p>
            <Input
              id="form-access-password"
              type="password"
              autoComplete="off"
              value={formPassword}
              onChange={(e) => {
                setFormPassword(e.target.value);
                setPasswordError('');
              }}
              placeholder="Enter password"
              aria-invalid={!!passwordError || undefined}
              aria-describedby={
                passwordError
                  ? 'form-access-password-hint form-access-password-error'
                  : 'form-access-password-hint'
              }
              className="max-w-sm bg-background"
            />
            {passwordError && (
              <p
                id="form-access-password-error"
                role="alert"
                className="flex items-center gap-2 text-sm font-semibold text-destructive"
              >
                <AlertCircle size={14} aria-hidden />
                <span>{passwordError}</span>
              </p>
            )}
          </Card>
        )}

        {!hideChrome && (
        <div className="space-y-3 border-t border-border pt-5">
          {submitError && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-[var(--radius)] border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{submitError}</span>
            </p>
          )}

          {/* Reversed on mobile so the primary action is the lower, thumb-side
              button rather than stranded above "Back". */}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            {stepNumber > 1 ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => goToStep(-1)}
                className="gap-2"
                disabled={isSubmitting}
              >
                <ArrowLeft size={16} aria-hidden /> Back
              </Button>
            ) : (
              <span className="hidden sm:block" />
            )}

            <Button
              type="submit"
              size="lg"
              className="w-full gap-2 font-semibold sm:w-auto sm:px-8"
              disabled={isSubmitting}
            >
              {!isLastStep ? (
                <>
                  Continue <ArrowRight size={16} aria-hidden />
                </>
              ) : isSubmitting ? (
                <>
                  <Loader2 size={16} className="animate-spin" aria-hidden /> Submitting…
                </>
              ) : (
                <>
                  Submit <Check size={16} aria-hidden />
                </>
              )}
            </Button>
          </div>

          {isLastStep && !isSubmitting && (
            <p className="text-center text-xs text-muted-foreground sm:text-right">
              Fields marked <span className="font-semibold text-destructive">*</span> are required.
            </p>
          )}
        </div>
        )}
      </form>
    </div>
  );
}
