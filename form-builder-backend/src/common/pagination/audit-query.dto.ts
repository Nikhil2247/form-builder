import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto } from './pagination-query.dto';

/**
 * Audit log filters.
 *
 * These have to live on the DTO rather than as extra `@Query('action')`
 * parameters: the global ValidationPipe runs with `forbidNonWhitelisted: true`,
 * so any query parameter absent from the bound DTO is a 400. Mixing
 * `@Query() dto` with sibling `@Query('name')` arguments silently makes those
 * siblings unreachable.
 */
export class AuditLogQueryDto extends PaginationQueryDto {
  /** Exact action name, e.g. "form.published". */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;

  /** Platform-level views only: narrow to a single organization. */
  @IsOptional()
  @IsUUID()
  orgId?: string;
}
