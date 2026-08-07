import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { assertSafeOutboundUrl } from '../../common/net/url-guard';
import * as crypto from 'crypto';

/**
 * Fields safe to return to API callers.
 * `secret` is deliberately absent — it was previously returned by a bare
 * findMany to anyone who could list webhooks.
 */
/**
 * Everything a webhook read returns. `secret` is deliberately absent: it is
 * encrypted at rest and handed back exactly once, at creation and on rotation.
 */
const PUBLIC_WEBHOOK_FIELDS = {
  id: true,
  formId: true,
  url: true,
  name: true,
  isActive: true,
  createdAt: true,
  // Lets the UI show whether a hook has ever fired without a second request.
  _count: { select: { deliveries: true } },
} as const;

@Injectable()
export class WebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
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

    // Throws BadRequestException for non-HTTPS, credentialed, internal, or
    // otherwise unsafe destinations. Re-checked again at delivery time.
    await assertSafeOutboundUrl(url);

    const secret = crypto.randomBytes(32).toString('hex');

    const webhook = await this.prisma.writer.formWebhook.create({
      data: {
        formId,
        url,
        secret: this.crypto.encrypt(secret)!,
        name: name.slice(0, 100),
      },
      select: PUBLIC_WEBHOOK_FIELDS,
    });

    this.audit.log({
      organizationId: orgId,
      action: 'webhook.created',
      resource: 'webhook',
      resourceId: webhook.id,
      metadata: { formId, webhookName: name },
    });

    // The plaintext secret is shown exactly once, at creation, so the
    // integrator can configure signature verification on their end.
    return { ...webhook, secret };
  }

  async getWebhooks(orgId: string, formId: string) {
    await this.verifyFormOrg(orgId, formId);

    return this.prisma.reader.formWebhook.findMany({
      // Deliberately NOT filtered on isActive. Delivery auto-deactivates a
      // webhook whose endpoint starts resolving to a blocked address or fails
      // repeatedly — filtering those out made them vanish from the UI entirely,
      // so an admin saw "no webhooks", could not tell deliveries had stopped,
      // and had no way to re-enable or remove the row.
      where: { formId },
      select: PUBLIC_WEBHOOK_FIELDS,
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
    });
  }

  /** Rotate a webhook's signing secret. Returns the new plaintext once. */
  async rotateSecret(orgId: string, formId: string, webhookId: string) {
    await this.verifyFormOrg(orgId, formId);

    const existing = await this.prisma.reader.formWebhook.findFirst({
      where: { id: webhookId, formId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Webhook not found.');

    const secret = crypto.randomBytes(32).toString('hex');
    await this.prisma.writer.formWebhook.update({
      where: { id: webhookId },
      data: { secret: this.crypto.encrypt(secret)! },
    });

    this.audit.log({
      organizationId: orgId,
      action: 'webhook.secret_rotated',
      resource: 'webhook',
      resourceId: webhookId,
      metadata: { formId },
    });

    return { secret };
  }

  async deleteWebhook(orgId: string, formId: string, webhookId: string) {
    await this.verifyFormOrg(orgId, formId);

    const result = await this.prisma.writer.formWebhook.updateMany({
      where: { id: webhookId, formId },
      data: { isActive: false },
    });

    this.audit.log({
      organizationId: orgId,
      action: 'webhook.deleted',
      resource: 'webhook',
      resourceId: webhookId,
      metadata: { formId },
    });

    return result;
  }

  /** Recent delivery attempts, for the integrations UI. */
  async getDeliveries(orgId: string, formId: string, webhookId: string, limit = 50) {
    await this.verifyFormOrg(orgId, formId);

    return this.prisma.reader.webhookDelivery.findMany({
      where: { webhookId, webhook: { formId } },
      orderBy: { deliveredAt: 'desc' },
      take: Math.min(limit, 200),
    });
  }
}
