import { BadRequestException } from '@nestjs/common';
import { SubmissionStatus } from '@prisma/client';

/**
 * The pure decision logic behind the submission review/moderation endpoints.
 *
 * Kept out of `SubmissionsService` on purpose. Everything in here is a rule the
 * product cares about — which status changes a reviewer may make, how many rows
 * a bulk call may touch, and which of the ids a caller supplied they are
 * actually allowed to touch — and every one of those is a rule that is worth
 * a test that does not need a database, a Nest module, or a Redis stub to run.
 * The service keeps the I/O; this file keeps the decisions.
 */

// ─────────────────────────────────────────────────────────────────────────────
// STATUS TRANSITIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The statuses a human reviewer is allowed to move a submission between.
 *
 * `DELETED` is deliberately absent from both sides of this map. Deletion is not
 * a status change — it also has to stamp `deletedAt`/`deletedById`, and the
 * schema comment on those columns is explicit that they exist because "status
 * alone cannot answer when or by whom". If PATCH could write `DELETED`, it
 * would produce rows that are invisible to every list (status is filtered) but
 * have no deletion timestamp and no deleter, which is precisely the shape of
 * record that makes a later dispute unanswerable. Deletion goes through the
 * DELETE route, which writes all three fields together.
 *
 * Conversely a DELETED row cannot be moved out of that state here either:
 * un-deleting is a restore, and a restore that left `deletedAt` populated would
 * be resurrected and then immediately re-hidden by the `deletedAt: null` filter
 * that every read path now carries.
 */
export const REVIEWABLE_STATUSES = [
  SubmissionStatus.SUBMITTED,
  SubmissionStatus.FLAGGED_SPAM,
  SubmissionStatus.REJECTED,
] as const;

export type ReviewableStatus = (typeof REVIEWABLE_STATUSES)[number];

/**
 * Written as an explicit adjacency map rather than "any member of the set to
 * any other", because the two happen to coincide today and will not stay that
 * way — the moment a status is added that is only reachable from one place, the
 * set formulation silently permits everything and this one does not.
 *
 * All three are mutually reachable because moderation is a judgement call that
 * gets revisited: a response marked spam turns out to be genuine, a rejected
 * response is re-accepted after the respondent clarifies. Making any of these
 * one-way would mean the only way back is a database edit.
 */
const ALLOWED_TRANSITIONS: Record<
  ReviewableStatus,
  readonly ReviewableStatus[]
> = {
  [SubmissionStatus.SUBMITTED]: [
    SubmissionStatus.FLAGGED_SPAM,
    SubmissionStatus.REJECTED,
  ],
  [SubmissionStatus.FLAGGED_SPAM]: [
    SubmissionStatus.SUBMITTED,
    SubmissionStatus.REJECTED,
  ],
  [SubmissionStatus.REJECTED]: [
    SubmissionStatus.SUBMITTED,
    SubmissionStatus.FLAGGED_SPAM,
  ],
};

export function isReviewableStatus(
  status: SubmissionStatus,
): status is ReviewableStatus {
  return (REVIEWABLE_STATUSES as readonly SubmissionStatus[]).includes(status);
}

/**
 * Is `from -> to` a transition a reviewer may perform?
 *
 * A no-op (`from === to`) counts as allowed. Bulk callers routinely include
 * rows that are already in the target state — the operator selected a page and
 * pressed "mark as spam" — and rejecting the whole batch for that would make
 * the feature unusable while protecting nothing.
 */
