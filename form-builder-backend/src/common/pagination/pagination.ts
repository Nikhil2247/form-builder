/**
 * One pagination contract for every list endpoint.
 *
 * Before this, each controller parsed `page`/`limit` itself with
 * `parseInt(x ?? '1', 10)` and picked its own default — 20 in forms, 50 in
 * submissions and audit logs, 20 in members. Three consequences:
 *
 *   • `parseInt('abc')` is NaN, which Prisma turns into a query with
 *     `take: NaN` — the whole table.
 *   • `?limit=100000` was honoured everywhere, so any authenticated caller
 *     could pull an organization's entire submission history in one request.
 *   • The frontend could not assume a page size, so every table hardcoded its
 *     own and the two drifted.
 *
 * Everything now goes through `parsePagination`, which clamps into range and
 * always returns usable numbers.
 */

export const DEFAULT_PAGE = 1;

/**
 * Rows per page, platform-wide. Small on purpose: a page of 12 keeps the
 * payload, the JSON parse, and the React render cheap, and the tables are
 * built to fetch the next page instantly rather than to show everything at
 * once.
 */
export const DEFAULT_PAGE_SIZE = 12;

/** Hard ceiling. A caller asking for more gets this, not an error. */
export const MAX_PAGE_SIZE = 100;

export interface PaginationInput {
  page?: number | string | null;
  limit?: number | string | null;
}

export interface Pagination {
  page: number;
  limit: number;
  /** Ready to spread into a Prisma `findMany`. */
  skip: number;
  take: number;
}

function toInt(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.floor(parsed) : null;
}

/** Clamp caller-supplied paging into something safe to hand to the database. */
export function parsePagination(input: PaginationInput = {}): Pagination {
  const rawPage = toInt(input.page);
  const rawLimit = toInt(input.limit);

  const page = rawPage !== null && rawPage >= 1 ? rawPage : DEFAULT_PAGE;
  const limit =
    rawLimit !== null && rawLimit >= 1 ? Math.min(rawLimit, MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;

  return { page, limit, skip: (page - 1) * limit, take: limit };
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export function pageMeta(pagination: Pagination, total: number): PageMeta {
  const totalPages = total === 0 ? 0 : Math.ceil(total / pagination.limit);
  return {
    page: pagination.page,
    limit: pagination.limit,
    total,
    totalPages,
    // Explicit flags so the client never has to recompute the boundary
    // condition — and never gets it wrong for the empty case.
    hasNextPage: pagination.page < totalPages,
    hasPreviousPage: pagination.page > 1,
  };
}

/** Standard envelope: `{ <key>: rows, pagination }`. */
export function paginated<K extends string, T>(
  key: K,
  rows: T[],
  pagination: Pagination,
  total: number,
): { [P in K]: T[] } & { pagination: PageMeta } {
  return { [key]: rows, pagination: pageMeta(pagination, total) } as any;
}
