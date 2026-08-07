'use client';

import React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * The one place a status maps to a colour.
 *
 * Pages used to carry their own `STATUS_COLORS` maps — the forms list, the form
 * detail page, and the trash page each had a different one, so PUBLISHED was
 * emerald in one table and green-500 in another, and CLOSED was invisible in
 * dark mode because it was hardcoded to `text-slate-500`.
 *
 * Colours come from the semantic tokens in globals.css, so they follow the
 * theme and stay legible in both modes.
 */

const statusBadgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'border-border bg-muted text-muted-foreground',
        success: 'border-success/20 bg-success/10 text-success',
        warning: 'border-warning/25 bg-warning/10 text-warning',
        danger: 'border-destructive/20 bg-destructive/10 text-destructive',
        info: 'border-info/20 bg-info/10 text-info',
        accent: 'border-border-strong bg-foreground/5 text-foreground',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export type StatusTone = NonNullable<VariantProps<typeof statusBadgeVariants>['tone']>;

/** Domain status → tone. Unknown values fall back to neutral rather than blank. */
const STATUS_TONES: Record<string, StatusTone> = {
  // Form lifecycle
  DRAFT: 'warning',
  PUBLISHED: 'success',
  CLOSED: 'neutral',
  ARCHIVED: 'neutral',
  // Submissions
  SUBMITTED: 'success',
  PROCESSING: 'info',
  FLAGGED_SPAM: 'warning',
  REJECTED: 'danger',
  DELETED: 'danger',
  // Organizations / members
  ACTIVE: 'success',
  SUSPENDED: 'danger',
  PENDING: 'warning',
  EXPIRED: 'neutral',
  REVOKED: 'neutral',
  ACCEPTED: 'success',
  // Webhook deliveries
  SUCCESS: 'success',
  FAILED: 'danger',
  RETRYING: 'warning',
  // Roles
  ADMIN: 'accent',
  EDITOR: 'info',
  VIEWER: 'neutral',
  SUPER_ADMIN: 'accent',
};

/** Human labels for the SCREAMING_CASE values the API returns. */
function humanize(status: string) {
  return status
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export interface StatusBadgeProps {
  status: string | null | undefined;
  /** Override the automatic tone mapping. */
  tone?: StatusTone;
  /** Override the automatic label. */
  label?: string;
  /** Show a small filled dot before the label. */
  dot?: boolean;
  className?: string;
}

export function StatusBadge({ status, tone, label, dot, className }: StatusBadgeProps) {
  if (!status) return <span className="text-muted-foreground">—</span>;

  const resolved = tone ?? STATUS_TONES[status] ?? 'neutral';

  return (
    <span className={cn(statusBadgeVariants({ tone: resolved }), className)}>
      {dot && <span aria-hidden className="size-1.5 rounded-full bg-current" />}
      {label ?? humanize(status)}
    </span>
  );
}

export { statusBadgeVariants };
