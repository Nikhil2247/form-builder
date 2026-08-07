import { Controller, Get, Query, Param } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { TemplatesService } from './templates.service';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';
import { parsePagination } from '../../common/pagination/pagination';

class ListTemplatesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  category?: string;
}

@Controller('templates')
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Get()
  getPublicTemplates(@Query() query: ListTemplatesQueryDto) {
    return this.templatesService.getPublicTemplates(
      query.category,
      parsePagination(query),
      query.search,
    );
  }

  /**
   * GET /templates/categories — distinct categories for the filter control.
   *
   * Declared before `:id` so the literal path wins; behind the parameterised
   * route it would be swallowed and "categories" treated as a template id.
   */
  @Get('categories')
  getCategories() {
    return this.templatesService.getCategories();
  }

  @Get(':id')
  getTemplateById(@Param('id') id: string) {
    return this.templatesService.getTemplateById(id);
  }
}
