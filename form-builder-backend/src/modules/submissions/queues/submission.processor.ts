import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { createHash, createHmac } from 'crypto';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { MailService } from '../../mail/mail.service';
import { QUEUE_NAMES, defaultJobOptions } from '../../../config/bullmq.config';
import type { SubmissionPayload } from './submission.producer';
import axios from 'axios';

@Processor(QUEUE_NAMES.SUBMISSIONS, { concurrency: 20 })
export class SubmissionProcessor extends WorkerHost {
  private readonly logger = new Logger(SubmissionProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    @InjectQueue(QUEUE_NAMES.WEBHOOKS) private readonly webhookQueue: Queue,
  ) { super(); }

  async process(job: Job<SubmissionPayload>): Promise<void> {
    const { submissionId, formId, answers, completionTimeMs, respondentIp, userAgent, respondentId, submittedAt } = job.data;
    this.logger.log(`Processing submission ${submissionId}`);

    const formVersion = await this.prisma.reader.formVersion.findFirst({
      where: { form: { id: formId } },
      orderBy: { version: 'desc' },
      select: { id: true, questionsJson: true, form: { select: { title: true, notifyEmails: true } } },
    });

    if (!formVersion) throw new Error(`No published version for form ${formId}`);

    const questions = formVersion.questionsJson as any[];
    let quizScore = 0;
    let maxQuizScore = 0;

    if (Array.isArray(questions)) {
      questions.forEach((q) => {
        if (q.type === 'SECTION_HEADER') return;
        const pts = q.points || 0;
        maxQuizScore += pts;

        if (pts > 0) {
          const userAns = answers[q.id];
          if (q.type === 'SINGLE_CHOICE' || q.type === 'DROPDOWN') {
            const correctOpt = q.options?.find((o: any) => o.isCorrect);
            if (correctOpt && userAns === correctOpt.label) quizScore += pts;
          } else if (q.type === 'MULTI_CHOICE') {
            const correctOpts = q.options?.filter((o: any) => o.isCorrect).map((o: any) => o.label) || [];
            const userArr = (userAns as string[]) || [];
            if (
              correctOpts.length > 0 &&
              correctOpts.every((item: string) => userArr.includes(item)) &&
              userArr.every((item: string) => correctOpts.includes(item))
            ) {
              quizScore += pts;
            }
          }
        }
      });
    }

    const dailySalt = new Date().toISOString().slice(0, 10);
    const respondentIpHash = createHash('sha256').update(respondentIp + dailySalt).digest('hex');

    await this.prisma.writer.formSubmission.create({
      data: {
        id: submissionId,
        formId,
        formVersionId: formVersion.id,
        answers,
        completionTimeMs: completionTimeMs ?? 0,
        quizScore: maxQuizScore > 0 ? quizScore : null,
        maxQuizScore: maxQuizScore > 0 ? maxQuizScore : null,
        respondentIpHash,
        userAgent,
        respondentId,
        status: 'SUBMITTED',
        submittedAt: new Date(submittedAt),
        processedAt: new Date(),
      },
    });

    await this.prisma.writer.$executeRaw`
      INSERT INTO form_analytics (id, form_id, date, submissions, avg_completion_ms)
      VALUES (gen_random_uuid(), ${formId}::uuid, NOW()::date, 1, ${completionTimeMs ?? 0})
      ON CONFLICT (form_id, date) DO UPDATE SET
        submissions       = form_analytics.submissions + 1,
        avg_completion_ms = (form_analytics.avg_completion_ms + EXCLUDED.avg_completion_ms) / 2
    `;

    this.logger.log(`Submission ${submissionId} persisted.`);

    // Send email notifications
    if (formVersion.form.notifyEmails && formVersion.form.notifyEmails.length > 0) {
      this.mailService.sendSubmissionNotificationEmail(
        formVersion.form.notifyEmails,
        formVersion.form.title,
        submissionId,
        answers
      ).catch(e => this.logger.error('Failed to send notification emails', e));
    }

    // Enqueue webhook delivery
    await this.enqueueWebhooks(formId, submissionId, answers);
  }

  private async enqueueWebhooks(formId: string, submissionId: string, answers: any) {
    const webhooks = await this.prisma.reader.formWebhook.findMany({
      where: { formId, isActive: true },
    });

    if (webhooks.length === 0) return;

    const payload = {
      event: 'submission.created',
      formId,
      submissionId,
      answers,
      timestamp: new Date().toISOString(),
    };

    // Enqueue a job for each webhook
    await Promise.all(
      webhooks.map((webhook: any) =>
        this.webhookQueue.add(
          'deliver-webhook',
          { webhookId: webhook.id, submissionId, payload },
          { ...defaultJobOptions, jobId: `webhook-${webhook.id}-${submissionId}` }
        )
      )
    );
  }

}

