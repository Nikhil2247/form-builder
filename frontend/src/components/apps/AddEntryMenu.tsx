'use client';

import React from 'react';
import { CalendarClock, ChevronDown, Lock, Plus } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Spinner } from '@/components/ui/spinner';
import { RelativeTime } from '@/components/shared';
import { cn } from '@/lib/utils';
import {
  useSubjectEntryOptions,
  type AvailableStep,
  type EntryOption,
  type FileablePeriod,
  type StepDueState,
} from '@/hooks/use-subjects';

/**
 * "Add entry" — the way a record grows after registration.
 *
 * Before this existed, recording a second visit meant re-filling the record's
 * entire registration so the identity hash would land on the same record. That
 * cost a re-typed registration every visit and, on any typo, silently created a
 * duplicate person.
 *
 * ── Why unavailable steps are shown, not hidden ────────────────────────────
 * A worker who cannot find "Monthly Progress Check" in this menu learns
 * nothing, and reasonably concludes the app is broken. One who sees it greyed
 * with "already recorded for this reporting period" learns the job is done.
 * Every unavailable step therefore keeps its place and carries its reason.
 */
export function AddEntryMenu({ subjectId }: { subjectId: string }) {
  const entries = useSubjectEntryOptions(subjectId);

  const options = entries.data?.options ?? [];
  const openCount = options.reduce(
    (total, option) => total + option.steps.filter((step) => step.available).length,
    0,
  );

  // No app records against this record's type — the menu has nothing to say, so
  // it is absent rather than present and permanently empty.
  if (!entries.isLoading && options.length === 0) return null;

  return (
    <DropdownMenu>
      {/* The trigger renders its own button, so it is styled with the button
          recipe rather than wrapping a <Button> — nesting one inside the other
          produces a button in a button. */}
      <DropdownMenuTrigger
        className={cn(buttonVariants({ size: 'sm' }), 'gap-2')}
        disabled={entries.isLoading}
      >
        {entries.isLoading ? <Spinner className="size-4" /> : <Plus className="size-4" />}
        Add entry
        {openCount > 0 && (
          <span className="tabular rounded bg-primary-foreground/15 px-1.5 text-xs">
            {openCount}
          </span>
        )}
        <ChevronDown className="size-3.5 opacity-70" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80">
        {options.map((option, index) => (
          <React.Fragment key={option.app.id}>
            {index > 0 && <DropdownMenuSeparator />}
            <AppSection subjectId={subjectId} option={option} />
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function AppSection({
  subjectId,
  option,
}: {
  subjectId: string;
  option: EntryOption;
}) {
  // An app is reachable only through its public link. Saying so plainly beats
  // offering steps whose every click would 404 — and names the fix, since the
  // link is one setting away.
  const canRun = !!option.app.publicSlug;

  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel className="flex items-baseline justify-between gap-2">
        <span className="truncate">
          {option.app.icon && <span className="mr-1.5">{option.app.icon}</span>}
          {option.app.name}
        </span>
        {option.period && (
          <span className="shrink-0 text-xs font-normal text-muted-foreground">
            {option.period.label}
          </span>
        )}
      </DropdownMenuLabel>

      {option.isOutsidePeriod ? (
        <Notice icon={CalendarClock}>
          Outside its reporting period. Nothing can be recorded right now.
        </Notice>
      ) : !canRun ? (
        <Notice icon={Lock}>
          This app has no shareable link yet. Add one in the app&rsquo;s settings to
          record entries against it.
        </Notice>
      ) : (
        <>
          {option.steps.map((step) => (
            <StepItem
              key={step.stepKey}
              step={step}
              subjectId={subjectId}
              publicSlug={option.app.publicSlug!}
              period={option.period}
            />
          ))}

          {/* Late entry. Offered only when a closed window is still inside its
              grace, because listing "file under February" all March would
              invite entries into the wrong month rather than prevent them. */}
          {option.fileablePeriods.length > 1 && (
            <LateEntry
              subjectId={subjectId}
              publicSlug={option.app.publicSlug!}
              steps={option.steps}
              periods={option.fileablePeriods.slice(1)}
            />
          )}
        </>
      )}
    </DropdownMenuGroup>
  );
}

/**
 * Filing into a window that has closed but is still in grace.
 *
 * A worker who visited on the 28th and reaches a keyboard on the 3rd needs the
 * entry to land in the month it happened. Without this the only options are
 * filing it under the wrong month or not filing it at all, and people choose
 * the wrong month.
 */
function LateEntry({
  subjectId,
  publicSlug,
  steps,
  periods,
}: {
  subjectId: string;
  publicSlug: string;
  steps: AvailableStep[];
  periods: FileablePeriod[];
}) {
  // Only steps counted per period can be filed into a past one — for anything
  // else the window is a label rather than a bucket, so offering the choice
  // would imply a distinction that does not exist.
  const perPeriod = steps.filter(
    (step) => step.available && step.scope === 'SUBJECT_PERIOD',
  );
  if (perPeriod.length === 0) return null;

  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
        Record for an earlier period
      </DropdownMenuLabel>
      {periods.map((period) =>
        perPeriod.map((step) => (
          <DropdownMenuItem
            key={`${period.startsAt}-${step.stepKey}`}
            render={
              <a
                href={
                  `/a/${publicSlug}?subject=${encodeURIComponent(subjectId)}` +
                  `&step=${encodeURIComponent(step.stepKey)}` +
                  (period.id ? `&period=${encodeURIComponent(period.id)}` : '')
                }
              />
            }
            className="cursor-pointer"
          >
            <CalendarClock className="mr-2 size-3.5 shrink-0" strokeWidth={1.5} />
            <span className="truncate">
              {step.title} · {period.label}
            </span>
          </DropdownMenuItem>
        )),
      )}
    </>
  );
}

function Notice({
  icon: Icon,
  children,
}: {
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <p className="flex gap-2 px-2 py-2 text-xs text-muted-foreground">
      <Icon className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.5} />
      <span>{children}</span>
    </p>
  );
}

function StepItem({
  step,
  subjectId,
  publicSlug,
  period,
}: {
  step: AvailableStep;
  subjectId: string;
  publicSlug: string;
  period: FileablePeriod | null;
}) {
  if (!step.available) {
    return (
      <DropdownMenuItem disabled className="flex-col items-start gap-0.5">
        <span className="flex w-full items-center gap-2">
          {step.icon && <span aria-hidden>{step.icon}</span>}
          <span className="truncate">{step.title}</span>
        </span>
        {step.detail && (
          <span className="text-xs text-muted-foreground">
            {step.detail}
            {/* Which window it is satisfied FOR. "Already recorded" alone reads
                as permanent when it only means "for March". */}
            {step.reason === 'PERIOD_SATISFIED' && period && ` (${period.label})`}
          </span>
        )}
      </DropdownMenuItem>
    );
  }

  // The runner is a public route in this same app, reached by a full navigation
  // rather than a client transition: it renders outside the dashboard shell.
  const href =
    `/a/${publicSlug}?subject=${encodeURIComponent(subjectId)}` +
    `&step=${encodeURIComponent(step.stepKey)}`;

  // A real anchor, so the row keeps middle-click and "open in new tab" — a
  // worker filing a round of visits often wants several open at once.
  return (
    <DropdownMenuItem
      render={<a href={href} />}
      className="cursor-pointer flex-col items-start gap-0.5"
    >
      <span className="flex w-full items-center gap-2">
        {step.icon && <span aria-hidden>{step.icon}</span>}
        <span className="truncate font-medium">{step.title}</span>
        <DueBadge due={step.due} />
        {step.remaining !== null && step.existingCount > 0 && (
          <span className="tabular ml-auto shrink-0 text-xs text-muted-foreground">
            {step.remaining} left
          </span>
        )}
      </span>
      <span className="text-xs text-muted-foreground">
        {step.existingCount === 0 ? (
          (step.description ?? 'Not yet recorded')
        ) : (
          <>
            {step.existingCount} recorded
            {step.lastOccurredAt && (
              <>
                {' · last '}
                <RelativeTime value={step.lastOccurredAt} />
              </>
            )}
          </>
        )}
      </span>
    </DropdownMenuItem>
  );
}

/**
 * How far past its date a step is.
 *
 * Only OVERDUE and DUE get a badge. Marking "upcoming" would put a colour on
 * every scheduled step at all times, which is the fastest way to teach people
 * that the colours mean nothing.
 */
function DueBadge({ due }: { due: StepDueState }) {
  if (due.status === 'OVERDUE') {
    return (
      <span className="shrink-0 rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">
        {due.missedCount > 1
          ? `${due.missedCount} missed`
          : `${due.overdueByDays}d overdue`}
      </span>
    );
  }

  if (due.status === 'DUE') {
    return (
      <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
        Due
      </span>
    );
  }

  return null;
}
