import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger, Optional } from '@nestjs/common';
import { Job } from 'bullmq';
import { createHmac } from 'crypto';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { MetricsService } from '../../../common/metrics/metrics.service';
import { QUEUE_NAMES } from '../../../config/bullmq.config';
import { assertSafeOutboundUrl } from '../../../common/net/url-guard';
import { NotificationsService } from '../../notifications/notifications.service';
import { NOTIFICATION_TYPES } from '../../notifications/notification-recipients';

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
    private readonly notifications: NotificationsService,
    // @Optional: see the note in SubmissionProcessor.
    @Optional() private readonly metrics?: MetricsService,
  ) {
    super();
  }

  @OnWorkerEvent('completed')
  onJobCompleted(job: Job) {
    this.metrics?.observeJob(QUEUE_NAMES.WEBHOOKS, job, 'completed');
  }

  @OnWorkerEvent('failed')
  onJobFailed(job?: Job) {
    this.metrics?.observeJob(QUEUE_NAMES.WEBHOOKS, job, 'failed');
  }

  async process(job: Job<WebhookJobPayload>): Promise<void> {
    const { webhookId, submissionId, payload } = job.data;

    const webhook = await this.prisma.reader.formWebhook.findFirst({
      where: { id: webhookId, isActive: true },
      // The form is joined for its organization, which is what decides who
      // hears about a failed delivery. A FormWebhook row carries no
      // organizationId of its own, and inferring one from anywhere else would
      // be a cross-tenant notification waiting to happen.
      include: { form: { select: { organizationId: true, title: true } } },
    });

    if (!webhook) {
      this.logger.warn(
        `Webhook ${webhookId} is missing or inactive; dropping job.`,
      );
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
      // Terminal and silent otherwise. The webhook has just been switched off
      // and will never fire again; an admin who is not told will discover it
      // when someone downstream notices missing data, which can be weeks.
      await this.notifyFailure(webhook, submissionId, {
        reason: `Blocked: ${err?.message ?? 'unsafe destination'}`,
        deactivated: true,
      });
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
    // No initialiser: every path below — redirect, success, and the catch —
    // assigns it before it is read, so an empty-string default could only ever
    // mask a path that forgot to. Let the compiler prove the coverage instead.
    let responseBody: string;
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
      responseBody = String(err?.message ?? 'request failed').slice(
        0,
        MAX_RESPONSE_CAPTURE,
      );
    }

    await this.recordDelivery(webhookId, submissionId, {
      statusCode,
      responseBody,
      attempt: job.attemptsMade + 1,
      success,
    });

    if (!success) {
      // Notify on the LAST attempt only.
      //
      // defaultJobOptions gives every webhook job 5 attempts with exponential
      // backoff, and the overwhelming majority of failures are a transient 502
      // that the second attempt delivers through. Notifying per attempt would
      // send an admin five alerts about one blip and — because attempt 5 is
      // ~16s after attempt 1 — do it fast enough to look like a broken system.
      // Waiting for the retries to be exhausted means every notification sent
      // describes a delivery that genuinely did not happen.
      //
      // `attemptsMade` is the count BEFORE this attempt, which is why the
      // delivery record above stores `attemptsMade + 1`.
      const attempt = job.attemptsMade + 1;
      const maxAttempts = job.opts?.attempts ?? 1;
      if (attempt >= maxAttempts) {
        await this.notifyFailure(webhook, submissionId, {
          reason:
            statusCode > 0
              ? `HTTP ${statusCode}`
              : responseBody || 'no response',
          deactivated: false,
          attempts: attempt,
        });
      }

      throw new Error(`Webhook ${webhookId} failed: HTTP ${statusCode}`);
    }
    this.logger.log(
      `Webhook ${webhookId} delivered for submission ${submissionId}`,
    );
  }

  /**
   * Tell the organization's admins that a webhook is not delivering.
   *
   * Never throws and is always awaited before the caller rethrows: a failure
   * here must not replace the real delivery error in the job's failure record,
   * and must not stop the job being marked failed. `notifyOrganization`
   * swallows its own errors, so the try/catch is belt and braces for the case
   * where the form relation is unexpectedly absent.
   */
  private async notifyFailure(
    webhook: {
      id: string;
      name: string;
      url: string;
      form?: { organizationId: string; title: string } | null;
    },
    submissionId: string,
    detail: { reason: string; deactivated: boolean; attempts?: number },
  ): Promise<void> {
    const organizationId = webhook.form?.organizationId;
    if (!organizationId) return;

    await this.notifications.notifyOrganization({
      organizationId,
      type: NOTIFICATION_TYPES.WEBHOOK_FAILED,
      title: detail.deactivated
        ? `Webhook "${webhook.name}" was disabled`
        : `Webhook "${webhook.name}" is failing`,
      body: detail.deactivated
        ? `Deliveries for "${webhook.form?.title ?? 'a form'}" were stopped because the destination is no longer allowed (${detail.reason}).`
        : `${detail.attempts ?? 0} delivery attempts for "${webhook.form?.title ?? 'a form'}" failed (${detail.reason}). Later submissions will keep trying.`,
      metadata: {
        organizationId,
        webhookId: webhook.id,
        submissionId,
        // The URL is admin-visible on the integrations page already, and
        // without it the notification cannot say WHICH endpoint broke.
        url: webhook.url,
        deactivated: detail.deactivated,
        href: '/integrations',
      },
      // No actor: the failure was caused by the remote endpoint, not a user.
    });
  }

  private async recordDelivery(
    webhookId: string,
    submissionId: string,
    data: {
      statusCode: number;
      responseBody: string;
      attempt: number;
      success: boolean;
    },
  ) {
    await this.prisma.writer.webhookDelivery.create({
      data: { webhookId, submissionId, ...data },
    });
  }
}
