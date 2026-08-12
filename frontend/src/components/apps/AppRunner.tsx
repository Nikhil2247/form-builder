'use client';

import React from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FormRunner } from '@/components/builder/FormRunner';
import {
  useAppSession,
  type AppSessionStep,
  type SessionIssue,
} from '@/hooks/use-app-session';
import { cn } from '@/lib/utils';
import type { FormConfig } from '@/types/form';
import {
  APP_APPEARANCE_DEFAULTS,
  DENSITY,
  type AppAppearance,
  type DensityTokens,
} from './appearance';

/**
 * A form app, as a respondent fills it.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Each step is a section; each entry within a step mounts the ordinary
 * `FormRunner` against that step's published form. Reusing the runner rather
 * than writing a second one is the whole point — every question type, the rules
 * engine, the cascading selects and all of the accessibility work apply here
 * without a line of new code, and they cannot drift from the single-form
 * experience because they are the same component.
 *
 * ── One submit, many submissions ───────────────────────────────────────────
 * Nothing is submitted as it is filled. Answers are staged server-side and
 * committed together, so a report is never half-filed: the respondent who has
 * just entered twenty school visits cannot end up with eleven of them stored
 * and no way to tell which.
 */

export interface AppSummary {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  requireAuth: boolean;
  period: { id: string; label: string; startsAt: string; endsAt: string } | null;
  isOutsidePeriod: boolean;
  branding: { headerTitle?: string; footerText?: string; logoUrl?: string; coverImageUrl?: string };
  organization: { name: string; logoUrl: string | null };
  /** `{ layoutMode }` and the dashboard cards. Absent on older API builds. */
  config?: { layoutMode?: AppLayoutMode };
}

/**
 * How the app lays out the fields of each step.
 *
 * Only two, unlike a form's three: CONVERSATIONAL shows one question at a time
 * and an app already paces the respondent with its own steps, so the two would
 * be competing for the same job.
 */
export type AppLayoutMode = 'DOCUMENT' | 'GRID';

