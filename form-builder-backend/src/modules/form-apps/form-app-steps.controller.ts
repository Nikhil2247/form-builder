import {
  Body,
  Controller,
  Delete,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import { FormAppsService, type AppLayoutMode } from './form-apps.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../../common/guards/org-member.guard';
import { RoleGuard } from '../../common/guards/role.guard';
import { RequiredRole } from '../../common/decorators/roles.decorator';
import { OrgId } from '../../common/decorators/org-id.decorator';

/**
 * Configuring an app: its steps, its reporting periods, and its settings.
 *
 * All EDITOR. Reading an app stays on FormAppsController at VIEWER, because
 * data-entry staff need to open one all day; changing its shape is authoring.
 */
@Controller('organizations/:orgId/apps/:appId')
@UseGuards(JwtAuthGuard, OrgMemberGuard, RoleGuard)
export class FormAppStepsController {
  constructor(private readonly apps: FormAppsService) {}

  private userId(req: Request) {
    return (req.user as { sub?: string })?.sub;
  }

  // ── Steps ─────────────────────────────────────────────────────────────────

  @Post('steps')
  @RequiredRole('EDITOR')
  createStep(
    @OrgId() orgId: string,
    @Param('appId', new ParseUUIDPipe()) appId: string,
    @Body()
    body: {
      formId: string;
      title?: string;
      key?: string;
      description?: string;
      icon?: string;
      mode?: 'SINGLE' | 'REPEATABLE';
      minEntries?: number;
      maxEntries?: number | null;
      isOptional?: boolean;
      uniqueBy?: string[];
      showWhen?: unknown;
    },
    @Req() req: Request,
  ) {
    return this.apps.createStep(orgId, appId, body, this.userId(req));
  }

  @Patch('steps/:stepId')
  @RequiredRole('EDITOR')
  updateStep(
    @OrgId() orgId: string,
    @Param('appId', new ParseUUIDPipe()) appId: string,
    @Param('stepId', new ParseUUIDPipe()) stepId: string,
    @Body()
    body: {
      title?: string;
      description?: string | null;
      icon?: string | null;
      mode?: 'SINGLE' | 'REPEATABLE';
      minEntries?: number;
      maxEntries?: number | null;
      isOptional?: boolean;
      uniqueBy?: string[];
      showWhen?: unknown;
    },
    @Req() req: Request,
  ) {
    return this.apps.updateStep(orgId, appId, stepId, body, this.userId(req));
  }

  @Delete('steps/:stepId')
  @RequiredRole('EDITOR')
  deleteStep(
    @OrgId() orgId: string,
    @Param('appId', new ParseUUIDPipe()) appId: string,
    @Param('stepId', new ParseUUIDPipe()) stepId: string,
    @Req() req: Request,
  ) {
    return this.apps.deleteStep(orgId, appId, stepId, this.userId(req));
  }

  @Post('steps/reorder')
  @RequiredRole('EDITOR')
  reorderSteps(
    @OrgId() orgId: string,
    @Param('appId', new ParseUUIDPipe()) appId: string,
    @Body() body: { stepIds: string[] },
    @Req() req: Request,
  ) {
    return this.apps.reorderSteps(orgId, appId, body?.stepIds ?? [], this.userId(req));
  }

  // ── Periods ───────────────────────────────────────────────────────────────

  @Post('periods')
  @RequiredRole('EDITOR')
  createPeriod(
    @OrgId() orgId: string,
    @Param('appId', new ParseUUIDPipe()) appId: string,
    @Body() body: { label: string; startsAt: string; endsAt: string; isActive?: boolean },
    @Req() req: Request,
  ) {
    return this.apps.createPeriod(orgId, appId, body, this.userId(req));
  }

  @Patch('periods/:periodId')
  @RequiredRole('EDITOR')
  updatePeriod(
    @OrgId() orgId: string,
    @Param('appId', new ParseUUIDPipe()) appId: string,
    @Param('periodId', new ParseUUIDPipe()) periodId: string,
    @Body() body: { label?: string; startsAt?: string; endsAt?: string; isActive?: boolean },
  ) {
    return this.apps.updatePeriod(orgId, appId, periodId, body);
  }

  @Delete('periods/:periodId')
  @RequiredRole('EDITOR')
  deletePeriod(
    @OrgId() orgId: string,
    @Param('appId', new ParseUUIDPipe()) appId: string,
    @Param('periodId', new ParseUUIDPipe()) periodId: string,
  ) {
    return this.apps.deletePeriod(orgId, appId, periodId);
  }

  // ── Settings ──────────────────────────────────────────────────────────────

  @Patch('settings')
  @RequiredRole('EDITOR')
  updateSettings(
    @OrgId() orgId: string,
    @Param('appId', new ParseUUIDPipe()) appId: string,
    @Body()
    body: {
      themeConfig?: unknown;
      branding?: unknown;
      publicSlug?: string | null;
      requireAuth?: boolean;
      allowDrafts?: boolean;
      isPublished?: boolean;
      layoutMode?: AppLayoutMode;
    },
    @Req() req: Request,
  ) {
    return this.apps.updateSettings(orgId, appId, body, this.userId(req));
  }
}
