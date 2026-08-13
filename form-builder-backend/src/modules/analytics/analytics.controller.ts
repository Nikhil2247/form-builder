import {
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../../common/guards/org-member.guard';
import { RoleGuard } from '../../common/guards/role.guard';
import { RequiredRole } from '../../common/decorators/roles.decorator';
import { OrgId } from '../../common/decorators/org-id.decorator';

@Controller('organizations/:orgId/analytics')
@UseGuards(JwtAuthGuard, OrgMemberGuard, RoleGuard)
@RequiredRole('VIEWER')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  /**
   * GET /organizations/:orgId/analytics/summary
   *
   * Headline totals for the dashboard. The service clamps `days` to 1–365.
   */
  @Get('summary')
  async getSummary(
    @OrgId() orgId: string,
    @Query('days', new DefaultValuePipe(30), ParseIntPipe) days: number,
  ) {
    return this.analyticsService.getOrgSummary(orgId, days);
  }

  /**
   * GET /organizations/:orgId/analytics/top-forms — busiest forms.
   */
  @Get('top-forms')
  async getTopForms(
    @OrgId() orgId: string,
    @Query('limit', new DefaultValuePipe(5), ParseIntPipe) limit: number,
  ) {
    return this.analyticsService.getTopForms(orgId, limit);
  }

  /**
   * GET /organizations/:orgId/analytics/global — daily totals across all forms.
   */
  @Get('global')
  async getGlobalAnalytics(
    @OrgId() orgId: string,
    @Query('days', new DefaultValuePipe(30), ParseIntPipe) days: number,
  ) {
    return this.analyticsService.getGlobalAnalytics(orgId, days);
  }

  /**
   * GET /organizations/:orgId/analytics/forms/:formId — daily rows for a form.
   */
  @Get('forms/:formId')
  async getFormAnalytics(
    @OrgId() orgId: string,
    @Param('formId') formId: string,
    @Query('days', new DefaultValuePipe(30), ParseIntPipe) days: number,
  ) {
    return this.analyticsService.getFormAnalytics(orgId, formId, days);
  }
}
