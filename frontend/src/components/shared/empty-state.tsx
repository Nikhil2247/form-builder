'use client';

import React from 'react';
import { AlertTriangle, RefreshCw, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { describeError, ErrorDetail } from '@/lib/errors';

/**
 * Empty, error, and forbidden states.
 *
 * Pages previously rendered `null`, a bare "No data", or nothing at all when a
 * query failed — indistinguishable from "still loading" and from "you have no
 * records". These three components make the distinction explicit, which is the
 * difference between a user retrying and a user assuming their data is gone.
 */

export interface EmptyStateProps {
  icon?: React.ElementType;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  /** `panel` draws a dashed container; `inline` sits inside an existing one. */
  variant?: 'panel' | 'inline';
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  variant = 'panel',
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center px-6 text-center',
        variant === 'panel'
          ? 'rounded-xl border border-dashed border-border-strong bg-card py-16'
          : 'py-14',
        className,
      )}
    >
      {Icon && (
        <div className="mb-4 flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon className="size-5" strokeWidth={1.5} />
        </div>
      )}
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-5 flex items-center gap-2">{action}</div>}
    </div>
  );
}

export interface ErrorStateProps {
  title?: string;
  error?: unknown;
  onRetry?: () => void;
  variant?: 'panel' | 'inline';
  className?: string;
}

export function ErrorState({
  title = 'Could not load this data',
  error,
  onRetry,
  variant = 'panel',
  className,
}: ErrorStateProps) {
  // Same humanising as the toasts, so an offline failure reads "check your
  // connection" here too rather than the raw "Failed to fetch", and so any
  // field-level issues the API sent are shown rather than dropped.
  const described = describeError(error, 'An unexpected error occurred.');

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center px-6 text-center',
        variant === 'panel'
          ? 'rounded-xl border border-destructive/20 bg-destructive/5 py-14'
          : 'py-12',
        className,
      )}
      role="alert"
    >
      <div className="mb-4 flex size-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="size-5" strokeWidth={1.5} />
      </div>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="mt-1.5 max-w-md text-sm text-muted-foreground">{described.title}</p>
      <div className="mt-1.5 max-w-md text-left text-sm text-muted-foreground">
        <ErrorDetail description={described.description} issues={described.issues} />
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-5 gap-2" onClick={onRetry}>
          <RefreshCw className="size-3.5" />
          Try again
        </Button>
      )}
    </div>
  );
}

export function ForbiddenState({
  title = 'You do not have access to this page',
  description = 'Ask an organization admin to grant you the required role.',
  action,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <ShieldAlert className="size-6" strokeWidth={1.5} />
      </div>
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <p className="mt-1.5 max-w-md text-sm text-muted-foreground">{description}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
