import {
  BadRequestException,
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
import { applyMapping, parseCsv, type CsvMapping } from './logic/csv';
import { ImportCsvDto, PreviewCsvDto } from './dto/import-csv.dto';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { OrgMemberGuard } from '../../common/auth/org-member.guard';
import { RoleGuard } from '../../common/auth/role.guard';
import { RequiredRole } from '../../common/auth/roles.decorator';
import { OrgId } from '../../common/auth/org-id.decorator';

/**
 * Turn a client's mapping object into a `CsvMapping`, or explain what is wrong.
 *
 * Shared by the org and platform controllers so the two cannot drift on which
 * column is required. `value` is the only mandatory one: it is what lands in the
 * answer, and a row without it can never be selected or resolved.
 */
export function readMapping(
  raw: Record<string, unknown>,
  columns: string[],
): CsvMapping {
  const pick = (key: string): string | undefined => {
    const column = raw?.[key];
    if (typeof column !== 'string' || !column) return undefined;
    if (!columns.includes(column)) {
      throw new BadRequestException(
        `The file has no column called "${column}". Its columns are: ${columns.join(', ')}.`,
      );
    }
    return column;
  };

  const value = pick('value');
  if (!value) {
    throw new BadRequestException(
      'Choose which column holds the value — the code that gets stored in the answer.',
    );
  }

  const metadata: Record<string, string> = {};
  const rawMetadata = raw?.metadata;
  if (
    rawMetadata &&
    typeof rawMetadata === 'object' &&
    !Array.isArray(rawMetadata)
  ) {
    for (const [key, column] of Object.entries(
      rawMetadata as Record<string, unknown>,
    )) {
      if (typeof column !== 'string' || !column) continue;
      if (!columns.includes(column)) {
        throw new BadRequestException(
          `The file has no column called "${column}". Its columns are: ${columns.join(', ')}.`,
        );
      }
      metadata[key] = column;
    }
  }

  return {
    value,
    label: pick('label'),
    parentValue: pick('parentValue'),
    metadata,
  };
}

/**
 * Write a CSV body as a download.
 *
 * The BOM is not decoration: without it Excel on Windows reads the file as the
 * system codepage, and every district whose name carries a diacritic renders as
 * mojibake in the one tool most people will open it with.
 */
export function sendCsv(res: Response, slug: string, csv: string) {
  const safeName = slug.replace(/[^a-z0-9-]/gi, '') || 'list';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${safeName}.csv"`,
  );
  res.send(`\uFEFF${csv}`);
}

/** Parse an upload, refusing the ambiguous cases rather than guessing. */
export function parseUpload(csv: string) {
  const parsed = parseCsv(csv);

  if (parsed.columns.length === 0) {
    throw new BadRequestException(
      'That file has no header row, so its columns cannot be named.',
    );
  }
  if (parsed.rows.length === 0) {
    throw new BadRequestException('That file has a header but no rows.');
  }
  // Importing a silently truncated dictionary is worse than importing none: a
  // list quietly missing its last 40 000 schools looks complete and is not.
  if (parsed.truncated) {
    throw new BadRequestException(
      `That file has more rows than can be imported at once. Split it into parts and upload each with "Add and update".`,
    );
  }

  return parsed;
}

/**
 * Choice lists, for authors.
 *
 * Reading is VIEWER — the builder needs the catalogue to offer it, and a viewer
 * looking at a submission needs labels for the values it stores. Writing is
 * EDITOR; deleting is ADMIN, matching how forms and apps are governed.
 */
@Controller('organizations/:orgId/choice-lists')
@UseGuards(JwtAuthGuard, OrgMemberGuard, RoleGuard)
export class ChoiceListsController {
  constructor(private readonly lists: ChoiceListsService) {}

  @Get()
  @RequiredRole('VIEWER')
  list(@OrgId() orgId: string) {
    return this.lists.listLists(orgId);
  }

  @Get(':slug')
  @RequiredRole('VIEWER')
  get(@OrgId() orgId: string, @Param('slug') slug: string) {
    return this.lists.getList(orgId, slug);
  }

