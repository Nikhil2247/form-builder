'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from './empty-state';
import { DataTablePagination } from './data-table-pagination';

/**
 * The table used by every list page.
 *
 * Replaces eight hand-built `<Table>` blocks that each re-implemented loading,
 * empty, and error handling — usually incompletely. Notably it fixes the
 * accessibility problems those shared:
 *
 *  • Clickable rows were `<tr onClick>` with no keyboard path, so every list
 *    was unusable without a mouse. Rows here are focusable, respond to
 *    Enter/Space, and expose a real link when `rowHref` is given.
 *  • Column headers were plain `<th>` with no scope and no sort state; sortable
 *    headers now carry `aria-sort` and are buttons.
 *  • Loading was a bare spinner that replaced the table, collapsing the layout;
 *    skeleton rows preserve the column widths instead.
 *  • Numeric cells were proportional-figure, so counts never lined up. The
 *    `numeric` column flag applies tabular figures and right alignment.
 */

export interface DataTableColumn<T> {
  /** Stable key. Also the sort key unless `sortKey` is given. */
  id: string;
  header: React.ReactNode;
  cell: (row: T, index: number) => React.ReactNode;
  /** Right-align and use tabular figures. */
  numeric?: boolean;
  sortable?: boolean;
  sortKey?: string;
  /** Tailwind width utility, e.g. 'w-40'. */
  width?: string;
  /** Drop the column below this breakpoint instead of overflowing. */
  hideBelow?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  headerClassName?: string;
  /** Marks the column that identifies the row — becomes the row header cell. */
  isRowHeader?: boolean;
}

export interface SortState {
  key: string;
  direction: 'asc' | 'desc';
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[] | undefined;
  getRowId: (row: T, index: number) => string;

  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;

  /** Shown when there is no data and no error. */
  empty?: React.ReactNode;

  /** Navigates on row activation (click, Enter, Space, middle-click). */
  rowHref?: (row: T) => string | undefined;
  onRowClick?: (row: T) => void;

  sort?: SortState;
  onSortChange?: (sort: SortState) => void;

  /** Server pagination. Omit for unpaginated tables. */
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    onPageChange: (page: number) => void;
    onPageSizeChange?: (size: number) => void;
    itemLabel?: string;
  };

  /** Accessible description of the table's contents. */
  caption?: string;
  skeletonRows?: number;
  /** Toolbar rendered above the table, inside the same bordered container. */
  toolbar?: React.ReactNode;
  className?: string;
  /** Sticks the header row while the body scrolls. */
  stickyHeader?: boolean;
  maxHeight?: string;
}

const HIDE_BELOW: Record<NonNullable<DataTableColumn<any>['hideBelow']>, string> = {
  sm: 'hidden sm:table-cell',
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
  xl: 'hidden xl:table-cell',
};

