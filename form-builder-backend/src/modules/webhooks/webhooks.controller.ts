import { Controller, Get, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../../common/guards/org-member.guard';
import { RoleGuard } from '../../common/guards/role.guard';
import { RequiredRole } from '../../common/decorators/roles.decorator';
import { OrgId } from '../../common/decorators/org-id.decorator';

@Controller('organizations/:orgId/forms/:formId/webhooks')
@UseGuards(JwtAuthGuard, OrgMemberGuard, RoleGuard)
@RequiredRole('ADMIN')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post()
  async createWebhook(
    @OrgId() orgId: string,
    @Param('formId') formId: string,
    @Body('url') url: string,
    @Body('name') name: string,
  ) {
    return this.webhooksService.createWebhook(orgId, formId, url, name);
  }

  @Get()
  async getWebhooks(
    @OrgId() orgId: string,
    @Param('formId') formId: string,
  ) {
    return this.webhooksService.getWebhooks(orgId, formId);
  }

  @Delete(':webhookId')
  async deleteWebhook(
    @OrgId() orgId: string,
    @Param('formId') formId: string,
    @Param('webhookId') webhookId: string,
  ) {
    return this.webhooksService.deleteWebhook(orgId, formId, webhookId);
  }
}
