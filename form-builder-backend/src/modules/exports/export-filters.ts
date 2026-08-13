import { BadRequestException } from '@nestjs/common';

/**
 * Filter freezing for asynchronous exports.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHY FREEZE AT ALL:
 *  An export job outlives the request that created it by minutes, and the file
 *  it produces outlives that by days. In between, the form can be edited,
 *  archived, or deleted, and submissions can be soft-deleted. If the dashboard
 *  re-derived "what does this file contain?" from the form's *current* state,
 *  every completed export would silently start describing itself wrongly the
 *  moment anything changed underneath it — and a CSV that misstates its own
 *  date range is the kind of error that reaches a report before anyone notices.
 *
 *  So the request's filters are normalised once, at creation, and written to
 *  `ExportJob.filters` as the record of what was asked for. Nothing reads them
 *  back to recompute; they are read back only to *explain*.
 *
 * WHY NORMALISED RATHER THAN STORED VERBATIM:
 *  Two requests that mean the same thing must freeze to the same JSON, or the
 *  frozen value stops being comparable — `{status: ['SUBMITTED','REJECTED']}`
 *  and `{status: ['REJECTED','SUBMITTED',' SUBMITTED ']}` describe one filter
 *  and must serialise identically. Key order is fixed for the same reason: a
 *  JSONB column preserves insertion order in its text representation, and a
 *  diff of two audit entries should not light up because the client happened to
 *  send `to` before `from`.
 */

/** Submission states a caller may narrow to. */
export const EXPORTABLE_SUBMISSION_STATUSES = [
  'SUBMITTED',
  'FLAGGED_SPAM',
  'REJECTED',
] as const;
export type ExportableSubmissionStatus =
  (typeof EXPORTABLE_SUBMISSION_STATUSES)[number];

/** The shape written to `ExportJob.filters`. Every key optional; absent means "no narrowing". */
export interface FrozenExportFilters {
  /** Inclusive lower bound on `submittedAt`, ISO-8601 UTC. */
  from?: string;
  /** Exclusive upper bound on `submittedAt`, ISO-8601 UTC. */
  to?: string;
  /** Submission statuses to include. Absent means every non-deleted status. */
  statuses?: ExportableSubmissionStatus[];
  /** Free-text match, applied by the row source. */
  search?: string;
  /**
   * Forms in scope, resolved at creation time for an org-wide export.
   *
   * Resolved eagerly and frozen rather than re-listed by the worker: a form
   * created between "user pressed export" and "worker picked the job up" would
   * otherwise appear in a file the user never asked for, and a form deleted in
   * that window would make the two runs of the same job disagree.
   */
  formIds?: string[];
}

/** Raw, unvalidated filter input as it arrives on the request body. */
export interface ExportFilterInput {
  from?: string;
  to?: string;
  statuses?: string[];
  search?: string;
}

/**
 * Longest free-text search we will freeze. A search term is stored, echoed back
 * to the dashboard, and (once the row source supports it) turned into a LIKE
 * pattern; none of those want an unbounded string.
 */
const MAX_SEARCH_LENGTH = 200;

/**
 * Normalise and validate raw filter input into the frozen representation.
 *
 * Throws rather than silently dropping anything it does not understand: a
 * filter that is quietly ignored produces a file with more rows than the user
 * asked for, labelled with the filter that was ignored. Failing the request is
 * the only outcome that cannot mislead.
 */