export function DataTable<T>({
  columns,
  data,
  getRowId,
  isLoading,
  error,
  onRetry,
  empty,
  rowHref,
  onRowClick,
  sort,
  onSortChange,
  pagination,
  caption,
  skeletonRows = 8,
  toolbar,
  className,
  stickyHeader,
  maxHeight,
}: DataTableProps<T>) {
  const router = useRouter();

  const interactive = !!rowHref || !!onRowClick;

  const activate = (row: T, event: React.MouseEvent | React.KeyboardEvent) => {
    if (onRowClick) {
      onRowClick(row);
      return;
    }
    const href = rowHref?.(row);
    if (!href) return;

    // Honour the modifier keys a real link would.
    const mouse = event as React.MouseEvent;
    if (mouse.metaKey || mouse.ctrlKey || mouse.shiftKey) {
      window.open(href, '_blank', 'noopener');
      return;
    }
    router.push(href);
  };

  const toggleSort = (column: DataTableColumn<T>) => {
    if (!onSortChange || !column.sortable) return;
    const key = column.sortKey ?? column.id;
    const direction: 'asc' | 'desc' =
      sort?.key === key && sort.direction === 'asc' ? 'desc' : 'asc';
    onSortChange({ key, direction });
  };

  const body = () => {
    if (error) {
      return (
        <tr>
          <td colSpan={columns.length} className="p-0">
            <ErrorState error={error} onRetry={onRetry} variant="inline" />
          </td>
        </tr>
      );
    }

    // Only show skeletons on the first load. A page change keeps the previous
    // rows visible (dimmed) so the table does not blink between pages.
    if (isLoading && !data?.length) {
      return Array.from({ length: skeletonRows }).map((_, r) => (
        <tr key={`skeleton-${r}`} className="border-b border-border last:border-0">
          {columns.map((column) => (
            <td
              key={column.id}
              className={cn('px-4 py-3', column.hideBelow && HIDE_BELOW[column.hideBelow])}
            >
              <Skeleton className={cn('h-4', r % 3 === 0 ? 'w-3/4' : 'w-1/2')} />
            </td>
          ))}
        </tr>
      ));
    }

    if (!data || data.length === 0) {
      return (
        <tr>
          <td colSpan={columns.length} className="p-0">
            {empty ?? (
              <EmptyState title="Nothing to show" description="No records matched." variant="inline" />
            )}
          </td>
        </tr>
      );
    }

    return data.map((row, index) => {
      const id = getRowId(row, index);
      const href = rowHref?.(row);

      return (
        <tr
          key={id}
          className={cn(
            'border-b border-border transition-colors last:border-0',
            interactive &&
              'cursor-pointer hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
          )}
          {...(interactive
            ? {
                tabIndex: 0,
                role: 'link',
                'aria-label': href ? `Open ${id}` : undefined,
                onClick: (e: React.MouseEvent) => {
                  // Let buttons, links, and menus inside the row win.
                  if ((e.target as HTMLElement).closest('a,button,[role="menuitem"],input,select'))
                    return;
                  activate(row, e);
                },
                onKeyDown: (e: React.KeyboardEvent) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return;
                  if ((e.target as HTMLElement) !== e.currentTarget) return;
                  e.preventDefault();
                  activate(row, e);
                },
              }
            : {})}
        >
          {columns.map((column) => {
            const Cell = column.isRowHeader ? 'th' : 'td';
            return (
              <Cell
                key={column.id}
                {...(column.isRowHeader ? { scope: 'row' as const } : {})}
                className={cn(
                  'px-4 py-3 align-middle text-sm font-normal',
                  column.numeric && 'tabular text-right',
                  column.isRowHeader && 'text-left',
                  column.hideBelow && HIDE_BELOW[column.hideBelow],
                  column.className,
                )}
              >
                {column.cell(row, index)}
              </Cell>
            );
          })}
        </tr>
      );
    });
  };

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-border bg-card shadow-card',
        className,
      )}
    >
      {toolbar && (
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          {toolbar}
        </div>
      )}

      <div
        className={cn('w-full overflow-x-auto', maxHeight && 'overflow-y-auto')}
        style={maxHeight ? { maxHeight } : undefined}
      >
        <table className="w-full border-collapse text-left">
          {caption && <caption className="sr-only">{caption}</caption>}

          <thead className={cn(stickyHeader && 'sticky top-0 z-10')}>
            <tr className="border-b border-border bg-muted/40">
              {columns.map((column) => {
                const key = column.sortKey ?? column.id;
                const active = sort?.key === key;
                const ariaSort: React.AriaAttributes['aria-sort'] = column.sortable
                  ? active
                    ? sort!.direction === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : 'none'
                  : undefined;

                return (
                  <th
                    key={column.id}
                    scope="col"
                    aria-sort={ariaSort}
                    className={cn(
                      'px-4 py-2.5 text-xs font-semibold whitespace-nowrap text-muted-foreground',
                      column.numeric && 'text-right',
                      column.width,
                      column.hideBelow && HIDE_BELOW[column.hideBelow],
                      column.headerClassName,
                    )}
                  >
                    {column.sortable && onSortChange ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(column)}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-sm hover:text-foreground',
                          column.numeric && 'flex-row-reverse',
                          active && 'text-foreground',
                        )}
                      >
                        {column.header}
                        {active ? (
                          sort!.direction === 'asc' ? (
                            <ArrowUp className="size-3" />
                          ) : (
                            <ArrowDown className="size-3" />
                          )
                        ) : (
                          <ChevronsUpDown className="size-3 opacity-40" />
                        )}
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody
            className={cn(
              'transition-opacity',
              // Refetching an already-populated table: dim instead of blanking.
              isLoading && data?.length ? 'opacity-50' : 'opacity-100',
            )}
          >
            {body()}
          </tbody>
        </table>
      </div>

      {pagination && !error && (
        <DataTablePagination {...pagination} isLoading={isLoading} />
      )}
    </div>
  );
}
