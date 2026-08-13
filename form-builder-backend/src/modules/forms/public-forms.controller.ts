import {
  Controller,
  Get,
  Param,
  Header,
  Put,
  Delete,
  Post,
  Body,
  Query,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { FormsService } from './forms.service';

@Controller('public-forms')
export class PublicFormsController {
  constructor(private readonly formsService: FormsService) {}

  @Get(':slug')
  // stale-while-revalidate lets a CDN keep serving the cached form while it
  // refreshes in the background — published versions are immutable, so this is
  // safe and takes almost all form-view traffic off the origin.
  @Header('Cache-Control', 'public, max-age=300, stale-while-revalidate=600')
  async getPublicForm(@Param('slug') slug: string) {
    return this.formsService.getPublicForm(slug);
  }

  /**
   * Record a view / start event.
   * FormAnalytics.views and .starts existed in the schema but nothing ever
   * wrote them, so every dashboard showed 0 views and no completion rate.
   */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post(':slug/track')
  @HttpCode(HttpStatus.NO_CONTENT)
  async track(
    @Param('slug') slug: string,
    @Body() body: { event: 'view' | 'start' },
  ) {
    await this.formsService.trackEvent(slug, body?.event);
  }

  @Put(':slug/draft')
  async saveDraft(
    @Param('slug') slug: string,
    @Body()
    body: {
      fingerprint: string;
      answers: any;
      lastFieldId?: string;
      progress?: number;
    },
  ) {
    return this.formsService.saveDraft(slug, body);
  }

  @Get(':slug/draft')
  async getDraft(
    @Param('slug') slug: string,
    @Query('fp') fingerprint: string,
  ) {
    return this.formsService.getDraft(slug, fingerprint);
  }

  @Delete(':slug/draft')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteDraft(
    @Param('slug') slug: string,
    @Query('fp') fingerprint: string,
  ) {
    await this.formsService.deleteDraft(slug, fingerprint);
  }

  @Get(':slug/embed')
  // Not async: this builds a snippet from the request's own headers and touches
  // no I/O. Nest serialises a plain return value identically.
  getEmbedCode(@Param('slug') slug: string, @Req() req: any) {
    const host = req.headers.host;
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const baseUrl = `${protocol}://${host}`;

    // We assume the frontend will serve a lightweight web component bundle
    // at /embed.js which will parse data-slug and render the form.
    return {
      script: `<script src="${baseUrl}/embed.js" data-form-slug="${slug}" data-api-url="${baseUrl}/api/v1"></script><div id="form-builder-embed-${slug}"></div>`,
      iframe: `<iframe src="${baseUrl}/f/${slug}" width="100%" height="800" frameborder="0"></iframe>`,
    };
  }
}
