import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import {
  ChoiceListsService,
  type ChoiceItemInput,
} from './choice-lists.service';
import { applyMapping } from './csv';
import { parseUpload, readMapping, sendCsv } from './choice-lists.controller';
import { ImportCsvDto, PreviewCsvDto } from './dto/import-csv.dto';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { SuperAdminGuard } from '../../common/auth/super-admin.guard';

/**
 * The PLATFORM dictionary — global choice lists, curated by a super admin.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * These rows carry `organizationId = null`, which makes them readable by every
 * organization and writable by none of them. India's states and districts ship
 * this way; anything else every tenant would otherwise re-upload separately —
 * ISO country codes, a national school registry, standard designation lists —
 * belongs here too.
 *
 * A SEPARATE CONTROLLER, not a flag on the org one. The org routes sit behind
 * `OrgMemberGuard`, which resolves `:orgId` from the caller's memberships; there
 * is no organization here to resolve, and threading a "global" escape hatch
 * through that guard would put the check that separates one tenant's data from
 * every tenant's data inside a boolean parameter. Here the guard chain states
 * the requirement outright: authenticated, and SUPER_ADMIN.
 *
 * The service enforces the same boundary independently — `resolveForWrite(null,
 * …)` matches only rows whose `organizationId` IS NULL — so neither layer is
 * relied upon alone.
 */
@Controller('admin/choice-lists')
@UseGuards(JwtAuthGuard, SuperAdminGuard)
export class PlatformChoiceListsController {
  constructor(private readonly lists: ChoiceListsService) {}

  @Get()
  list() {
    return this.lists.listListsForScope(null);
  }

  @Get(':slug/browse')
  browse(
    @Param('slug') slug: string,
    @Query()
    query: {
      parent?: string;
      q?: string;
      page?: string;
      limit?: string;
      includeInactive?: string;
    },
  ) {
    return this.lists.browseItems(null, slug, {
      parent: query.parent,
      q: query.q,
      page: query.page ? Number(query.page) : undefined,
      limit: query.limit ? Number(query.limit) : undefined,
      includeInactive: query.includeInactive === 'true',
    });
  }

  @Get(':slug/export')
  async exportCsv(@Param('slug') slug: string, @Res() res: Response) {
    const csv = await this.lists.exportCsv(null, slug);
    sendCsv(res, slug, csv);
  }

  @Get(':slug/template')
  async templateCsv(@Param('slug') slug: string, @Res() res: Response) {
    const csv = await this.lists.templateCsv(null, slug);
    sendCsv(res, `${slug}-template`, csv);
  }

  @Post()
  create(
    @Body()
    body: {
      name: string;
      slug?: string;
      description?: string;
      parentListSlug?: string;
      metadataSchema?: unknown;
    },
    @Req() req: Request,
  ) {
    return this.lists.createList(
      null,
      body,
      (req.user as { sub?: string })?.sub,
    );
  }

  @Patch(':slug')
  update(
    @Param('slug') slug: string,
    @Body()
    body: {
      name?: string;
      description?: string;
      parentListSlug?: string | null;
      metadataSchema?: unknown;
    },
    @Req() req: Request,
  ) {
    return this.lists.updateList(
      null,
      slug,
      body,
      (req.user as { sub?: string })?.sub,
    );
  }

  @Post(':slug/items')
  import(
    @Param('slug') slug: string,
    @Body() body: { items: ChoiceItemInput[]; mode?: 'replace' | 'merge' },
    @Req() req: Request,
  ) {
    return this.lists.importItems(
      null,
      slug,
      body,
      (req.user as { sub?: string })?.sub,
    );
  }

  @Post('import/preview')
  preview(@Body() body: PreviewCsvDto) {
    const parsed = parseUpload(body.csv);
    return {
      columns: parsed.columns,
      delimiter: parsed.delimiter,
      rowCount: parsed.rows.length,
      sample: parsed.rows.slice(0, 10),
    };
  }

  @Post(':slug/import/csv')
  importCsv(
    @Param('slug') slug: string,
    @Body() body: ImportCsvDto,
    @Req() req: Request,
  ) {
    const parsed = parseUpload(body.csv);
    const mapping = readMapping(body.mapping, parsed.columns);
    return this.lists.importItems(
      null,
      slug,
      { items: applyMapping(parsed.rows, mapping), mode: body.mode },
      (req.user as { sub?: string })?.sub,
    );
  }

  @Delete(':slug')
  remove(@Param('slug') slug: string, @Req() req: Request) {
    return this.lists.deleteList(
      null,
      slug,
      (req.user as { sub?: string })?.sub,
    );
  }
}
