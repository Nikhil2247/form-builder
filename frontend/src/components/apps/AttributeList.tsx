'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import type { AttributeValue } from '@/hooks/use-subjects';

/**
 * Promoted identity attributes on a record.
 *
 * Values here are raw form answers, so they are whatever the question type
 * produced — a string, a number, a multi-choice array, or a nested object from
 * a repeating section. Rendering them with `{value}` directly throws
 * ("Objects are not valid as a React child") on exactly the records that carry
 * the most information, so everything goes through `formatAttributeValue`.
 */

export function formatAttributeValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) {
    return value.length === 0 ? '—' : value.map(formatAttributeValue).join(', ');
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Keys are question keys — readable enough, but not sentence case. */
export function humanizeKey(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\w/, (c) => c.toUpperCase());
}

export function AttributeList({
  attributes,
  className,
  emptyLabel = 'No attributes have been promoted onto this record yet.',
}: {
  attributes: Record<string, AttributeValue> | null | undefined;
  className?: string;
  emptyLabel?: string;
}) {
  const entries = Object.entries(attributes ?? {});

  if (entries.length === 0) {
    return <p className={cn('text-sm text-muted-foreground', className)}>{emptyLabel}</p>;
  }

  return (
    <dl className={cn('grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3', className)}>
      {entries.map(([key, value]) => (
        <div key={key} className="min-w-0">
          <dt className="text-xs font-medium text-muted-foreground">{humanizeKey(key)}</dt>
          <dd className="mt-0.5 break-words text-sm text-foreground">
            {formatAttributeValue(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
