'use client';

import React from 'react';
import { TrendingDown, TrendingUp, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Metric tile.
 *
 * The version on the form detail page hardcoded "86%", "1m 42s", and "+12%" —
 * numbers that had no relationship to the form being viewed and that every user
 * saw identically. This component has no defaults: a metric with no data
 * renders an em dash, and a delta is only drawn when one is supplied.
 */

export interface StatCardProps {
  label: string;
  value: React.ReactNode;
  /** Secondary line under the value. */
  hint?: React.ReactNode;
  icon?: React.ElementType;
  /** Percentage change vs the previous period. Omit when unknown. */
  delta?: number | null;
  /** For metrics where down is good (bounce rate, time to complete). */
  invertDelta?: boolean;
  isLoading?: boolean;
  className?: string;
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  delta,
  invertDelta,
  isLoading,
  className,
}: StatCardProps) {
  if (isLoading) {
    return (
      <div className={cn('rounded-xl border border-border bg-card p-4 shadow-card', className)}>
        <Skeleton className="h-3 w-20" />
        <Skeleton className="mt-3 h-7 w-24" />
        <Skeleton className="mt-2 h-3 w-16" />
      </div>
    );
  }

  const hasDelta = typeof delta === 'number' && Number.isFinite(delta);
  const improved = hasDelta ? (invertDelta ? delta! < 0 : delta! > 0) : false;
  const flat = hasDelta && delta === 0;
  const DeltaIcon = flat ? Minus : delta! > 0 ? TrendingUp : TrendingDown;

  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-card p-4 shadow-card transition-colors hover:border-border-strong',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {Icon && (
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Icon className="size-3.5" strokeWidth={1.5} />
          </span>
        )}
      </div>

      <div className="mt-2.5 flex items-baseline gap-2">
        <span className="tabular text-2xl font-semibold tracking-tight text-foreground">
          {value ?? '—'}
        </span>
        {hasDelta && (
          <span
            className={cn(
              'tabular inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-xs font-medium',
              flat
                ? 'text-muted-foreground'
                : improved
                  ? 'text-success'
                  : 'text-destructive',
            )}
            title="Compared with the previous period"
          >
            <DeltaIcon className="size-3" />
            {Math.abs(delta!).toFixed(1)}%
          </span>
        )}
      </div>

      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Consistent 2/4-column grid for a row of metrics. */
export function StatGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('grid grid-cols-2 gap-3 lg:grid-cols-4', className)}>{children}</div>
  );
}
