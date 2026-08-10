'use client';

import React from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
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
}

export function AppRunner({ publicSlug, app }: { publicSlug: string; app: AppSummary }) {
  const session = useAppSession(publicSlug);
  const [issues, setIssues] = React.useState<SessionIssue[]>([]);
  const [submitError, setSubmitError] = React.useState('');
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [done, setDone] = React.useState<{ submissionCount: number } | null>(null);
  const [collapsed, setCollapsed] = React.useState<Set<string>>(() => new Set());
  const summaryRef = React.useRef<HTMLDivElement | null>(null);

  const toggle = (key: string) =>
    setCollapsed((prev) => {
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

  const steps = session.session?.steps ?? [];
  const issuesByStep = new Map<string, SessionIssue[]>();
  for (const issue of issues) {
    const key = `${issue.stepKey}#${issue.index}`;
    issuesByStep.set(key, [...(issuesByStep.get(key) ?? []), issue]);
  }

  return (
    <div className="space-y-6">
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
              const step = steps.find((s) => s.key === issue.stepKey);
              return (
                <li key={index} className="text-xs text-destructive">
                  {step?.title ?? issue.stepKey}
                  {step?.mode === 'REPEATABLE' ? ` #${issue.index + 1}` : ''}: {issue.message}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {steps.map((step) => (
        <StepSection
          key={step.key}
          step={step}
          drafts={session.drafts}
          issuesByStep={issuesByStep}
          collapsed={collapsed}
          onToggle={toggle}
          onChange={session.setEntryAnswers}
          onAdd={() => session.addEntry(step.key)}
          onRemove={(index) => session.removeEntry(step.key, index)}
        />
      ))}

      {steps.length === 0 && (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          This app has no steps configured yet.
        </Card>
      )}

      {/* ── Submit bar ──────────────────────────────────────────────────── */}
      <Card className="space-y-4 p-5 sm:p-6">
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
        </div>

        <p className="text-center text-xs text-muted-foreground sm:text-right" role="status">
          {session.isSaving ? 'Saving…' : 'Your answers are saved as you type.'}
          {' Everything is submitted together.'}
        </p>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function StepSection({
  step,
  drafts,
  issuesByStep,
  collapsed,
  onToggle,
  onChange,
  onAdd,
  onRemove,
}: {
  step: AppSessionStep;
  drafts: Record<string, Record<string, unknown>>;
  issuesByStep: Map<string, SessionIssue[]>;
  collapsed: Set<string>;
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

  return (
    <section className="space-y-3" aria-labelledby={`step-${step.key}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
        <div className="flex min-w-0 items-center gap-2">
          {step.icon && <span aria-hidden>{step.icon}</span>}
          <h2 id={`step-${step.key}`} className="text-base font-semibold text-foreground">
            {step.title}
          </h2>
          {step.isOptional && (
            <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Optional
            </span>
          )}
        </div>
        {step.mode === 'REPEATABLE' && (
          <span className="tabular text-xs text-muted-foreground">
            {indexes.length}
            {step.maxEntries !== null ? ` / ${step.maxEntries}` : ''}{' '}
            {indexes.length === 1 ? 'entry' : 'entries'}
          </span>
        )}
      </div>

      {step.description && <p className="text-sm text-muted-foreground">{step.description}</p>}

      {indexes.map((index) => {
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
              <div className="p-4 sm:p-5">
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
                  layoutMode="DOCUMENT"
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

      {step.mode === 'REPEATABLE' && (
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
