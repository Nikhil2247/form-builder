import { IsIn, IsOptional } from 'class-validator';
import { SortablePaginationQueryDto } from '../../../common/http/pagination/pagination-query.dto';

/** Query parameters for GET /organizations/:orgId/forms. */
export class ListFormsQueryDto extends SortablePaginationQueryDto {
  /**
   * Restricted to the real enum values. An unchecked string reached Prisma's
   * `where.status` and produced a 500 on any typo.
   */
  @IsOptional()
  @IsIn(['ALL', 'DRAFT', 'PUBLISHED', 'CLOSED', 'ARCHIVED'])
  status?: string;
}
