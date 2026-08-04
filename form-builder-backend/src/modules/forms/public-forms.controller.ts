import { Controller, Get, Param, Header, Put, Body, Query, Req } from '@nestjs/common';
import { FormsService } from './forms.service';

@Controller('public-forms')
export class PublicFormsController {
  constructor(private readonly formsService: FormsService) {}

  @Get(':slug')
  @Header('Cache-Control', 'public, max-age=300')
  async getPublicForm(@Param('slug') slug: string) {
    return this.formsService.getPublicForm(slug);
  }

  @Put(':slug/draft')
  async saveDraft(
    @Param('slug') slug: string,
    @Body() body: { fingerprint: string; answers: any; lastFieldId?: string; progress?: number }
  ) {
    return this.formsService.saveDraft(slug, body);
  }

  @Get(':slug/draft')
  async getDraft(
    @Param('slug') slug: string,
    @Query('fp') fingerprint: string
  ) {
    return this.formsService.getDraft(slug, fingerprint);
  }

  @Get(':slug/embed')
  async getEmbedCode(@Param('slug') slug: string, @Req() req: any) {
    const host = req.headers.host;
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const baseUrl = `${protocol}://${host}`;
    
    // We assume the frontend will serve a lightweight web component bundle 
    // at /embed.js which will parse data-slug and render the form.
    return {
      script: `<script src="${baseUrl}/embed.js" data-form-slug="${slug}" data-api-url="${baseUrl}/api/v1"></script><div id="form-builder-embed-${slug}"></div>`,
      iframe: `<iframe src="${baseUrl}/f/${slug}" width="100%" height="800" frameborder="0"></iframe>`
    };
  }
}
