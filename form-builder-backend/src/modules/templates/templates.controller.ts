import { Controller, Get, Query, Param } from '@nestjs/common';
import { TemplatesService } from './templates.service';

@Controller('templates')
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Get()
  getPublicTemplates(
    @Query('category') category?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 20;
    return this.templatesService.getPublicTemplates(category, pageNum, limitNum);
  }

  @Get(':id')
  getTemplateById(@Param('id') id: string) {
    return this.templatesService.getTemplateById(id);
  }
}
