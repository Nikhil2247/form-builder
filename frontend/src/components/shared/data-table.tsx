'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
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

/**
 * Row selection, opt-in.
 *
 * Added here rather than as a bespoke table on the one page that needs it,
 * because a checkbox column is not just a column: it has to participate in the
 * header row, the skeleton rows, the `colSpan` of the empty/error rows, and the
 * "let controls inside a row win over the row's own click handler" guard. A
 * second table would have had to reproduce all of that, and would have started
 * drifting from this one on the first accessibility fix that landed in only one
 * of them.
 *
 * Selection state is owned by the caller. The table never holds it, because the
 * bulk-action toolbar, the page's mutation callbacks, and the URL all need to
 * read and clear it — a table-internal `useState` would have to be lifted on the
 * first of those.
 */
export interface DataTableSelection<T> {
  /** Currently selected row ids, as returned by `getRowId`. */
  selectedIds: readonly string[];
  onChange: (ids: string[]) => void;
  /** Rows that cannot be selected — their checkbox renders disabled. */
  isSelectable?: (row: T) => boolean;
  /** Accessible name for the header's select-all control. */
  selectAllLabel?: string;
  /** Accessible name for a row's checkbox. Defaults to "Select row". */
  rowLabel?: (row: T) => string;
}

/**
 * Virtualization, opt-in.
 *
 * Deliberately NOT the default. Most consumers of this table render a server
 * page of 12 rows, where a virtualizer costs a ResizeObserver, a scroll
 * listener and two spacer rows to save nothing at all — and it constrains the
 * layout, since a virtualizer needs a scroll container with a fixed height and
 * a table whose column widths do not depend on which rows happen to be
 * rendered. Turning it on globally would have imposed that on every list page
 * in the product to fix one of them.
 *
 * Pass this only where the row count can genuinely get large. When you do,
 * give every column an explicit `width`: virtualized mode switches the table to
 * `table-layout: fixed` so that scrolling a new window of rows into view cannot
 * re-measure and shift the columns under the user's cursor.
 */
export interface DataTableVirtualization {
  /** Scroll viewport height. A virtualizer needs a bounded scroller. */
  height: number | string;
  /**
   * Estimated row height in px, used before a row has been measured. Rows are
   * measured for real once mounted, so this only needs to be close enough that
   * the scrollbar does not jump noticeably on first paint.
   */
  estimateRowHeight?: number;
  /** Rows rendered beyond each edge of the viewport. */
  overscan?: number;
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

  /** Adds a leading checkbox column. See DataTableSelection. */
  selection?: DataTableSelection<T>;
  /** Renders only the visible rows. See DataTableVirtualization. */
  virtual?: DataTableVirtualization;
}

/**
 * The virtualized window of `<tr>`s, plus the spacers that reserve the scroll
 * height above and below it.
 *
 * Two spacer rows rather than an absolutely-positioned, transformed container:
 * `<tbody>` may only contain rows, and wrapping the visible rows in a
 * positioned `<div>` collapses the table's row/column relationships. That is
 * how virtualized tables lose their screen-reader semantics and their column
 * alignment at the same time — the rows still look right and no longer *are*
 * rows. Spacers keep the markup a real table throughout.
 *
 * Separate from `DataTable` so that only this component is excluded from React
 * Compiler optimization; see the note at the virtualization block above.
 */
function VirtualRows({
  scrollRef,
  count,
  estimateRowHeight,
  overscan,
  renderRow,
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  count: number;
  estimateRowHeight: number;
  overscan: number;
  renderRow: (
    index: number,
    measureRef: (node: HTMLElement | null) => void,
  ) => React.ReactNode;
}) {
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateRowHeight,
    overscan,
  });

  const items = virtualizer.getVirtualItems();
  const padTop = items.length > 0 ? items[0].start : 0;
  const padBottom =
    items.length > 0 ? virtualizer.getTotalSize() - items[items.length - 1].end : 0;

  return (
    <>
      {padTop > 0 && (
        // aria-hidden on the spacers: they carry no cells and exist only to
        // reserve scroll height, so a screen reader must not count them as
        // rows. aria-rowindex on the real rows already communicates position.
        <tr aria-hidden="true" style={{ height: padTop }} />
      )}
      {items.map((item) => renderRow(item.index, virtualizer.measureElement))}
      {padBottom > 0 && <tr aria-hidden="true" style={{ height: padBottom }} />}
    </>
  );
}

const HIDE_BELOW: Record<NonNullable<DataTableColumn<any>['hideBelow']>, string> = {
  sm: 'hidden sm:table-cell',
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
  xl: 'hidden xl:table-cell',
};

/**
 * The mirror image of `HIDE_BELOW`: visible exactly while the real column
 * cell is hidden. Used to surface a dropped column's value as an inline chip
 * under the row header instead of just discarding it below the breakpoint.
 */
