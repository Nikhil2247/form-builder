import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

import { CSV_LIMITS } from '../logic/csv';

/**
 * Body for the two CSV endpoints.
 *
 * The file arrives as TEXT in a JSON body rather than as multipart, because the
 * server has no multipart handling anywhere else (uploads go straight to object
 * storage via presigned URLs) and adding it for one endpoint would mean a new
 * dependency and a second body-parsing path to keep secure. A dictionary is
 * bounded by MAX_IMPORT_ITEMS, so the largest legitimate file is a few
 * megabytes — well inside what a JSON body handles, given the raised limit this
 * route gets in main.ts.
 */
export class PreviewCsvDto {
  @IsString()
  @MinLength(1, { message: 'The file appears to be empty.' })
  @MaxLength(CSV_LIMITS.MAX_TEXT_LENGTH, {
    message: `That file is too large. Split it into parts of at most ${CSV_LIMITS.MAX_ROWS} rows.`,
  })
  csv: string;
}

export class ImportCsvDto extends PreviewCsvDto {
  /**
   * Which CSV column feeds which field: `{ value, label?, parentValue?,
   * metadata? }`. Shape-checked by the service rather than by nested DTOs —
   * `metadata` is an open map of user-chosen keys, which `whitelist` +
   * `forbidNonWhitelisted` would strip wholesale.
   */
  @IsObject() mapping: Record<string, unknown>;

  /**
   * `replace` retires every existing item the file does not mention; `merge`
   * leaves them alone. Retiring is a deactivation, never a delete — see
   * ChoiceListsService.importItems.
   */
  @IsOptional() @IsIn(['replace', 'merge']) mode?: 'replace' | 'merge';
}
