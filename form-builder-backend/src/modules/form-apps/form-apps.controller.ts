import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import type { Request } from 'express';

import { FormAppsService, type FormAppConfig } from './form-apps.service';
import { FormAppSessionsService } from './form-app-sessions.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { OrgMemberGuard } from '../../common/auth/org-member.guard';
import { RoleGuard } from '../../common/auth/role.guard';
import { RequiredRole } from '../../common/auth/roles.decorator';
import { OrgId } from '../../common/auth/org-id.decorator';

/**
 * Form Apps.
 *
 * Reading an app and its dashboard is VIEWER — that is what data-entry staff
 * do all day. Configuring one is EDITOR. No new role was introduced; see
 * plan.md §9.3.
 */
@Controller('organizations/:orgId/apps')
@UseGuards(JwtAuthGuard, OrgMemberGuard, RoleGuard)
export class FormAppsController {
  constructor(
    private readonly apps: FormAppsService,
    private readonly sessions: FormAppSessionsService,
  ) {}

  @Get()
  @RequiredRole('VIEWER')
  listApps(@OrgId() orgId: string) {
    return this.apps.listApps(orgId);
  }

  @Get(':appId')
  @RequiredRole('VIEWER')
  getApp(
    @OrgId() orgId: string,
    @Param('appId', new ParseUUIDPipe()) appId: string,
  ) {
    return this.apps.getApp(orgId, appId);
  }

  @Get(':appId/dashboard')
  @RequiredRole('VIEWER')
  getDashboard(
    @OrgId() orgId: string,
    @Param('appId', new ParseUUIDPipe()) appId: string,
  ) {
    return this.apps.getDashboard(orgId, appId);
  }

  /**
   * The work queue: records with no entry for this step in the current window.
   *
   * VIEWER, like the rest of the dashboard — working through a chase list is
   * data entry, not configuration.
   *
   * Cursor-paginated and deliberately WITHOUT a total. Counting outstanding
   * records means probing every subject in the organization; listing the next
   * twenty-five stops after twenty-five. See `dueForStep`.
   */
  @Get(':appId/due')
  @RequiredRole('VIEWER')
  getDue(
    @OrgId() orgId: string,
    @Param('appId', new ParseUUIDPipe()) appId: string,
    @Query() query: { stepKey?: string; limit?: string; cursor?: string },
  ) {
    return this.sessions.dueForStep(orgId, appId, query.stepKey ?? '', {
      limit: query.limit ? Number(query.limit) : undefined,
      cursor: query.cursor,
    });
  }

  @Post()
  @RequiredRole('EDITOR')
  createApp(
    @OrgId() orgId: string,
    @Body()
    body: {
      name: string;
      slug?: string;
      subjectTypeId: string;
      description?: string;
      icon?: string;
      config?: FormAppConfig;
    },
    @Req() req: Request,
  ) {
    return this.apps.createApp(orgId, body, (req.user as any)?.sub);
  }

  @Patch(':appId')
  @RequiredRole('EDITOR')
  updateApp(
    @OrgId() orgId: string,
    @Param('appId', new ParseUUIDPipe()) appId: string,
    @Body()
    body: {
      name?: string;
      description?: string;
      icon?: string;
      config?: FormAppConfig;
      isPublished?: boolean;
    },
    @Req() req: Request,
  ) {
    return this.apps.updateApp(orgId, appId, body, (req.user as any)?.sub);
  }

  @Delete(':appId')
  @RequiredRole('ADMIN')
  deleteApp(
    @OrgId() orgId: string,
    @Param('appId', new ParseUUIDPipe()) appId: string,
    @Req() req: Request,
  ) {
    return this.apps.deleteApp(orgId, appId, (req.user as any)?.sub);
  }
}
