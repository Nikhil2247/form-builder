import { Controller, Get, Query, Param } from '@nestjs/common';
import { TemplatesService } from './templates.service';

@Controller('templates')
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Get()
  getPublicTemplates(@Query('category') category?: string) {
    return this.templatesService.getPublicTemplates(category);
  }

  @Get(':id')
  getTemplateById(@Param('id') id: string) {
    return this.templatesService.getTemplateById(id);
  }
}
