import {
  IsInt,
  IsMimeType,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class PresignedUrlDto {
  @IsUUID()
  formId: string;

  @IsString()
  @MaxLength(100)
  questionId: string;

  @IsString()
  @MaxLength(255)
  filename: string;

  @IsMimeType()
  mimeType: string;

  /**
   * Size in BYTES.
   *
   * Was previously `fileSizeMb` as a float, which made the 50MB comparison
   * fragile and let a caller declare 0.001 to bypass it. The real size is
   * re-checked against object storage by FileVerifierProcessor regardless.
   */
  @IsInt()
  @Min(1)
  @Max(500 * 1024 * 1024)
  fileSizeBytes: number;
}
