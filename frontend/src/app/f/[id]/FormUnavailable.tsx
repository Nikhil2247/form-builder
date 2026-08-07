'use client';

import React from 'react';
import { AlertTriangle, FileQuestion, Lock, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Terminal state for the public form page.
 *
 * Respondents are not users of this product — they followed a link someone sent
 * them. So this page says what happened in plain language, offers the one
 * action that can help, and does not mention the dashboard, sign-in, or
 * anything else they have no access to.
 *
 * It replaces a single unstyled line of red text that was shown identically for
 * a missing form, an expired form, a suspended organization, and an unreachable
 * API — the last of which is transient and was presented as permanent.
 *
 * Deliberately self-contained: no shared app chrome, because /f/* renders
 * outside the authenticated layout.
 */

const VARIANTS = {
  'not-found': { icon: FileQuestion, tone: 'text-muted-foreground', bg: 'bg-muted' },
  closed: { icon: Lock, tone: 'text-warning', bg: 'bg-warning/10' },
  error: { icon: AlertTriangle, tone: 'text-destructive', bg: 'bg-destructive/10' },
} as const;

export function FormUnavailable({
  variant,
  title,
  message,
  retryable,
}: {
  variant: keyof typeof VARIANTS;
  title: string;
  message: string;
  retryable?: boolean;
}) {
  const { icon: Icon, tone, bg } = VARIANTS[variant];

  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/30 p-6">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 text-center shadow-card">
        <div
          className={cn('mx-auto mb-5 flex size-12 items-center justify-center rounded-full', bg)}
        >
          <Icon className={cn('size-6', tone)} strokeWidth={1.5} aria-hidden />
        </div>

        <h1 className="text-base font-semibold text-foreground">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>

        {retryable && (
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-6 inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm
                       font-medium text-primary-foreground transition-colors hover:bg-primary/90
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
                       focus-visible:ring-offset-2"
          >
            <RefreshCw className="size-3.5" />
            Try again
          </button>
        )}

        <p className="mt-6 border-t border-border pt-4 text-xs text-muted-foreground">
          If you were expecting to fill this in, contact whoever sent you the link.
        </p>
      </div>
    </main>
  );
}
