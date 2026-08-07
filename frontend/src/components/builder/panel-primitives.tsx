'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';

/**
 * The shared vocabulary for every builder panel — settings, theme, logic.
 *
 * These panels were written at three different times and looked it. The
 * settings panel used semantic tokens at one density, the theme panel used a
 * larger card/heading scale with its own hero block, and the logic builder was
 * hardcoded against `slate-*`, `indigo-*` and `rose-*` with raw `<select>`
 * elements — so it ignored the app's palette entirely and did not follow the
 * theme in dark mode at all.
 *
 * Everything now composes from these four pieces, which means the density,
 * heading scale, divider treatment and control size are decided once. Nothing
 * here introduces a colour: only `border`, `card`, `foreground`,
 * `muted-foreground`, `primary` and `destructive` tokens are used, so a panel
 * cannot drift off-palette without deliberately reaching past this file.
 */

/** A titled group of rows. */
export function PanelSection({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  /** Right-aligned control in the section header. */
  action?: React.ReactNode;
  /** Omit for a header-only section — the logic canvas uses one as its masthead. */
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('p-4 sm:p-5', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {title}
          </h3>
          {description && (
            <p className="mt-1 max-w-prose text-xs leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children && <div className="mt-1 divide-y divide-border">{children}</div>}
    </Card>
  );
}

/**
 * Label on the left, control on the right.
 *
 * Stacks below `sm` — the control column is a fixed 18rem, which at a narrow
 * modal width would otherwise squeeze the label to two characters per line.
 */
export function PanelRow({
  icon: Icon,
  title,
  hint,
  children,
  className,
}: {
  icon?: React.ElementType;
  title: string;
  hint?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-5',
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        {Icon && (
          <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium leading-tight">{title}</p>
          {hint && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{hint}</p>}
        </div>
      </div>
      {children && (
        <div className="flex shrink-0 items-center sm:justify-end">{children}</div>
      )}
    </div>
  );
}

/** How a block's hint reads. Only palette tokens — no literal colours. */
export type HintTone = 'muted' | 'warning' | 'destructive';

const HINT_TONE: Record<HintTone, string> = {
  muted: 'text-muted-foreground',
  warning: 'text-warning',
  destructive: 'text-destructive',
};

/** Full-width block inside a section, for controls a row cannot hold. */
export function PanelBlock({
  label,
  hint,
  hintTone = 'muted',
  htmlFor,
  children,
  className,
}: {
  label?: string;
  hint?: string;
  /** Lets a validation message reuse the hint slot instead of adding a line. */
  hintTone?: HintTone;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5 py-3', className)}>
      {label && (
        <label htmlFor={htmlFor} className="block text-xs font-medium text-foreground">
          {label}
        </label>
      )}
      {children}
      {hint && <p className={cn('text-xs leading-relaxed', HINT_TONE[hintTone])}>{hint}</p>}
    </div>
  );
}
