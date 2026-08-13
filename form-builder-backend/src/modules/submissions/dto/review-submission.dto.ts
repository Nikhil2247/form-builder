import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { SubmissionStatus } from '@prisma/client';
import { REVIEWABLE_STATUSES } from '../submission-review.policy';

/**
 * PATCH /organizations/:orgId/submissions/:id
 *
 * Both fields are optional but at least one must be present — enforced in the
 * service rather than here, because class-validator can express "this field is
 * required" but not "one of these two is", and a hand-rolled @ValidatorConstraint
 * for it would be more machinery than the one-line check it replaces.
 */
export class ReviewSubmissionDto {
  /**
   * The reviewer's internal note. `null` clears it.
   *
   * Explicitly nullable rather than "omit to clear", because omission already
   * means "leave unchanged" — a reviewer editing only the status must not wipe
   * a note somebody else wrote.
   */
  @IsOptional()
  @IsString()
  @MaxLength(5000, { message: 'A review note cannot exceed 5000 characters.' })
  // Empty-after-trim is the same intent as clearing, and storing '' would make
  // "has a note" checks in the UI true for a note with no content.
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value.trim() === ''
        ? null
        : value.trim()
      : value,
  )
  reviewNote?: string | null;

  /**
   * Only the reviewable statuses are accepted at the DTO boundary, so a request
   * carrying `DELETED` is rejected as a 400 by validation before it can reach
   * the transition check. The transition check still runs — this enum only
   * constrains the TARGET, and whether the move is legal depends on where the
   * submission is coming FROM.
   */
  @IsOptional()
  @IsIn([...REVIEWABLE_STATUSES], {
    message: `status must be one of: ${REVIEWABLE_STATUSES.join(', ')}`,
  })
  status?: Extract<SubmissionStatus, 'SUBMITTED' | 'FLAGGED_SPAM' | 'REJECTED'>;
}