const SHOW_BELOW: Record<NonNullable<DataTableColumn<any>['hideBelow']>, string> = {
  sm: 'sm:hidden',
  md: 'md:hidden',
  lg: 'lg:hidden',
  xl: 'xl:hidden',
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
  selection,
  virtual,
}: DataTableProps<T>) {
  const router = useRouter();

  const interactive = !!rowHref || !!onRowClick;

  // ── Selection ────────────────────────────────────────────────────────────
  // The ids on THIS page, in order, so "select all" can only ever mean "select
  // all of what is loaded". With server-side pagination there is no honest way
  // to offer "select all 40,000" — the client does not have them, and a control
  // that silently means something narrower than it says is worse than one that
  // says exactly what it does.
  //
  // Plain derivations, not useMemo: `reactCompiler` is on in next.config.ts, so
  // the compiler decides what to cache and a hand-written useMemo here is dead
  // weight it has to work around.
  //
  // flatMap, not filter().map(): `getRowId` is handed the row's index, and
  // filtering first would renumber the rows so an index-derived id no longer
  // matched the one the row itself renders with.
  const selectableIds = selection
    ? (data ?? []).flatMap((row, index) =>
        (selection.isSelectable?.(row) ?? true) ? [getRowId(row, index)] : [],
      )
    : [];

  const selectedSet = new Set(selection?.selectedIds ?? []);

  const selectedOnPage = selectableIds.filter((id) => selectedSet.has(id));
  const allOnPageSelected =
    selectableIds.length > 0 && selectedOnPage.length === selectableIds.length;
  const someOnPageSelected = selectedOnPage.length > 0 && !allOnPageSelected;

  const toggleRow = (id: string, checked: boolean) => {
    if (!selection) return;
    const next = new Set(selectedSet);
    if (checked) next.add(id);
    else next.delete(id);
    selection.onChange([...next]);
  };

  const toggleAllOnPage = (checked: boolean) => {
    if (!selection) return;
    // Selections made on other pages are preserved rather than replaced: an
    // operator who selected rows on page 1, paged forward, and selected more
    // expects to have both sets, and losing the first silently would only be
    // discovered after the bulk action had already run on the wrong subset.
    const next = new Set(selectedSet);
    for (const id of selectableIds) {
      if (checked) next.add(id);
      else next.delete(id);
    }
    selection.onChange([...next]);
  };

  // ── Virtualization ───────────────────────────────────────────────────────
  // The virtualizer itself lives in `VirtualRows` below, NOT here. That is not
  // organisation for its own sake: `useVirtualizer` returns a mutable instance
  // the React Compiler cannot reason about, so calling it in this component
  // would opt the whole of `DataTable` out of compilation — and `DataTable` is
  // rendered by every list page in the product, almost none of which asked for
  // virtualization. Confining it to a child that only the virtual path mounts
  // means one small component bails out instead of twenty-two pages' tables.
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const rowCount = data?.length ?? 0;

  // A page change must return the viewport to the top. In a plain table the
  // page shrinks back to a screenful and there is nothing to reset; in a
  // virtualized one the scroller keeps its offset, so page 2 opens halfway down
  // a list the user has not seen the start of — and the rows above are page 2's
  // rows, not the ones they were looking at. Done on the DOM node rather than
  // through state, which is both what the scroller actually needs and what
  // keeps this out of a render cascade.
  const currentPage = pagination?.page;
  React.useEffect(() => {
    if (!virtual) return;
    scrollRef.current?.scrollTo({ top: 0 });
  }, [currentPage, virtual]);

  // Total column count including the selection checkbox, for colSpan.
  const columnCount = columns.length + (selection ? 1 : 0);

  // Columns dropped below some breakpoint would otherwise just vanish on a
  // phone — their value surfaces instead as a chip under the row header,
  // shown exactly while the real `<td>` is hidden (see `SHOW_BELOW`).
  const collapsedColumns = columns.filter((column) => column.hideBelow && !column.isRowHeader);

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

  /**
   * One data row. Extracted because it is now rendered from two places — the
   * plain `data.map` and the virtualized window — and a virtualized table whose
   * rows are built by a second, near-identical block is a table where a fix to
   * the click guard or the row header lands in only one of the two.
   *
   * `measureRef` is the virtualizer's measurement callback; it is undefined in
   * the non-virtual path.
   */
  const renderRow = (
    row: T,
    index: number,
    measureRef?: (node: HTMLElement | null) => void,
  ) => {
    const id = getRowId(row, index);
    const href = rowHref?.(row);
    const selectable = selection ? (selection.isSelectable?.(row) ?? true) : false;
    const selected = selection ? selectedSet.has(id) : false;

    return (
      <tr
        key={id}
        ref={measureRef as React.Ref<HTMLTableRowElement>}
        data-index={index}
        // The true position in the full data set. Without it a screen reader
        // reading a virtualized table announces "row 3 of 12" for whatever
        // happens to be mounted, which is both wrong and unstable as the user
        // scrolls. Set only in virtual mode — in a plain table the DOM already
        // says the truth and overriding it adds nothing.
        {...(virtual ? { 'aria-rowindex': index + 2 } : {})}
        {...(selection ? { 'aria-selected': selected } : {})}
        className={cn(
          'border-b border-border transition-colors last:border-0',
          selected && 'bg-primary/5',
          interactive &&
            'cursor-pointer hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        )}
        {...(interactive
          ? {
              tabIndex: 0,
              role: 'link',
              'aria-label': href ? `Open ${id}` : undefined,
              onClick: (e: React.MouseEvent) => {
                // Let buttons, links, menus, and the selection checkbox inside
                // the row win. `[role="checkbox"]` is in the list because the
                // Base UI checkbox renders a <button>, not an <input> — the
                // original selector would have caught an <input type=checkbox>
                // and missed this one, so ticking a row would also have opened
                // it.
                if (
                  (e.target as HTMLElement).closest(
                    'a,button,[role="menuitem"],[role="checkbox"],input,select,label',
                  )
                )
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
        {selection && (
          <td className="w-10 px-4 py-3 align-middle">
            <Checkbox
              checked={selected}
              disabled={!selectable}
              onCheckedChange={(checked) => toggleRow(id, checked === true)}
              aria-label={selection.rowLabel?.(row) ?? 'Select row'}
            />
          </td>
        )}
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
                // Fixed layout gives a cell no room to grow, so long content
                // has to be told what to do or it spills across its neighbour.
                virtual && 'truncate',
                column.hideBelow && HIDE_BELOW[column.hideBelow],
                column.className,
              )}
            >
              {column.cell(row, index)}
              {column.isRowHeader && collapsedColumns.length > 0 && (
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs font-normal text-muted-foreground">
                  {collapsedColumns.map((hidden) => (
                    <span
                      key={hidden.id}
                      className={cn('inline-flex items-center gap-1', SHOW_BELOW[hidden.hideBelow!])}
                    >
                      {typeof hidden.header === 'string' && (
                        <span className="text-foreground/70">{hidden.header}:</span>
                      )}
                      {hidden.cell(row, index)}
                    </span>
                  ))}
                </div>
              )}
            </Cell>
          );
        })}
      </tr>
    );
  };

  const body = () => {
    if (error) {
      return (
        <tr>
          <td colSpan={columnCount} className="p-0">
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
          {selection && (
            <td className="w-10 px-4 py-3">
              <Skeleton className="size-4 rounded-[4px]" />
            </td>
          )}
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
          <td colSpan={columnCount} className="p-0">
            {empty ?? (
              <EmptyState title="Nothing to show" description="No records matched." variant="inline" />
            )}
          </td>
        </tr>
      );
    }

    if (!virtual) {
      return data.map((row, index) => renderRow(row, index));
    }

    return (
      <VirtualRows
        scrollRef={scrollRef}
        count={rowCount}
        estimateRowHeight={virtual.estimateRowHeight ?? 45}
        overscan={virtual.overscan ?? 10}
        renderRow={(index, measureRef) => renderRow(data[index], index, measureRef)}
      />
    );
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
        ref={scrollRef}
        className={cn(
          'w-full overflow-x-auto',
          (maxHeight || virtual) && 'overflow-y-auto',
        )}
        style={
          virtual ? { height: virtual.height } : maxHeight ? { maxHeight } : undefined
        }
      >
        <table
          className={cn(
            'w-full border-collapse text-left',
            // Fixed layout in virtual mode so the columns are sized once, from
            // the header row, instead of being re-measured every time a
            // different window of rows is mounted — which would make the
            // columns twitch as the user scrolls. Header cells already carry
            // each column's `width`, so no <colgroup> is needed, and a column
            // hidden by `hideBelow` correctly takes part in neither.
            virtual && 'table-fixed',
          )}
          // The count the user is navigating, header row included. In virtual
          // mode the DOM holds a fraction of the rows, so without this a screen
          // reader reports the size of the window rather than of the table.
          {...(virtual ? { 'aria-rowcount': rowCount + 1 } : {})}
        >
          {caption && <caption className="sr-only">{caption}</caption>}

          <thead
            className={cn(
              // Virtualization requires the header to stay put: the body is the
              // thing scrolling, and a header that scrolls away leaves the user
              // looking at unlabelled columns for the other 9,980 rows.
              (stickyHeader || virtual) && 'sticky top-0 z-10 bg-card',
            )}
          >
            <tr
              className="border-b border-border bg-muted/40"
              {...(virtual ? { 'aria-rowindex': 1 } : {})}
            >
              {selection && (
                <th scope="col" className="w-10 px-4 py-2.5">
                  <Checkbox
                    checked={allOnPageSelected}
                    indeterminate={someOnPageSelected}
                    disabled={selectableIds.length === 0}
                    onCheckedChange={(checked) => toggleAllOnPage(checked === true)}
                    aria-label={selection.selectAllLabel ?? 'Select all rows on this page'}
                  />
                </th>
              )}
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
