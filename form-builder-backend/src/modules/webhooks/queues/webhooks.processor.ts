import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { createHmac } from 'crypto';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { QUEUE_NAMES } from '../../../config/bullmq.config';

export interface WebhookJobPayload {
  webhookId: string;
  submissionId: string;
  payload: Record<string, any>;
}

@Processor(QUEUE_NAMES.WEBHOOKS, { concurrency: 10 })
export class WebhooksProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhooksProcessor.name);

  constructor(private readonly prisma: PrismaService) { super(); }

  async process(job: Job<WebhookJobPayload>): Promise<void> {
    const { webhookId, submissionId, payload } = job.data;

    const webhook = await this.prisma.reader.formWebhook.findUniqueOrThrow({
      where: { id: webhookId, isActive: true },
    });

    const bodyString = JSON.stringify(payload);
    const signature = createHmac('sha256', webhook.secret).update(bodyString).digest('hex');

    let statusCode = 0;
    let responseBody = '';
    let success = false;

    try {
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-FormBuilder-Signature': `sha256=${signature}`,
          'X-FormBuilder-Event': 'form.submission.created',
          'User-Agent': 'FormBuilder-Webhook/1.0',
        },
        body: bodyString,
        signal: AbortSignal.timeout(10_000),
      });
      statusCode = response.status;
      responseBody = (await response.text()).slice(0, 2000);
      success = response.ok;
    } catch (err: any) {
      responseBody = err.message;
    }

    await this.prisma.writer.webhookDelivery.create({
      data: { webhookId, submissionId, statusCode, responseBody, attempt: job.attemptsMade + 1, success },
    });

    if (!success) throw new Error(`Webhook ${webhookId} failed: HTTP ${statusCode}`);
    this.logger.log(`Webhook ${webhookId} delivered for submission ${submissionId}`);
  }
}
