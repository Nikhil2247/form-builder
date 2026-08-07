'use client';

import React from 'react';
import { format, formatDistanceToNow, isValid, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';

/**
 * Date, time, and duration rendering.
 *
 * Every page did its own `formatDistanceToNow(new Date(x))`. Two problems that
 * caused real breakage:
 *
 *  • `new Date(undefined)` yields Invalid Date, and date-fns throws a
 *    RangeError on it — a single record with a null `updatedAt` took down the
 *    whole list with a client-side exception rather than showing a dash.
 *  • Formatting on the server and then again on the client produced different
 *    strings ("3 minutes ago" vs "4 minutes ago"), which React reports as a
 *    hydration mismatch and resolves by discarding the server HTML.
 *
 * These components parse defensively and render relative times only after
 * mount, with the absolute timestamp always available in the tooltip.
 */

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date =
    value instanceof Date
      ? value
      : typeof value === 'number'
        ? new Date(value)
        : parseISO(value);
  return isValid(date) ? date : null;
}

export function RelativeTime({
  value,
  className,
  fallback = '—',
  addSuffix = true,
}: {
  value: string | number | Date | null | undefined;
  className?: string;
  fallback?: string;
  addSuffix?: boolean;
}) {
  const date = toDate(value);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  if (!date) return <span className={cn('text-muted-foreground', className)}>{fallback}</span>;

  const absolute = format(date, "d MMM yyyy 'at' HH:mm");

  return (
    <time dateTime={date.toISOString()} title={absolute} className={cn('tabular', className)}>
      {mounted ? formatDistanceToNow(date, { addSuffix }) : absolute}
    </time>
  );
}

export function FormattedDate({
  value,
  pattern = 'd MMM yyyy, HH:mm',
  className,
  fallback = '—',
}: {
  value: string | number | Date | null | undefined;
  pattern?: string;
  className?: string;
  fallback?: string;
}) {
  const date = toDate(value);
  if (!date) return <span className={cn('text-muted-foreground', className)}>{fallback}</span>;

  return (
    <time dateTime={date.toISOString()} className={cn('tabular', className)}>
      {format(date, pattern)}
    </time>
  );
}

/**
 * Milliseconds → a readable duration.
 *
 * The API reports completion time in milliseconds. The form detail page divided
 * by 1000 and appended "s", so a four-minute response read "247s".
 */
export function Duration({
  ms,
  className,
  fallback = '—',
}: {
  ms: number | null | undefined;
  className?: string;
  fallback?: string;
}) {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) {
    return <span className={cn('text-muted-foreground', className)}>{fallback}</span>;
  }

  return <span className={cn('tabular', className)}>{formatDuration(ms)}</span>;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;

  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

/** Compact counts for tiles: 1_284 → "1.3k". */
export function formatCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (Math.abs(value) < 1000) return String(value);
  return new Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '—';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const size = bytes / Math.pow(1024, exponent);
  return `${size.toFixed(size >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}
