import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
  Query,
  Res,
  Logger,
} from '@nestjs/common';
import { FormsService } from './forms.service';
import { CreateFormDto } from './dto/create-form.dto';
import { UpdateFormDto } from './dto/update-form.dto';
import { ApiKeyOrJwtGuard } from '../../common/guards/api-key-or-jwt.guard';
import { OrgMemberGuard } from '../../common/guards/org-member.guard';
import { RoleGuard } from '../../common/guards/role.guard';
import { RequiredRole } from '../../common/decorators/roles.decorator';
import { RequiredScope } from '../../common/decorators/scopes.decorator';
import { OrgId } from '../../common/decorators/org-id.decorator';
import type { Request, Response } from 'express';
import { ListFormsQueryDto } from './dto/list-forms-query.dto';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';
import { parsePagination } from '../../common/pagination/pagination';

/**
 * Organization-scoped form management endpoints.
 *
 * All routes require authentication and org membership.
 * Role requirements:
 *   VIEWER  — can list and view forms
 *   EDITOR  — can create and edit forms
 *   ADMIN   — can delete forms and manage all form settings
 *
 * AUTHENTICATION: `ApiKeyOrJwtGuard` stands where `JwtAuthGuard` used to. That
 * substitution changes nothing on its own — the guard hands any request without
 * an `X-API-Key` header straight to the JWT path, and refuses a key outright on
 * any handler that carries no `@RequiredScope`. The three read routes below
 * that DO carry one are the machine-to-machine surface: read a form, list its
 * submissions, export them. Everything else on this controller mutates, and
 * mutations stay behind a human session.
 *
 * The role chain still applies to a key: ApiKeyGuard resolves the key to its
 * owner, OrgMemberGuard re-checks that owner's membership of :orgId, and
 * RoleGuard applies their role. A key is bounded by its scopes AND its owner's
 * access, whichever is narrower.
 */
@Controller('organizations/:orgId/forms')
@UseGuards(ApiKeyOrJwtGuard, OrgMemberGuard, RoleGuard)
export class FormsController {
  private readonly logger = new Logger(FormsController.name);

  constructor(private readonly formsService: FormsService) {}

  @Post()
  @RequiredRole('EDITOR')
  createForm(
    @OrgId() orgId: string,
    @Req() req: Request,
    @Body() dto: CreateFormDto,
  ) {
    const userId = (req.user as any).sub;
    return this.formsService.createForm(orgId, userId, dto);
  }

  @Post('from-template/:templateId')
  @RequiredRole('EDITOR')
  createFromTemplate(
    @OrgId() orgId: string,
    @Param('templateId') templateId: string,
    @Req() req: Request,
  ) {
    const userId = (req.user as any).sub;
    return this.formsService.createFromTemplate(orgId, userId, templateId);
  }

  @Post('generate')
  @RequiredRole('EDITOR')
  generateForm(
    @OrgId() orgId: string,
    @Body() body: { prompt: string },
    @Req() req: Request,
  ) {
    const userId = (req.user as any).sub;
    return this.formsService.generateFormWithAI(orgId, userId, body.prompt);
  }

  /**
   * GET /organizations/:orgId/forms
   *
   * Paging, search, and sort are all server-side. The DTO validates and clamps
   * before the handler runs — `?page=abc` previously reached Prisma as NaN,
   * which returns the entire table.
   */
  @Get()
  @RequiredRole('VIEWER')
  getForms(@OrgId() orgId: string, @Query() query: ListFormsQueryDto) {
    return this.formsService.getForms(
      orgId,
      {
        status: query.status,
        search: query.search,
        sortBy: query.sortBy,
        sortOrder: query.sortOrder,
      },
      parsePagination(query),
    );
  }

  @Get('trash')
  @RequiredRole('ADMIN')
  getTrashedForms(@OrgId() orgId: string) {
    return this.formsService.getTrashedForms(orgId);
  }

  @Post(':formId/restore')
  @RequiredRole('ADMIN')
  restoreForm(@OrgId() orgId: string, @Param('formId') formId: string) {
    return this.formsService.restoreForm(orgId, formId);
  }

  /**
   * GET /organizations/:orgId/forms/:formId — Read one form.
   *
   * Accepts an API key scoped `forms:read`. This is what an integration calls
   * to discover a form's question set before mapping it onto its own schema.
   */
  @Get(':formId')
  @RequiredRole('VIEWER')
  @RequiredScope('forms:read')
  getFormById(@OrgId() orgId: string, @Param('formId') formId: string) {
    return this.formsService.getFormById(orgId, formId);
  }

