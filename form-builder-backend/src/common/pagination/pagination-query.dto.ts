import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './pagination';

/**
 * Query DTO every list endpoint extends.
 *
 * Validation happens before the handler runs, so a bad `?page=abc` returns a
 * 400 with a useful message rather than reaching Prisma as NaN.
 */
export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page must be a whole number' })
  @Min(1, { message: 'page starts at 1' })
  page: number = DEFAULT_PAGE;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be a whole number' })
  @Min(1)
  @Max(MAX_PAGE_SIZE, { message: `limit cannot exceed ${MAX_PAGE_SIZE}` })
  limit: number = DEFAULT_PAGE_SIZE;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  // Trim here so `?search=%20%20` does not become a LIKE '% %' scan.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;
}

/** Adds sorting. `sortBy` is validated against an allowlist in each service. */
export class SortablePaginationQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  sortBy?: string;

  @IsOptional()
  @Transform(({ value }) => (String(value).toLowerCase() === 'asc' ? 'asc' : 'desc'))
  sortOrder?: 'asc' | 'desc' = 'desc';
}
