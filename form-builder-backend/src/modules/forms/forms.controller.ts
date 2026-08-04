import {
  Controller, Get, Post, Put, Delete, Body, Param,
  UseGuards, Req, Query, Res
} from '@nestjs/common';
import { FormsService } from './forms.service';
import { CreateFormDto } from './dto/create-form.dto';
import { UpdateFormDto } from './dto/update-form.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../../common/guards/org-member.guard';
import { RoleGuard } from '../../common/guards/role.guard';
import { RequiredRole } from '../../common/decorators/roles.decorator';
import { OrgId } from '../../common/decorators/org-id.decorator';
import type { Request, Response } from 'express';

/**
 * Organization-scoped form management endpoints.
 *
 * All routes require authentication and org membership.
 * Role requirements:
 *   VIEWER  — can list and view forms
 *   EDITOR  — can create and edit forms
 *   ADMIN   — can delete forms and manage all form settings
 */
@Controller('organizations/:orgId/forms')
@UseGuards(JwtAuthGuard, OrgMemberGuard, RoleGuard)
export class FormsController {
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

  @Get()
  @RequiredRole('VIEWER')
  getForms(
    @OrgId() orgId: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.formsService.getForms(
      orgId, 
      status, 
      parseInt(page ?? '1', 10), 
      parseInt(limit ?? '20', 10)
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

  @Get(':formId')
  @RequiredRole('VIEWER')
  getFormById(@OrgId() orgId: string, @Param('formId') formId: string) {
    return this.formsService.getFormById(orgId, formId);
  }

  @Put(':formId')
  @RequiredRole('EDITOR')
  updateForm(
    @OrgId() orgId: string,
    @Param('formId') formId: string,
    @Body() dto: UpdateFormDto,
  ) {
    return this.formsService.updateForm(orgId, formId, dto);
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
    @Body() body: { pages: any; questions: any; logic: any; theme: any },
  ) {
    return this.formsService.publishForm(
      orgId,
      formId,
      body.pages,
      body.questions,
      body.logic,
      body.theme,
    );
  }

  /**
   * GET /organizations/:orgId/forms/:formId/submissions — List submissions.
   * Any member can view submissions.
   */
  @Get(':formId/submissions')
  @RequiredRole('VIEWER')
  getSubmissions(
    @OrgId() orgId: string,
    @Param('formId') formId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.formsService.getSubmissions(
      orgId,
      formId,
      parseInt(page ?? '1', 10),
      parseInt(limit ?? '50', 10),
    );
  }

  /**
   * GET /organizations/:orgId/forms/:formId/export — Export submissions.
   */
  @Get(':formId/export')
  @RequiredRole('VIEWER')
  async exportSubmissions(
    @OrgId() orgId: string,
    @Param('formId') formId: string,
    @Query('format') format: string,
    @Res() res: Response,
  ) {
    const formatType = format === 'json' ? 'json' : 'csv';
    const data = await this.formsService.exportSubmissions(orgId, formId, formatType);
    
    if (formatType === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="export-${formId}.json"`);
      return res.send(data);
    } else {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="export-${formId}.csv"`);
      return res.send(data);
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
