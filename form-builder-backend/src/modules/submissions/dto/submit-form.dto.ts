import { IsObject, IsInt, IsOptional, Min, Max, IsString, MaxLength, IsUUID } from 'class-validator';

export class SubmitFormDto {
  /**
   * Map of questionId -> answer. Shape is validated against the form version's
   * question schema by AnswerValidatorService; class-validator can only assert
   * that this is an object.
   */
  @IsObject()
  answers: Record<string, any>;

  /**
   * The exact FormVersion this submission was filled against.
   *
   * Required so answers bind to the structure the respondent actually saw. The
   * worker previously used "newest version", so publishing v2 while someone had
   * v1 open silently attributed their answers to v2's schema.
   */
  @IsOptional()
  @IsUUID()
  formVersionId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(86_400_000) // 24h ceiling — beyond this the value is junk or spoofed
  completionTimeMs?: number;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  captchaToken?: string;

  /** Bot trap. Must remain empty; any content marks the submission as spam. */
  @IsOptional()
  @IsString()
  @MaxLength(256)
  honeypot?: string;

  /** Required only when the form has isPasswordProtected = true. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  formPassword?: string;

  /** Stable per-browser id used for duplicate detection when allowMultiple = false. */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  fingerprint?: string;

  /**
   * The record this entry belongs to, for forms bound to a subject type.
   *
   * Accepted from the client but never trusted: SubmissionsService verifies the
   * subject exists, is not deleted, belongs to the form's organization AND to
   * the form's subject type before anything is written. Without that check a
   * caller could attach an entry to another tenant's record.
   */
  @IsOptional()
  @IsUUID()
  subjectId?: string;
}