  @Put(':formId')
  @RequiredRole('EDITOR')
  updateForm(
    @OrgId() orgId: string,
    @Param('formId') formId: string,
    @Body() dto: UpdateFormDto,
    @Req() req: Request,
  ) {
    const userId = (req.user as any).sub;
    return this.formsService.updateForm(orgId, formId, dto, userId);
  }

  @Delete(':formId')
  @RequiredRole('ADMIN')
  deleteForm(@OrgId() orgId: string, @Param('formId') formId: string) {
    return this.formsService.deleteForm(orgId, formId);
  }

  @Post(':formId/publish')
  @RequiredRole('EDITOR')
  publishForm(
    @OrgId() orgId: string,
    @Param('formId') formId: string,
    @Body()
    body: { pages: any; questions: any; logic: any; theme: any; rules?: any },
    @Req() req: Request,
  ) {
    const userId = (req.user as any).sub;
    return this.formsService.publishForm(
      orgId,
      formId,
      body.pages,
      body.questions,
      body.logic,
      body.theme,
      userId,
      body.rules,
    );
  }

  /**
   * GET /organizations/:orgId/forms/:formId/submissions — List submissions.
   * Any member can view submissions.
   *
   * Accepts an API key scoped `submissions:read` — the polling endpoint for an
   * integration that syncs responses into its own store.
   */
  @Get(':formId/submissions')
  @RequiredRole('VIEWER')
  @RequiredScope('submissions:read')
  getSubmissions(
    @OrgId() orgId: string,
    @Param('formId') formId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.formsService.getSubmissions(
      orgId,
      formId,
      parsePagination(query),
    );
  }

  /**
   * GET /organizations/:orgId/forms/:formId/export — Export submissions.
   *
   * Streamed. `exportSubmissions` validates and throws before handing back the
   * generator, so a missing form or an over-cap request still becomes a normal
   * JSON error — nothing is written until the first chunk is pulled below.
   *
   * Accepts an API key holding BOTH `submissions:read` and
   * `submissions:export`. Export is not just "read, but as a file": it hands
   * over every response to the form in one request, so a key that may poll for
   * new submissions should not automatically be able to drain the archive. The
   * two scopes are required together (@RequiredScope is an AND) so that
   * `submissions:export` alone is never a way around the read scope either.
   */
  @Get(':formId/export')
  @RequiredRole('VIEWER')
  @RequiredScope('submissions:read', 'submissions:export')
  async exportSubmissions(
    @OrgId() orgId: string,
    @Param('formId') formId: string,
    @Query('format') format: string,
    @Res() res: Response,
  ) {
    const formatType = format === 'json' ? 'json' : 'csv';
    const chunks = await this.formsService.exportSubmissions(
      orgId,
      formId,
      formatType,
    );

    res.setHeader(
      'Content-Type',
      formatType === 'json'
        ? 'application/json; charset=utf-8'
        : 'text/csv; charset=utf-8',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="export-${formId}.${formatType}"`,
    );
    // An export is per-org data behind auth and is never revalidated.
    res.setHeader('Cache-Control', 'no-store');

    try {
      for await (const chunk of chunks) {
        // Respect backpressure: without this a fast reader query on a slow
        // connection buffers the entire export in the socket's write queue,
        // which is the memory problem this change exists to remove.
        if (!res.write(chunk)) {
          await new Promise<void>((resolve) => res.once('drain', resolve));
        }
      }
      res.end();
    } catch (err) {
      // The status line and headers are already on the wire, so there is no way
      // to turn this into a 500 the client can read. Destroying the socket is
      // what makes the download fail loudly instead of arriving truncated and
      // looking complete.
      this.logger.error(
        `Export stream failed for form ${formId}`,
        err instanceof Error ? err.stack : String(err),
      );
      res.destroy();
    }
  }

  /**
   * POST /organizations/:orgId/forms/:formId/clone — Clone a form.
   */
  @Post(':formId/clone')
  @RequiredRole('EDITOR')
  cloneForm(
    @OrgId() orgId: string,
    @Param('formId') formId: string,
    @Req() req: Request,
  ) {
    const userId = (req.user as any).sub;
    return this.formsService.cloneForm(orgId, formId, userId);
  }
}
