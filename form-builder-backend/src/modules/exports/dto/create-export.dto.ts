import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { EXPORTABLE_SUBMISSION_STATUSES } from '../logic/export-filters';

/**
 * Row-narrowing filters. Validated here for *shape*; normalised, range-checked
 * and frozen by `freezeExportFilters`, which is the single place that decides
 * what actually lands in `ExportJob.filters`.
 */
export class ExportFiltersDto {
  /** Inclusive lower bound on submittedAt. */
  @IsOptional()
  @IsISO8601({ strict: false }, { message: 'from must be an ISO-8601 date' })
  from?: string;

  /** Exclusive upper bound on submittedAt. */
  @IsOptional()
  @IsISO8601({ strict: false }, { message: 'to must be an ISO-8601 date' })
  to?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(EXPORTABLE_SUBMISSION_STATUSES.length)
  @IsIn(EXPORTABLE_SUBMISSION_STATUSES, { each: true })
  statuses?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}

export class CreateExportDto {
  /**
   * Omit for an org-wide export.
   *
   * Validated as a UUID rather than passed through: the value reaches a Prisma
   * `where` on a `@db.Uuid` column, and Postgres raises a type error rather
   * than returning no rows for a malformed one — a 500 where a 400 belongs.
   */
  @IsOptional()
  @IsUUID('4', { message: 'formId must be a valid form id' })
  formId?: string;

  @IsOptional()
  @IsIn(['CSV', 'JSON'])
  format?: 'CSV' | 'JSON' = 'CSV';

  @IsOptional()
  @ValidateNested()
  @Type(() => ExportFiltersDto)
  filters?: ExportFiltersDto;
}
