import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/http/pagination/pagination-query.dto';

/**
 * Query for `GET /notifications`.
 *
 * Extends the platform pagination DTO so this list clamps `page`/`limit` the
 * same way every other one does — see `common/pagination/pagination.ts` for
 * what hand-rolled paging cost here before.
 */
export class ListNotificationsDto extends PaginationQueryDto {
  /**
   * Show only what the user has not read yet.
   *
   * The global ValidationPipe runs with `enableImplicitConversion`, which turns
   * the string "false" into `true` for a boolean-typed property — every
   * non-empty string is truthy. That is the wrong answer for the one value a
   * caller is most likely to send explicitly, so the conversion is done here
   * against the literal forms a query string can carry.
   */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  unreadOnly?: boolean = false;
}
