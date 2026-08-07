'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * Pagination, filter, and sort state kept in the URL.
 *
 * Previously each list page held `page` in `useState`. That made the state
 * invisible: going to page 7, opening a record, and pressing Back returned the
 * user to page 1; the view could not be linked to or bookmarked; and a refresh
 * silently reset it. Query params fix all three and cost nothing — Next's
 * client router does not re-request the server component for a search-param
 * change on a client page.
 *
 * Any filter change resets to page 1, which is the bug most hand-rolled
 * versions had: filtering while on page 5 of an unfiltered list produced an
 * empty table and looked like data loss.
 */

export interface PaginationState {
  page: number;
  pageSize: number;
  search: string;
  sort: string | null;
  direction: 'asc' | 'desc';
  /** Arbitrary extra filters, e.g. `status`. */
  filters: Record<string, string>;
}

export interface UsePaginationOptions {
  defaultPageSize?: number;
  defaultSort?: string;
  defaultDirection?: 'asc' | 'desc';
  /** Query-param names this hook should track as filters. */
  filterKeys?: string[];
  /** Namespace the params so two tables on one page do not collide. */
  prefix?: string;
}

/**
 * Platform-wide page size, matching the API's DEFAULT_PAGE_SIZE. Keep the two
 * in step: if the client asks for 20 and the server caps at 12, the pager
 * computes its page count from the wrong divisor and the last pages are
 * unreachable.
 */
export const DEFAULT_PAGE_SIZE = 12;

export function usePagination(options: UsePaginationOptions = {}) {
  const {
    defaultPageSize = DEFAULT_PAGE_SIZE,
    defaultSort = null,
    defaultDirection = 'desc',
    filterKeys = [],
    prefix = '',
  } = options as UsePaginationOptions & { defaultSort?: string | null };

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const key = useCallback((name: string) => (prefix ? `${prefix}_${name}` : name), [prefix]);

  const state = useMemo<PaginationState>(() => {
    const rawPage = Number(searchParams.get(key('page')));
    const rawSize = Number(searchParams.get(key('size')));

    const filters: Record<string, string> = {};
    for (const f of filterKeys) {
      const value = searchParams.get(key(f));
      if (value) filters[f] = value;
    }

    return {
      // Guard against `?page=0`, `?page=-3`, and `?page=abc`, each of which
      // produced either an empty table or a 500 from the API.
      page: Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1,
      pageSize:
        Number.isFinite(rawSize) && rawSize >= 1 && rawSize <= 100
          ? Math.floor(rawSize)
          : defaultPageSize,
      search: searchParams.get(key('q')) ?? '',
      sort: searchParams.get(key('sort')) ?? defaultSort,
      direction: (searchParams.get(key('dir')) as 'asc' | 'desc') ?? defaultDirection,
      filters,
    };
  }, [searchParams, key, filterKeys, defaultPageSize, defaultSort, defaultDirection]);

  const apply = useCallback(
    (updates: Record<string, string | number | null | undefined>, resetPage = true) => {
      const params = new URLSearchParams(searchParams.toString());

      if (resetPage && !('page' in updates)) params.delete(key('page'));

      for (const [name, value] of Object.entries(updates)) {
        const param = key(name);
        if (value === null || value === undefined || value === '' || value === 'ALL') {
          params.delete(param);
        } else {
          params.set(param, String(value));
        }
      }

      const query = params.toString();
      // `replace` rather than `push`: paging through a table should not bury the
      // page the user arrived from under twenty history entries.
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams, key],
  );

  return {
    ...state,
    /** Page change keeps every other param intact. */
    setPage: useCallback((page: number) => apply({ page }, false), [apply]),
    setPageSize: useCallback((size: number) => apply({ size }), [apply]),
    setSearch: useCallback((q: string) => apply({ q }), [apply]),
    setSort: useCallback(
      (sort: { key: string; direction: 'asc' | 'desc' }) =>
        apply({ sort: sort.key, dir: sort.direction }),
      [apply],
    ),
    setFilter: useCallback(
      (name: string, value: string | null) => apply({ [name]: value }),
      [apply],
    ),
    reset: useCallback(() => router.replace(pathname, { scroll: false }), [router, pathname]),
    /** Ready-to-spread props for <DataTable pagination={...}>. */
    paginationProps: (total: number, itemLabel?: string) => ({
      page: state.page,
      pageSize: state.pageSize,
      total,
      itemLabel,
      onPageChange: (page: number) => apply({ page }, false),
      onPageSizeChange: (size: number) => apply({ size }),
    }),
  };
}

/**
 * Debounces a rapidly-changing value (a search box) so each keystroke does not
 * become a query. 300ms is below the threshold where typing feels laggy and
 * above the average inter-key interval.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
