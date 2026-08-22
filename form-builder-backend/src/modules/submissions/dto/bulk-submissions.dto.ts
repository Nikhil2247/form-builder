import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { SubmissionStatus } from '@prisma/client';
import {
  MAX_BULK_SUBMISSION_IDS,
  REVIEWABLE_STATUSES,
} from '../logic/submission-review.policy';

/** The two things a bulk call can do. */
export type BulkSubmissionAction = 'SET_STATUS' | 'DELETE';

/**
 * POST /organizations/:orgId/submissions/bulk
 *
 * One endpoint for both bulk operations rather than two, because the expensive
 * and dangerous part — resolving an arbitrary list of ids to rows this
 * organization actually owns — is identical for both and must not be written
 * twice.
 */
export class BulkSubmissionsDto {
  /**
   * `@ArrayMaxSize` here duplicates the cap that `normaliseBulkIds` enforces in
   * the service, and both are wanted. This one rejects an oversized payload
   * before any handler code runs (so a 100k-element array is never iterated);
   * the service-side one is what the unit tests exercise and what protects the
   * service if it is ever called from somewhere other than this controller —
   * the form-app paths already call into SubmissionsService directly.
   */
  @IsArray()
  @ArrayNotEmpty({ message: 'At least one submission id is required.' })
  @ArrayMaxSize(MAX_BULK_SUBMISSION_IDS, {
    message: `A bulk action can affect at most ${MAX_BULK_SUBMISSION_IDS} submissions at a time.`,
  })
  @IsUUID('4', { each: true, message: 'Every submission id must be a UUID.' })
  ids: string[];

  @IsIn(['SET_STATUS', 'DELETE'], {
    message: 'action must be either SET_STATUS or DELETE.',
  })
  action: BulkSubmissionAction;

  /**
   * Required when `action` is SET_STATUS, ignored otherwise. The conditional
   * requirement is checked in the service, next to the transition rules it
   * belongs with.
   *
   * DELETED is not accepted here for the same reason it is not accepted on
   * PATCH: it would write a status with no `deletedAt`/`deletedById` beside it.
   * `action: 'DELETE'` is the supported way to remove rows.
   */
  @IsOptional()
  @IsIn([...REVIEWABLE_STATUSES], {
    message: `status must be one of: ${REVIEWABLE_STATUSES.join(', ')}`,
  })
  status?: Extract<SubmissionStatus, 'SUBMITTED' | 'FLAGGED_SPAM' | 'REJECTED'>;
}
