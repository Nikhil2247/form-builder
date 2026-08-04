import { Controller, Get, Param, UseGuards } from '@nestjs/common';
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
   * GET /organizations/:orgId/analytics/global — Aggregated analytics for all org forms.
   */
  @Get('global')
  async getGlobalAnalytics(@OrgId() orgId: string) {
    return this.analyticsService.getGlobalAnalytics(orgId);
  }

  /**
   * GET /organizations/:orgId/analytics/forms/:formId — Analytics for a specific form.
   */
  @Get('forms/:formId')
  async getFormAnalytics(@OrgId() orgId: string, @Param('formId') formId: string) {
    return this.analyticsService.getFormAnalytics(orgId, formId);
  }
}
