import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import * as crypto from 'crypto';

@Injectable()
export class WebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Verify a form belongs to the given organization.
   */
  private async verifyFormOrg(orgId: string, formId: string) {
    const form = await this.prisma.reader.form.findFirst({
      where: { id: formId, organizationId: orgId },
      select: { id: true },
    });

    if (!form) {
      throw new NotFoundException('Form not found in this organization.');
    }
    return form;
  }

  async createWebhook(orgId: string, formId: string, url: string, name: string = 'Webhook') {
    await this.verifyFormOrg(orgId, formId);

    const secret = crypto.randomBytes(32).toString('hex');

    const webhook = await this.prisma.writer.formWebhook.create({
      data: {
        formId,
        url,
        secret,
        name,
      },
    });

    this.audit.log({
      organizationId: orgId,
      action: 'webhook.created',
      resource: 'webhook',
      resourceId: webhook.id,
      metadata: { formId, webhookName: name },
    });

    return webhook;
  }

  async getWebhooks(orgId: string, formId: string) {
    await this.verifyFormOrg(orgId, formId);

    return this.prisma.reader.formWebhook.findMany({
      where: { formId, isActive: true },
    });
  }

  async deleteWebhook(orgId: string, formId: string, webhookId: string) {
    await this.verifyFormOrg(orgId, formId);

    return this.prisma.writer.formWebhook.updateMany({
      where: { id: webhookId, formId },
      data: { isActive: false },
    });
  }
}
