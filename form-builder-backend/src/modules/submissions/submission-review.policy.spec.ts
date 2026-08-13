import { BadRequestException } from '@nestjs/common';
import { SubmissionStatus } from '@prisma/client';
import {
  MAX_BULK_SUBMISSION_IDS,
  assertAllBulkIdsAuthorized,
  assertStatusTransition,
  isStatusTransitionAllowed,
  normaliseBulkIds,
  partitionBulkIds,
} from './submission-review.policy';

/**
 * The two rules that carry real consequences if they drift:
 *
 *   • the status transition table — the only thing stopping PATCH from writing
 *     a DELETED status with no `deletedAt`/`deletedById` beside it, which
 *     produces a row invisible to every list and unaccountable in every audit;
 *   • the bulk org-scoping guard — the only thing standing between a caller's
 *     arbitrary list of uuids and an `updateMany`.
 *
 * Both are pure, so both are tested here rather than behind a Prisma stub.
 */
describe('submission review policy', () => {
  describe('status transitions', () => {
    const reviewable = [
      SubmissionStatus.SUBMITTED,
      SubmissionStatus.FLAGGED_SPAM,
      SubmissionStatus.REJECTED,
    ];

    it('allows every move between the three reviewable statuses', () => {
      // Moderation is a judgement that gets revisited — a response marked spam
      // turning out to be genuine has to have a way back.
      for (const from of reviewable) {
        for (const to of reviewable) {
          expect(isStatusTransitionAllowed(from, to)).toBe(true);
        }
      }
    });

    it('treats a no-op as allowed', () => {
      // Bulk callers routinely include rows already in the target state: the
      // operator selected a whole page and pressed "mark as spam". Rejecting
      // the batch for that would protect nothing.
      expect(
        isStatusTransitionAllowed(
          SubmissionStatus.FLAGGED_SPAM,
          SubmissionStatus.FLAGGED_SPAM,
        ),
      ).toBe(true);
    });

    it('refuses to set DELETED — that is what the delete route is for', () => {
      for (const from of reviewable) {
        expect(isStatusTransitionAllowed(from, SubmissionStatus.DELETED)).toBe(
          false,
        );
      }

      expect(() =>
        assertStatusTransition(
          SubmissionStatus.SUBMITTED,
          SubmissionStatus.DELETED,
        ),
      ).toThrow(BadRequestException);
      // The message has to point at the right route, or the caller retries the
      // same request forever.
      expect(() =>
        assertStatusTransition(
          SubmissionStatus.SUBMITTED,
          SubmissionStatus.DELETED,
        ),
      ).toThrow(/delete endpoint/i);
    });

    it('refuses to move a DELETED submission out of that state', () => {
      for (const to of reviewable) {
        expect(isStatusTransitionAllowed(SubmissionStatus.DELETED, to)).toBe(
          false,
        );
      }

      expect(() =>
        assertStatusTransition(
          SubmissionStatus.DELETED,
          SubmissionStatus.SUBMITTED,
        ),
      ).toThrow(/deleted/i);
    });

    it('does not throw for a permitted move', () => {
      expect(() =>
        assertStatusTransition(
          SubmissionStatus.SUBMITTED,
          SubmissionStatus.REJECTED,
        ),
      ).not.toThrow();
    });
  });

  describe('bulk batch normalisation', () => {
    it('rejects an empty batch', () => {
      expect(() => normaliseBulkIds([])).toThrow(BadRequestException);
    });

    it('deduplicates before applying the cap', () => {
      // Otherwise a caller repeating one id 300 times is told they exceeded a
      // limit they did not meaningfully exceed — and, worse, the later
      // "were all ids found?" comparison would see 299 phantom misses.
      const repeated = Array.from({ length: 300 }, () => 'a');
      expect(normaliseBulkIds(repeated)).toEqual(['a']);
    });

    it('preserves the caller order of the distinct ids', () => {
      expect(normaliseBulkIds(['c', 'a', 'c', 'b'])).toEqual(['c', 'a', 'b']);
    });

    it('caps the batch and names the cap in the message', () => {
      const tooMany = Array.from(
        { length: MAX_BULK_SUBMISSION_IDS + 1 },
        (_, i) => `id-${i}`,
      );

      expect(() => normaliseBulkIds(tooMany)).toThrow(BadRequestException);
      // The number has to be in the error: an operator who selected 500 rows
      // needs to know what size batch will actually work.
      expect(() => normaliseBulkIds(tooMany)).toThrow(
        new RegExp(String(MAX_BULK_SUBMISSION_IDS)),
      );
    });

    it('accepts a batch exactly at the cap', () => {
      const exactly = Array.from(
        { length: MAX_BULK_SUBMISSION_IDS },
        (_, i) => `id-${i}`,
      );
      expect(normaliseBulkIds(exactly)).toHaveLength(MAX_BULK_SUBMISSION_IDS);
    });

    it('leaves room for a full page of the largest permitted page size', () => {
      // MAX_PAGE_SIZE is 100, so "select every row on this page and act" must
      // always fit in one call.
      expect(MAX_BULK_SUBMISSION_IDS).toBeGreaterThanOrEqual(100);
    });
  });

  describe('bulk org-scoping guard', () => {
    it('treats anything the org-scoped query did not return as unauthorised', () => {
      // `found` is what a single `findMany({ where: { id: { in: ids },
      // form: { organizationId }, deletedAt: null } })` handed back. Whether an
      // absent id belongs to another tenant, does not exist, or is already
      // deleted is deliberately indistinguishable.
      const requested = ['mine-1', 'other-tenants', 'mine-2', 'nonexistent'];
      const found = ['mine-1', 'mine-2'];

      expect(partitionBulkIds(requested, found)).toEqual({
        authorized: ['mine-1', 'mine-2'],
        unauthorized: ['other-tenants', 'nonexistent'],
      });
    });

    it('authorises the whole batch when every id came back', () => {
      const requested = ['a', 'b', 'c'];
      expect(assertAllBulkIdsAuthorized(requested, ['c', 'b', 'a'])).toEqual([
        'a',
        'b',
        'c',
      ]);
    });

    it('fails the entire batch when a single id is foreign', () => {
      // All-or-nothing on purpose. Acting on 2 of 3 and returning a count leaves
      // the operator believing all 3 were handled, and the skipped one is
      // exactly the interesting one.
      expect(() =>
        assertAllBulkIdsAuthorized(['a', 'b', 'foreign'], ['a', 'b']),
      ).toThrow(BadRequestException);
    });

    it('never echoes the rejected ids back to the caller', () => {
      // Naming them would let a caller enumerate what does and does not exist
      // in other organizations, one bulk call at a time.
      let message = '';
      try {
        assertAllBulkIdsAuthorized(['a', 'secret-id-from-another-org'], ['a']);
      } catch (err) {
        message = (err as BadRequestException).message;
      }

      expect(message).not.toContain('secret-id-from-another-org');
      expect(message).toContain('1 of 2');
      expect(message).toMatch(/no changes were made/i);
    });

    it('rejects everything when the query returned nothing at all', () => {
      // The shape of a caller probing ids that belong entirely to another org.
      expect(() => assertAllBulkIdsAuthorized(['x', 'y'], [])).toThrow(
        BadRequestException,
      );
      expect(partitionBulkIds(['x', 'y'], []).authorized).toEqual([]);
    });

    it('ignores ids the query returned that were never requested', () => {
      // Defensive: a widened WHERE that pulled in extra rows must not smuggle
      // them into the authorised set that the write is scoped to.
      expect(partitionBulkIds(['a'], ['a', 'b', 'c']).authorized).toEqual([
        'a',
      ]);
    });
  });
});
