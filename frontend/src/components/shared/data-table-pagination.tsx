'use client';

import React from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * Server-side pagination control.
 *
 * What was there before: a "Prev / Page N of M / Next" strip, copy-pasted into
 * four pages with slightly different bugs. The forms list computed its page
 * count from the *locally filtered* array, so searching made the pager claim
 * one page while the server still held twenty; the submissions page hardcoded a
 * page size of 50 that no control could change; none of them told the user how
 * many records existed; and all of them rendered `<a href="#">`, so every page
 * change pushed a history entry and Enter on a focused control scrolled to top.
 *
 * This one is a set of real buttons, reports the range and total, offers a page
 * size, and disables rather than hides its controls at the boundaries so the
 * layout does not shift.
 */

export interface DataTablePaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
  /** Plural noun for the range summary, e.g. "forms". */
  itemLabel?: string;
  /** Dims the summary while a page is in flight. */
  isLoading?: boolean;
  className?: string;
}

/**
 * Steps up from the platform default of 12. The API clamps at 100, so 100 is
 * the last useful option — offering more would silently return 100 anyway and
 * leave the pager computing page counts from a size the server never used.
 */
const DEFAULT_PAGE_SIZES = [12, 24, 48, 100];

/**
 * Page numbers to render, with `null` marking an elided run.
 * Always shows first, last, current, and one neighbour either side.
 */
export function buildPageList(current: number, totalPages: number): (number | null)[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const pages = new Set<number>([1, totalPages, current]);
  if (current - 1 > 1) pages.add(current - 1);
  if (current + 1 < totalPages) pages.add(current + 1);
  // Keep the strip a stable width near the ends.
  if (current <= 3) [2, 3, 4].forEach((p) => pages.add(p));
  if (current >= totalPages - 2)
    [totalPages - 3, totalPages - 2, totalPages - 1].forEach((p) => pages.add(p));

  const sorted = [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);

  const out: (number | null)[] = [];
  let previous = 0;
  for (const p of sorted) {
    if (previous && p - previous > 1) out.push(null);
    out.push(p);
    previous = p;
  }
  return out;
}

export function DataTablePagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZES,
  itemLabel = 'results',
  isLoading,
  className,
}: DataTablePaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), totalPages);

  const firstRow = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const lastRow = Math.min(current * pageSize, total);

  const go = (next: number) => {
    const clamped = Math.min(Math.max(1, next), totalPages);
    if (clamped !== current) onPageChange(clamped);
  };

  // A single page of results needs no controls, but the count is still useful.
  const showControls = totalPages > 1;

  return (
    <nav
      aria-label="Pagination"
      className={cn(
        'flex flex-col-reverse items-center justify-between gap-3 border-t border-border px-4 py-3 sm:flex-row',
        className,
      )}
    >
      <p
        className={cn(
          'tabular text-xs text-muted-foreground transition-opacity',
          isLoading && 'opacity-50',
        )}
        aria-live="polite"
      >
        {total === 0 ? (
          <>No {itemLabel}</>
        ) : (
          <>
            Showing <span className="font-medium text-foreground">{firstRow.toLocaleString()}</span>
            {'–'}
            <span className="font-medium text-foreground">{lastRow.toLocaleString()}</span> of{' '}
            <span className="font-medium text-foreground">{total.toLocaleString()}</span>{' '}
            {itemLabel}
          </>
        )}
      </p>

      <div className="flex items-center gap-4">
        {onPageSizeChange && total > pageSizeOptions[0] && (
          <label className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
            <span>Rows</span>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => v && onPageSizeChange(Number(v))}
            >
              <SelectTrigger className="h-8 w-[4.5rem] text-xs" aria-label="Rows per page">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizeOptions.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        )}

        {showControls && (
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => go(1)}
              disabled={current === 1}
              aria-label="First page"
              className="hidden sm:inline-flex"
            >
              <ChevronsLeft className="size-3.5" />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => go(current - 1)}
              disabled={current === 1}
              aria-label="Previous page"
            >
              <ChevronLeft className="size-3.5" />
            </Button>

            <div className="flex items-center gap-1">
              {buildPageList(current, totalPages).map((p, i) =>
                p === null ? (
                  <span
                    key={`gap-${i}`}
                    aria-hidden
                    className="px-1 text-xs text-muted-foreground"
                  >
                    …
                  </span>
                ) : (
                  <Button
                    key={p}
                    variant={p === current ? 'default' : 'ghost'}
                    size="icon-sm"
                    onClick={() => go(p)}
                    aria-label={`Page ${p}`}
                    aria-current={p === current ? 'page' : undefined}
                    className="tabular min-w-8 text-xs"
                  >
                    {p}
                  </Button>
                ),
              )}
            </div>

            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => go(current + 1)}
              disabled={current === totalPages}
              aria-label="Next page"
            >
              <ChevronRight className="size-3.5" />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => go(totalPages)}
              disabled={current === totalPages}
              aria-label="Last page"
              className="hidden sm:inline-flex"
            >
              <ChevronsRight className="size-3.5" />
            </Button>
          </div>
        )}
      </div>
    </nav>
  );
}
