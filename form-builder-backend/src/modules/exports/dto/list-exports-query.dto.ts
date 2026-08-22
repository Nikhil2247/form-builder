import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/http/pagination/pagination-query.dto';

/** Query parameters for GET /organizations/:orgId/exports. */
export class ListExportsQueryDto extends PaginationQueryDto {
  /** Narrow the list to one form's exports. */
  @IsOptional()
  @IsUUID('4', { message: 'formId must be a valid form id' })
  formId?: string;

  @IsOptional()
  @IsIn(['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'EXPIRED'])
  status?: string;
}