export function freezeExportFilters(
  input: ExportFilterInput | undefined,
  formIds?: string[],
): FrozenExportFilters {
  const frozen: FrozenExportFilters = {};

  const from = parseBoundary(input?.from, 'from');
  const to = parseBoundary(input?.to, 'to');

  // An inverted range is always a mistake — most often a date picker wired
  // backwards — and it exports nothing at all. Rejecting it costs the user one
  // round trip; accepting it costs them a successful-looking empty CSV.
  if (from && to && from.getTime() >= to.getTime()) {
    throw new BadRequestException(
      'The export "from" date must be earlier than the "to" date.',
    );
  }

  if (from) frozen.from = from.toISOString();
  if (to) frozen.to = to.toISOString();

  if (input?.statuses?.length) {
    const seen = new Set<string>();
    for (const raw of input.statuses) {
      const value = String(raw ?? '')
        .trim()
        .toUpperCase();
      if (
        !(EXPORTABLE_SUBMISSION_STATUSES as readonly string[]).includes(value)
      ) {
        throw new BadRequestException(
          `"${raw}" is not an exportable submission status. Allowed: ${EXPORTABLE_SUBMISSION_STATUSES.join(', ')}.`,
        );
      }
      seen.add(value);
    }
    // Sorted, so two requests naming the same statuses in a different order
    // freeze to byte-identical JSON.
    frozen.statuses = [...seen].sort() as ExportableSubmissionStatus[];
  }

  const search = typeof input?.search === 'string' ? input.search.trim() : '';
  if (search) {
    if (search.length > MAX_SEARCH_LENGTH) {
      throw new BadRequestException(
        `Search text cannot exceed ${MAX_SEARCH_LENGTH} characters.`,
      );
    }
    frozen.search = search;
  }

  if (formIds?.length) {
    // Deduplicated and sorted for the same determinism reason as statuses.
    frozen.formIds = [...new Set(formIds)].sort();
  }

  return frozen;
}

function parseBoundary(
  raw: string | undefined,
  field: 'from' | 'to',
): Date | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(
      `The export "${field}" date is not a valid date.`,
    );
  }
  return parsed;
}

/**
 * True when the filters narrow which *rows* are exported, as opposed to which
 * *forms* are in scope.
 *
 * The distinction is load-bearing. Form scoping is something this module can
 * honour on its own — it simply runs the row source once per form in the frozen
 * list. Row narrowing has to happen inside the query that reads submissions,
 * which lives in FormsService and which this module deliberately does not own
 * a copy of (see the note on `rowSourceSupportsFilters`).
 */
export function hasRowFilters(filters: FrozenExportFilters): boolean {
  return Boolean(
    filters.from || filters.to || filters.statuses?.length || filters.search,
  );
}

/**
 * Whether the row source can actually apply row-level filters.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The rows for an export come from `FormsService.exportSubmissions`, which is
 * reused rather than reimplemented. That is not a style preference: that query
 * is where soft-deleted submissions get excluded, and a second copy of it here
 * would keep exporting deleted responses the day the exclusion changed —
 * silently, into a file, for as long as nobody diffed the two.
 *
 * The consequence is that this module cannot apply `from`/`to`/`statuses`/
 * `search` itself. It can only *pass them down*, and only if the row source has
 * a parameter to receive them.
 *
 * So we probe, and we FAIL CLOSED. If the row source does not accept filters,
 * a request carrying them is rejected outright. The alternative — accept the
 * request, freeze the filters, and export every row anyway — produces a file
 * that states a date range it does not honour. There is no worse outcome
 * available here, which is exactly the asymmetry that makes "reject" correct
 * even though it is the less convenient behaviour.
 *
 * `Function.length` counts parameters up to the first one with a default value,
 * so a row source that declares `filters?: FrozenExportFilters` reports 4 and a
 * row source that declares `filters: FrozenExportFilters = {}` reports 3. The
 * second case probes as unsupported and rejects, which is the safe direction to
 * be wrong in.
 */
export function rowSourceSupportsFilters(
  rowSource: (...args: any[]) => unknown,
): boolean {
  return rowSource.length >= 4;
}

/**
 * One-line human description of what a finished export contains.
 *
 * Rendered in the dashboard next to the download button. Built from the frozen
 * filters, never from the form's current state — that is the entire point of
 * freezing them.
 */
export function describeExportFilters(filters: FrozenExportFilters): string {
  const parts: string[] = [];

  if (filters.from && filters.to) {
    parts.push(`submitted ${isoDay(filters.from)} to ${isoDay(filters.to)}`);
  } else if (filters.from) {
    parts.push(`submitted on or after ${isoDay(filters.from)}`);
  } else if (filters.to) {
    parts.push(`submitted before ${isoDay(filters.to)}`);
  }

  if (filters.statuses?.length) {
    parts.push(`status ${filters.statuses.join(' or ')}`);
  }
  if (filters.search) {
    parts.push(`matching "${filters.search}"`);
  }
  if (filters.formIds?.length) {
    parts.push(
      `${filters.formIds.length} form${filters.formIds.length === 1 ? '' : 's'}`,
    );
  }

  return parts.length ? parts.join(', ') : 'all responses';
}

function isoDay(iso: string): string {
  return iso.slice(0, 10);
}
