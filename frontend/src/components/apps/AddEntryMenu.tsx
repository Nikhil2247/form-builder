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
        option.steps.map((step) => (
          <StepItem
            key={step.stepKey}
            step={step}
            subjectId={subjectId}
            publicSlug={option.app.publicSlug!}
          />
        ))
      )}
    </DropdownMenuGroup>
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
}: {
  step: AvailableStep;
  subjectId: string;
  publicSlug: string;
}) {
  if (!step.available) {
    return (
      <DropdownMenuItem disabled className="flex-col items-start gap-0.5">
        <span className="flex w-full items-center gap-2">
          {step.icon && <span aria-hidden>{step.icon}</span>}
          <span className="truncate">{step.title}</span>
        </span>
        {step.detail && (
          <span className="text-xs text-muted-foreground">{step.detail}</span>
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