export function AppRunner({
  publicSlug,
  app,
  appearance = APP_APPEARANCE_DEFAULTS,
}: {
  publicSlug: string;
  app: AppSummary;
  /** Defaulted so the builder preview can mount this without styling decisions. */
  appearance?: AppAppearance;
}) {
  // Anything unrecognised falls back to the stacked layout rather than
  // rendering nothing, matching how the public form page treats PORTAL.
  const layoutMode: AppLayoutMode = app.config?.layoutMode === 'GRID' ? 'GRID' : 'DOCUMENT';
  const density = DENSITY[appearance.density];
  const session = useAppSession(publicSlug);
  const [issues, setIssues] = React.useState<SessionIssue[]>([]);
  const [submitError, setSubmitError] = React.useState('');
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [done, setDone] = React.useState<{ submissionCount: number } | null>(null);
  const [collapsed, setCollapsed] = React.useState<Set<string>>(() => new Set());
  // Step-level folding, separate from the per-entry folding above it. Only the
  // `accordion` style uses it, and a step is closed only once the respondent
  // closes it — defaulting every step shut would hide the whole report behind
  // four clicks and make a short app look empty.
  const [foldedSteps, setFoldedSteps] = React.useState<Set<string>>(() => new Set());
  const summaryRef = React.useRef<HTMLDivElement | null>(null);
  const topRef = React.useRef<HTMLDivElement | null>(null);

  const isWizard = appearance.shell === 'wizard';
  const [activeIndex, setActiveIndex] = React.useState(0);

  // Read before the early returns so `handleSubmit` can route a rejection to
  // the step that caused it. A step can disappear mid-session when a `showWhen`
  // stops matching, so the index is clamped on every render rather than
  // corrected in an effect — there is no moment where it points past the end.
  const steps = session.session?.steps ?? [];
  const stepIndex = Math.min(activeIndex, Math.max(0, steps.length - 1));

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const toggleStep = (key: string) =>
    setFoldedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setSubmitError('');
    setIssues([]);
    try {
      const result = await session.submit();
      setDone({ submissionCount: result.submissionCount });
    } catch (error: unknown) {
      const failure = error as { issues?: SessionIssue[]; message?: string };
      if (Array.isArray(failure.issues) && failure.issues.length > 0) {
        setIssues(failure.issues);
        // An entry the respondent had collapsed is reopened. Marking a folded
        // card red and leaving it folded tells someone with twenty school
        // visits that something is wrong and nothing about where.
        setCollapsed((prev) => {
          const next = new Set(prev);
          for (const issue of failure.issues!) next.delete(`${issue.stepKey}#${issue.index}`);
          return next;
        });
        // Same reasoning one level up: under the `accordion` style the whole
        // step can be folded away, and a rejected report whose problems are
        // inside a folded step reads as an error about nothing.
        setFoldedSteps((prev) => {
          const next = new Set(prev);
          for (const issue of failure.issues!) next.delete(issue.stepKey);
          return next;
        });
        // In a wizard the offending step is usually not the one on screen —
        // submit lives on the LAST page and the problem is often on the first.
        // Listing errors without moving there would be a report that cannot be
        // submitted and no visible reason why.
        if (isWizard) {
          const firstBad = steps.findIndex((step) =>
            failure.issues!.some((issue) => issue.stepKey === step.key),
          );
          if (firstBad >= 0) setActiveIndex(firstBad);
        }
        requestAnimationFrame(() => summaryRef.current?.focus());
      } else {
        setSubmitError(failure.message || 'Could not submit this report.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Terminal and loading states ──────────────────────────────────────────
  if (done) {
    return (
      <Card className="mx-auto max-w-md space-y-5 p-8 text-center" role="status">
        <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary">
          <CheckCircle2 size={36} aria-hidden />
        </div>
        <div className="space-y-2">
          <h2 className="text-xl font-bold text-foreground">Report submitted</h2>
          <p className="text-sm text-muted-foreground">
            {done.submissionCount} {done.submissionCount === 1 ? 'entry was' : 'entries were'}{' '}
            recorded{app.period ? ` for ${app.period.label}` : ''}.
          </p>
        </div>
        <Button onClick={() => window.location.reload()} className="w-full">
          Start another report
        </Button>
      </Card>
    );
  }

  if (!session.isReady) {
    return (
      <div role="status" className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Loading…
      </div>
    );
  }

  if (session.loadError) {
    return (
      <Card className="space-y-2 p-8 text-center">
        <AlertCircle className="mx-auto size-8 text-destructive" aria-hidden />
        <p className="text-sm font-semibold text-foreground">This app is not available</p>
        <p className="text-sm text-muted-foreground">{session.loadError}</p>
      </Card>
    );
  }

  const issuesByStep = new Map<string, SessionIssue[]>();
  for (const issue of issues) {
    const key = `${issue.stepKey}#${issue.index}`;
    issuesByStep.set(key, [...(issuesByStep.get(key) ?? []), issue]);
  }

  /** Which steps still hold a rejected answer, for the progress markers. */
  const stepsWithIssues = new Set(issues.map((issue) => issue.stepKey));

  const isLastStep = stepIndex >= steps.length - 1;

  const goTo = (index: number) => {
    setActiveIndex(Math.min(Math.max(index, 0), Math.max(0, steps.length - 1)));
    // The next step starts at the top of its own content. Without this a
    // respondent who scrolled to the bottom to press Next lands halfway down
    // the following step, having apparently skipped its first questions.
    requestAnimationFrame(() =>
      topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    );
  };

  return (
    <div className={density.stack}>
      <div ref={topRef} aria-hidden className="scroll-mt-4" />

      {isWizard && steps.length > 0 && (
        <WizardProgress
          steps={steps}
          activeIndex={stepIndex}
          stepsWithIssues={stepsWithIssues}
          onGoTo={goTo}
        />
      )}

      {issues.length > 0 && (
        <div
          ref={summaryRef}
          tabIndex={-1}
          role="alert"
          className="space-y-2 rounded-[var(--radius)] border border-destructive/40 bg-destructive/10 p-4 focus:outline-none"
        >
          <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
            <AlertCircle className="size-4 shrink-0" aria-hidden />
            This report cannot be submitted yet
          </p>
          <ul className="space-y-1 pl-6">
            {issues.map((issue, index) => {
              const at = steps.findIndex((s) => s.key === issue.stepKey);
              const step = at >= 0 ? steps[at] : undefined;
              const label = `${step?.title ?? issue.stepKey}${
                step?.mode === 'REPEATABLE' ? ` #${issue.index + 1}` : ''
              }: ${issue.message}`;

              // In a wizard the step is on another page, so the summary is the
              // only route to it and each line has to be that route. In the
              // stacked layout everything is already on screen and a button
              // that scrolls a little would be noise.
              return (
                <li key={index} className="text-xs text-destructive">
                  {isWizard && at >= 0 ? (
                    <button
                      type="button"
                      onClick={() => goTo(at)}
                      className="text-left underline underline-offset-2 hover:no-underline"
                    >
                      {label}
                    </button>
                  ) : (
                    label
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Every step stays MOUNTED and inactive ones are hidden with CSS.
          Rendering only the active step would unmount the others, and each
          `FormRunner` holds its own answer state — so paging away from a step
          and back would hand the respondent an empty form and lose whatever
          they had typed since the last save. `display: none` also takes the
          hidden fields out of the tab order and the accessibility tree, so
          they cannot be reached by keyboard from the visible page. */}
      {steps.map((step, position) => (
        <div key={step.key} className={cn(isWizard && position !== stepIndex && 'hidden')}>
          <StepSection
            step={step}
            position={position}
            isLast={position === steps.length - 1}
            appearance={appearance}
            density={density}
            layoutMode={layoutMode}
            drafts={session.drafts}
            issuesByStep={issuesByStep}
            collapsed={collapsed}
            isFolded={foldedSteps.has(step.key)}
            onToggleStep={() => toggleStep(step.key)}
            onToggle={toggle}
            onChange={session.setEntryAnswers}
            onAdd={() => session.addEntry(step.key)}
            onRemove={(index) => session.removeEntry(step.key, index)}
          />
        </div>
      ))}

      {steps.length === 0 && (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          This app has no steps configured yet.
        </Card>
      )}

      {/* ── Submit bar ──────────────────────────────────────────────────── */}
      <Card className={cn('space-y-4 p-5 sm:p-6', density.card)}>
        {submitError && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-[var(--radius)] border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{submitError}</span>
          </p>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          {/* Back replaces Reset everywhere except the last page: on a wizard
              the bottom-left button is where a respondent reaches for "go
              back", and putting an irreversible Clear-everything there is an
              expensive place to be wrong. Reset returns on the final page,
              next to Submit, where the whole report is in view. */}
          {isWizard && !isLastStep ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => goTo(stepIndex - 1)}
              disabled={stepIndex === 0}
              className="gap-2"
            >
              <ChevronLeft size={15} aria-hidden /> Back
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (window.confirm('Clear every answer in this report? This cannot be undone.')) {
                  void session.reset();
                }
              }}
              disabled={isSubmitting}
              className="gap-2"
            >
              <RotateCcw size={15} aria-hidden /> Reset
            </Button>
          )}

          {isWizard && !isLastStep ? (
            <Button
              type="button"
              size="lg"
              onClick={() => goTo(stepIndex + 1)}
              className="w-full gap-2 font-semibold sm:w-auto sm:px-8"
            >
              Next <ChevronRight size={16} aria-hidden />
            </Button>
          ) : (
          <Button
            type="button"
            size="lg"
            onClick={() => void handleSubmit()}
            disabled={isSubmitting || steps.length === 0}
            className="w-full gap-2 font-semibold sm:w-auto sm:px-8"
          >
            {isSubmitting ? (
              <>
                <Loader2 size={16} className="animate-spin" aria-hidden /> Submitting…
              </>
            ) : (
              <>
                Submit all <Check size={16} aria-hidden />
              </>
            )}
          </Button>
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground sm:text-right" role="status">
          {session.isSaving ? 'Saving…' : 'Your answers are saved as you type.'}
          {isWizard && !isLastStep
            ? ' Nothing is submitted until the last step.'
            : ' Everything is submitted together.'}
        </p>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Where the respondent is, and how much is left.
 *
 * The chips are navigable rather than decorative. Nothing is validated per
 * step — the whole report is checked once, at submit — so there is no state a
 * forward jump could corrupt, and forbidding one would only trap someone who
 * wants to correct an answer three steps back.
 */
function WizardProgress({
  steps,
  activeIndex,
  stepsWithIssues,
  onGoTo,
}: {
  steps: AppSessionStep[];
  activeIndex: number;
  stepsWithIssues: Set<string>;
  onGoTo: (index: number) => void;
}) {
  const current = steps[activeIndex];
  const percent = steps.length <= 1 ? 100 : ((activeIndex + 1) / steps.length) * 100;

  return (
    <Card className="space-y-3 p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold text-foreground">
          <span className="tabular text-muted-foreground">
            Step {activeIndex + 1} of {steps.length}
          </span>
          {current && <span className="ml-2">{current.title}</span>}
        </p>
      </div>

      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={activeIndex + 1}
        aria-valuemin={1}
        aria-valuemax={steps.length}
        aria-label="Progress through this report"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>

      {/* Scrolls rather than wraps: a programme with eight steps would
          otherwise reflow the whole header every time the titles change
          length, and the row would push the form itself off the screen. */}
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {steps.map((step, index) => {
          const isActive = index === activeIndex;
          const hasIssue = stepsWithIssues.has(step.key);
          return (
            <button
              key={step.key}
              type="button"
              onClick={() => onGoTo(index)}
              aria-current={isActive ? 'step' : undefined}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                isActive
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border text-muted-foreground hover:border-border-strong hover:bg-muted/50',
                hasIssue && 'border-destructive/60 text-destructive',
              )}
            >
              <span
                className={cn(
                  'tabular flex size-4 items-center justify-center rounded-full text-[10px] font-semibold',
                  isActive ? 'bg-primary text-[var(--primary-foreground)]' : 'bg-muted',
                  hasIssue && 'bg-destructive text-white',
                )}
              >
                {hasIssue ? '!' : index + 1}
              </span>
              <span className="max-w-32 truncate">{step.title}</span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function StepSection({
  step,
  position,
  isLast,
  appearance,
  density,
  layoutMode,
  drafts,
  issuesByStep,
  collapsed,
  isFolded,
  onToggleStep,
  onToggle,
  onChange,
  onAdd,
  onRemove,
}: {
  step: AppSessionStep;
  /** Zero-based position among visible steps. The number on a timeline disc. */
  position: number;
  isLast: boolean;
  appearance: AppAppearance;
  density: DensityTokens;
  layoutMode: AppLayoutMode;
  drafts: Record<string, Record<string, unknown>>;
  issuesByStep: Map<string, SessionIssue[]>;
  collapsed: Set<string>;
  isFolded: boolean;
  onToggleStep: () => void;
  onToggle: (key: string) => void;
  onChange: (stepKey: string, index: number, answers: Record<string, unknown>) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}) {
  // A repeatable step with no staged entries still shows one empty card when it
  // is mandatory — asking someone to press "+ Add" before they can begin is a
  // step they will miss.
  const indexes = React.useMemo(() => {
    const fromServer = step.entries.map((entry) => entry.index);
    const fromDrafts = Object.keys(drafts)
      .filter((key) => key.startsWith(`${step.key}#`))
      .map((key) => Number(key.split('#')[1]));
    const all = [...new Set([...fromServer, ...fromDrafts])].sort((a, b) => a - b);
    if (all.length > 0) return all;
    return step.mode === 'SINGLE' || step.minEntries > 0 ? [0] : [];
  }, [step, drafts]);

  const atMax = step.maxEntries !== null && indexes.length >= step.maxEntries;

  const style = appearance.stepStyle;
  const isAccordion = style === 'accordion';
  const isTimeline = style === 'timeline';
  const hidden = isAccordion && isFolded;

  const entryCount =
    step.mode === 'REPEATABLE' ? (
      <span className="tabular shrink-0 text-xs text-muted-foreground">
        {indexes.length}
        {step.maxEntries !== null ? ` / ${step.maxEntries}` : ''}{' '}
        {indexes.length === 1 ? 'entry' : 'entries'}
      </span>
    ) : null;

  const heading = (
    <>
      {step.icon && <span aria-hidden>{step.icon}</span>}
      <h2 id={`step-${step.key}`} className="min-w-0 text-base font-semibold text-foreground">
        {step.title}
      </h2>
      {step.isOptional && (
        <span className="shrink-0 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Optional
        </span>
      )}
    </>
  );

  return (
    <section
      className={cn('space-y-3', isTimeline && 'relative pl-9')}
      aria-labelledby={`step-${step.key}`}
    >
      {/* The connector, drawn behind the disc and stopped short of the last
          step so the line does not trail off past the end of the report. */}
      {isTimeline && !isLast && (
        <span aria-hidden className="absolute bottom-0 left-[0.9375rem] top-8 w-px bg-border" />
      )}
      {isTimeline && (
        <span
          aria-hidden
          className="tabular absolute left-0 top-0 flex size-8 items-center justify-center rounded-full border border-border bg-card text-xs font-semibold text-muted-foreground"
        >
          {position + 1}
        </span>
      )}

      {isAccordion ? (
        <button
          type="button"
          onClick={onToggleStep}
          aria-expanded={!isFolded}
          className="flex w-full flex-wrap items-center gap-2 rounded-[var(--radius)] border border-border bg-card px-4 py-3 text-left"
        >
          <ChevronDown
            className={cn('size-4 shrink-0 transition-transform', isFolded && '-rotate-90')}
            aria-hidden
          />
          {heading}
          <span className="flex-1" />
          {entryCount}
        </button>
      ) : (
        <div
          className={cn(
            'flex flex-wrap items-center justify-between gap-2',
            style === 'bordered' && 'border-b border-border pb-2',
          )}
        >
          <div className="flex min-w-0 items-center gap-2">{heading}</div>
          {entryCount}
        </div>
      )}

      {!hidden && step.description && (
        <p className="text-sm text-muted-foreground">{step.description}</p>
      )}

      {!hidden && indexes.map((index) => {
        const entryKey = `${step.key}#${index}`;
        const isCollapsed = collapsed.has(entryKey);
        const entryIssues = issuesByStep.get(entryKey) ?? [];
        const fieldIssues = Object.fromEntries(
          entryIssues
            .filter((issue) => issue.questionId)
            .map((issue) => [issue.questionId!, issue.message]),
        );

        return (
          <Card
            key={entryKey}
            className={cn(
              'overflow-visible p-0',
              density.card,
              entryIssues.length > 0 && 'border-destructive/60 ring-1 ring-destructive/40',
            )}
          >
            {step.mode === 'REPEATABLE' && (
              <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
                <button
                  type="button"
                  onClick={() => onToggle(entryKey)}
                  aria-expanded={!isCollapsed}
                  className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground"
                >
                  <ChevronDown
                    className={cn('size-4 transition-transform', isCollapsed && '-rotate-90')}
                    aria-hidden
                  />
                  {step.title} #{index + 1}
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${step.title} ${index + 1}`}
                  onClick={() => void onRemove(index)}
                  className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </Button>
              </div>
            )}

            {!isCollapsed && (
              <div className={density.entry}>
                {/* Only the issues that have no field to sit on. Anything with
                    a questionId is rendered against that question below, which
                    is where a respondent looks — repeating it here would say
                    the same thing twice and bury the ones that have nowhere
                    else to go, like "this duplicates entry 1". */}
                {entryIssues.some((issue) => !issue.questionId) && (
                  <ul role="alert" className="mb-4 space-y-1">
                    {entryIssues
                      .filter((issue) => !issue.questionId)
                      .map((issue, at) => (
                        <li key={at} className="text-xs font-medium text-destructive">
                          {issue.message}
                        </li>
                      ))}
                  </ul>
                )}

                <FormRunner
                  form={
                    {
                      ...step.form,
                      rules: step.form.compiledRules,
                      title: step.form.title,
                      description: '',
                    } as unknown as FormConfig
                  }
                  formSlug={step.form.slug}
                  // The app's own setting, not the step form's. A step is a
                  // section of one continuous session, so letting each form
                  // bring its own column count would change the layout partway
                  // through and read as a rendering fault.
                  layoutMode={layoutMode}
                  initialAnswers={drafts[entryKey] ?? {}}
                  // Field-level rejections land on their own question, and the
                  // whole entry stops holding its problems back — a respondent
                  // told "the report cannot be submitted" needs to see which
                  // box, not just which card.
                  issues={fieldIssues}
                  showAllProblems={entryIssues.length > 0}
                  // The app owns submission; the runner is only a field editor
                  // here, so its own submit chrome is replaced by this callback
                  // firing on every change.
                  onAnswersChange={(answers) => onChange(step.key, index, answers)}
                  hideChrome
                />
              </div>
            )}
          </Card>
        );
      })}

      {!hidden && step.mode === 'REPEATABLE' && (
        <Button
          type="button"
          variant="outline"
          onClick={() => void onAdd()}
          disabled={atMax}
          className="w-full gap-2 border-dashed"
        >
          <Plus className="size-4" aria-hidden />
          Add {step.title.toLowerCase()}
          {atMax ? ' (maximum reached)' : ''}
        </Button>
      )}
    </section>
  );
}