  @Get(':slug/items')
  @RequiredRole('VIEWER')
  items(
    @OrgId() orgId: string,
    @Param('slug') slug: string,
    @Query()
    query: { parent?: string; q?: string; limit?: string; cursor?: string },
  ) {
    return this.lists.getItems(orgId, slug, {
      parent: query.parent,
      q: query.q,
      limit: query.limit ? Number(query.limit) : undefined,
      cursor: query.cursor,
    });
  }

  /**
   * The dictionary browser's item view.
   *
   * Separate from `:slug/items` because it answers a different question. That
   * one serves a respondent filling in a dropdown, so it hides retired items and
   * returns nothing at all for a child list until a parent is chosen. This one
   * serves an editor reviewing what they just uploaded, so it shows retired rows
   * and pages through a child list whole.
   */
  @Get(':slug/browse')
  @RequiredRole('VIEWER')
  browse(
    @OrgId() orgId: string,
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
    return this.lists.browseItems(orgId, slug, {
      parent: query.parent,
      q: query.q,
      page: query.page ? Number(query.page) : undefined,
      limit: query.limit ? Number(query.limit) : undefined,
      includeInactive: query.includeInactive === 'true',
    });
  }

  /**
   * `@Res()` rather than a returned string: the global ResponseInterceptor
   * wraps every returned value in `{ data, meta }`, which would hand the browser
   * a JSON envelope with a `.csv` filename. Taking the response object opts the
   * route out of the interceptor entirely, the same way the submission export
   * does.
   */
  @Get(':slug/export')
  @RequiredRole('VIEWER')
  async exportCsv(
    @OrgId() orgId: string,
    @Param('slug') slug: string,
    @Res() res: Response,
  ) {
    const csv = await this.lists.exportCsv(orgId, slug);
    sendCsv(res, slug, csv);
  }

  /** A blank starter file with this list's columns and example rows. */
  @Get(':slug/template')
  @RequiredRole('VIEWER')
  async templateCsv(
    @OrgId() orgId: string,
    @Param('slug') slug: string,
    @Res() res: Response,
  ) {
    const csv = await this.lists.templateCsv(orgId, slug);
    sendCsv(res, `${slug}-template`, csv);
  }

  @Post()
  @RequiredRole('EDITOR')
  create(
    @OrgId() orgId: string,
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
      orgId,
      body,
      (req.user as { sub?: string })?.sub,
    );
  }

  @Patch(':slug')
  @RequiredRole('EDITOR')
  update(
    @OrgId() orgId: string,
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
      orgId,
      slug,
      body,
      (req.user as { sub?: string })?.sub,
    );
  }

  @Post(':slug/items')
  @RequiredRole('EDITOR')
  import(
    @OrgId() orgId: string,
    @Param('slug') slug: string,
    @Body() body: { items: ChoiceItemInput[]; mode?: 'replace' | 'merge' },
    @Req() req: Request,
  ) {
    return this.lists.importItems(
      orgId,
      slug,
      body,
      (req.user as { sub?: string })?.sub,
    );
  }

  /**
   * Read a CSV's columns and first rows so the user can map them.
   *
   * Deliberately writes nothing. The mapping step needs to show real cells from
   * the real file — a user picking "which column is the district code" cannot do
   * it from column names alone when the names are `col_1 … col_9`.
   */
  @Post('import/preview')
  @RequiredRole('EDITOR')
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
  @RequiredRole('EDITOR')
  importCsv(
    @OrgId() orgId: string,
    @Param('slug') slug: string,
    @Body() body: ImportCsvDto,
    @Req() req: Request,
  ) {
    const parsed = parseUpload(body.csv);
    const mapping = readMapping(body.mapping, parsed.columns);
    return this.lists.importItems(
      orgId,
      slug,
      { items: applyMapping(parsed.rows, mapping), mode: body.mode },
      (req.user as { sub?: string })?.sub,
    );
  }

  @Delete(':slug')
  @RequiredRole('ADMIN')
  remove(
    @OrgId() orgId: string,
    @Param('slug') slug: string,
    @Req() req: Request,
  ) {
    return this.lists.deleteList(
      orgId,
      slug,
      (req.user as { sub?: string })?.sub,
    );
  }
}
