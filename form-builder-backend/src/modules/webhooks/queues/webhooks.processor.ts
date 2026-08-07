import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { createHmac } from 'crypto';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { QUEUE_NAMES } from '../../../config/bullmq.config';
import { assertSafeOutboundUrl } from '../../../common/net/url-guard';

export interface WebhookJobPayload {
  webhookId: string;
  submissionId: string;
  payload: Record<string, any>;
}

/** Never store more than this much of a response body. */
const MAX_RESPONSE_CAPTURE = 512;

@Processor(QUEUE_NAMES.WEBHOOKS, { concurrency: 10 })
export class WebhooksProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhooksProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {
    super();
  }

  async process(job: Job<WebhookJobPayload>): Promise<void> {
    const { webhookId, submissionId, payload } = job.data;

    const webhook = await this.prisma.reader.formWebhook.findFirst({
      where: { id: webhookId, isActive: true },
    });

    if (!webhook) {
      this.logger.warn(`Webhook ${webhookId} is missing or inactive; dropping job.`);
      return;
    }

    // Re-validate at DELIVERY time, not only at registration. A hostname that
    // resolved publicly when the webhook was created can be repointed at an
    // internal address later (DNS rebinding).
    try {
      await assertSafeOutboundUrl(webhook.url);
    } catch (err: any) {
      await this.recordDelivery(webhookId, submissionId, {
        statusCode: 0,
        responseBody: `Blocked: ${err?.message ?? 'unsafe destination'}`,
        attempt: job.attemptsMade + 1,
        success: false,
      });
      // Deactivate so we stop retrying a destination we will never allow.
      await this.prisma.writer.formWebhook.update({
        where: { id: webhookId },
        data: { isActive: false },
      });
      this.logger.error(`Webhook ${webhookId} blocked as unsafe; deactivated.`);
      return; // Do NOT throw — retrying a blocked URL is pointless.
    }

    const bodyString = JSON.stringify(payload);
    const secret = this.crypto.decrypt(webhook.secret) ?? webhook.secret;
    const timestamp = Math.floor(Date.now() / 1000);

    // Sign timestamp + body so a captured payload cannot be replayed later.
    const signature = createHmac('sha256', secret)
      .update(`${timestamp}.${bodyString}`)
      .digest('hex');

    let statusCode = 0;
    let responseBody = '';
    let success = false;

    try {
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-FormBuilder-Signature': `t=${timestamp},sha256=${signature}`,
          'X-FormBuilder-Event': 'form.submission.created',
          'X-FormBuilder-Delivery': `${webhookId}-${submissionId}`,
          'User-Agent': 'FormBuilder-Webhook/1.0',
        },
        body: bodyString,
        signal: AbortSignal.timeout(10_000),
        // Manual redirect handling: an automatic 302 to an internal address
        // would bypass every check performed above.
        redirect: 'manual',
      });

      statusCode = response.status;

      if (statusCode >= 300 && statusCode < 400) {
        responseBody = 'Redirect responses are not followed.';
        success = false;
      } else {
        // Capture only a short prefix. The full body was previously stored and
        // readable via the API, which turned any SSRF into a read primitive.
        responseBody = (await response.text()).slice(0, MAX_RESPONSE_CAPTURE);
        success = response.ok;
      }
    } catch (err: any) {
      responseBody = String(err?.message ?? 'request failed').slice(0, MAX_RESPONSE_CAPTURE);
    }

    await this.recordDelivery(webhookId, submissionId, {
      statusCode,
      responseBody,
      attempt: job.attemptsMade + 1,
      success,
    });

    if (!success) throw new Error(`Webhook ${webhookId} failed: HTTP ${statusCode}`);
    this.logger.log(`Webhook ${webhookId} delivered for submission ${submissionId}`);
  }

  private async recordDelivery(
    webhookId: string,
    submissionId: string,
    data: { statusCode: number; responseBody: string; attempt: number; success: boolean },
  ) {
    await this.prisma.writer.webhookDelivery.create({
      data: { webhookId, submissionId, ...data },
    });
  }
}