export function isStatusTransitionAllowed(
  from: SubmissionStatus,
  to: SubmissionStatus,
): boolean {
  if (!isReviewableStatus(from) || !isReviewableStatus(to)) return false;
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Throwing wrapper, so callers do not each invent their own error text. */
export function assertStatusTransition(
  from: SubmissionStatus,
  to: SubmissionStatus,
): void {
  if (isStatusTransitionAllowed(from, to)) return;

  if (from === SubmissionStatus.DELETED) {
    throw new BadRequestException(
      'This submission has been deleted and can no longer be reviewed.',
    );
  }
  if (to === SubmissionStatus.DELETED) {
    throw new BadRequestException(
      'Use the delete endpoint to remove a submission; DELETED cannot be set directly.',
    );
  }
  throw new BadRequestException(
    `Cannot change a submission from ${from} to ${to}.`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BULK BATCHES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maximum ids one bulk call may carry.
 *
 * The bound that matters is not the `UPDATE ... WHERE id IN (...)` — Postgres
 * handles far more than this — it is the tenancy pre-check, the audit metadata,
 * and the fact that an unbounded list lets one request hold a writer connection
 * for an arbitrary length of time. 200 is comfortably above the largest page
 * the UI can select (the API caps a page at MAX_PAGE_SIZE = 100), so
 * "select all on this page and act" always fits in a single call.
 */
export const MAX_BULK_SUBMISSION_IDS = 200;

/**
 * Deduplicate while preserving order, and enforce the cap.
 *
 * Deduplication happens BEFORE the cap check so that a caller who repeats the
 * same id 300 times is not told they exceeded a limit they did not meaningfully
 * exceed — and, more importantly, so the "were all ids found?" comparison later
 * is against a set of distinct ids. Comparing a 300-entry list containing 4
 * distinct ids against 4 found rows would look like 296 missing rows.
 */
export function normaliseBulkIds(ids: readonly string[]): string[] {
  const unique = [...new Set(ids)];

  if (unique.length === 0) {
    throw new BadRequestException('At least one submission id is required.');
  }
  if (unique.length > MAX_BULK_SUBMISSION_IDS) {
    throw new BadRequestException(
      `A bulk action can affect at most ${MAX_BULK_SUBMISSION_IDS} submissions at a time; ` +
        `${unique.length} were supplied. Split the selection into smaller batches.`,
    );
  }

  return unique;
}

/**
 * Compare the ids the caller asked for against the ids a single org-scoped
 * query actually returned.
 *
 * This is the tenancy guard for every bulk route, and the reason it is a pure
 * function over the result of ONE query rather than a loop of per-id checks:
 * a per-row check is a per-row opportunity to forget the `organizationId`
 * clause, and it only takes one forgotten clause on one branch for a bulk
 * endpoint to become a cross-tenant write primitive. Here there is exactly one
 * place the org filter can live, and anything the query did not hand back is
 * unauthorised by construction — "belongs to another org", "does not exist" and
 * "already soft-deleted" are all simply absent, and are treated identically so
 * the response cannot be used to probe for the existence of another tenant's
 * rows.
 */
export function partitionBulkIds(
  requestedIds: readonly string[],
  foundIds: readonly string[],
): { authorized: string[]; unauthorized: string[] } {
  const found = new Set(foundIds);
  const authorized: string[] = [];
  const unauthorized: string[] = [];

  for (const id of requestedIds) {
    (found.has(id) ? authorized : unauthorized).push(id);
  }

  return { authorized, unauthorized };
}

/**
 * All-or-nothing: if any requested id was not returned by the org-scoped query,
 * the whole batch fails.
 *
 * Partial application would be friendlier and is the wrong trade here. A bulk
 * action is an operator asserting "these 40 responses"; silently acting on 37
 * of them and returning a count leaves the operator believing all 40 were
 * handled, and the three that were skipped are exactly the interesting ones.
 * The count is reported, never the ids — echoing back which ids were rejected
 * would let a caller enumerate what does and does not exist elsewhere.
 */
export function assertAllBulkIdsAuthorized(
  requestedIds: readonly string[],
  foundIds: readonly string[],
): string[] {
  const { authorized, unauthorized } = partitionBulkIds(requestedIds, foundIds);

  if (unauthorized.length > 0) {
    throw new BadRequestException(
      `${unauthorized.length} of ${requestedIds.length} submissions could not be found in this organization. ` +
        'No changes were made.',
    );
  }

  return authorized;
}
