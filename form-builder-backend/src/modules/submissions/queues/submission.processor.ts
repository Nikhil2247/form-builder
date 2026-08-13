import {
  Processor,
  WorkerHost,
  InjectQueue,
  OnWorkerEvent,
} from '@nestjs/bullmq';
import { Logger, Optional } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { MailService } from '../../mail/mail.service';
import { MetricsService } from '../../../common/metrics/metrics.service';
import { QUEUE_NAMES, defaultJobOptions } from '../../../config/bullmq.config';
import type { SubmissionPayload } from './submission.producer';

@Processor(QUEUE_NAMES.SUBMISSIONS, { concurrency: 20 })
export class SubmissionProcessor extends WorkerHost {
  private readonly logger = new Logger(SubmissionProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    @InjectQueue(QUEUE_NAMES.WEBHOOKS) private readonly webhookQueue: Queue,
    @InjectQueue(QUEUE_NAMES.FILE_VERIFY)
    private readonly fileVerifyQueue: Queue,
    // @Optional so this consumer still starts if MetricsModule is not imported.
    // Instrumentation must never be the reason a queue stops draining.
    @Optional() private readonly metrics?: MetricsService,
  ) {
    super();
  }

  // ── Job-duration metrics ──────────────────────────────────────────────────
  // Read off the job's own processedOn/finishedOn stamps rather than timed
  // here, so the histogram measures processing and excludes queue wait — the
  // distinction between "make the handler faster" and "add replicas".
  @OnWorkerEvent('completed')
  onJobCompleted(job: Job) {
    this.metrics?.observeJob(QUEUE_NAMES.SUBMISSIONS, job, 'completed');
  }

  @OnWorkerEvent('failed')
  onJobFailed(job?: Job) {
    this.metrics?.observeJob(QUEUE_NAMES.SUBMISSIONS, job, 'failed');
  }

  async process(job: Job<SubmissionPayload>): Promise<void> {
    const {
      submissionId,
      formId,
      formVersionId,
      answers,
      completionTimeMs,
      respondentIpHash,
      userAgent,
      respondentId,
      submittedAt,
      organizationId,
      subjectId,
    } = job.data;

    this.logger.log(`Processing submission ${submissionId}`);

    // Bind to the EXACT version the respondent filled, resolved at ingest time.
    // Previously this took `orderBy: { version: 'desc' }`, so publishing a new
    // version mid-flight silently re-attributed in-flight answers to it.
    const formVersion = await this.prisma.reader.formVersion.findUnique({
      where: { id: formVersionId },
      select: {
        id: true,
        questionsJson: true,
        form: {
          select: {
            title: true,
            notifyEmails: true,
            isQuizMode: true,
            subjectRole: true,
            subjectTypeId: true,
            subjectType: { select: { id: true, identityConfig: true } },
          },
        },
      },
    });

    if (!formVersion) {
      // Unrecoverable: retrying cannot conjure a deleted version. Throwing here
      // sends the job to the failed set for inspection rather than looping.
      throw new Error(
        `Form version ${formVersionId} not found for submission ${submissionId}`,
      );
    }

    const questions = formVersion.questionsJson as any[];

    // ── Already persisted? ──────────────────────────────────────────────────
    // Two callers reach this worker with a row that already exists:
    //
    //   • a FORM-APP SESSION submit, which must create every entry's submission
    //     inside ONE transaction — a report where some school visits landed and
    //     others did not is worse than a rejected one — and then hands the
    //     side effects here;
    //   • a RETRY, after the job failed somewhere past the commit. Without this
    //     check the retry died on the primary key and the side effects were
    //     never performed at all, which is the exact failure retries exist for.
    //
    // In both cases the answers of record are the stored ones, not the payload's.
    const existing = await this.prisma.reader.formSubmission.findUnique({
      where: { id: submissionId },
      select: { id: true, answers: true, subjectId: true },
    });

    if (existing) {
      const storedAnswers = (existing.answers ?? {}) as Record<string, any>;
      this.logger.log(
        `Submission ${submissionId} already persisted; running side effects only.`,
      );
      await this.runSideEffects({
        formId,
        submissionId,
        questions,
        answers: storedAnswers,
        formTitle: formVersion.form.title,
        notifyEmails: formVersion.form.notifyEmails,
      });
      return;
    }

    const grade = formVersion.form.isQuizMode
      ? gradeQuiz(questions, answers)
      : { score: null, max: null, passed: null };

    // ── Persist submission + subject + analytics atomically ─────────────────
    // Subject creation belongs INSIDE this transaction. If the submission
    // committed and the subject creation then failed, the registration entry
    // would exist with no record attached to it and no way to tell, after the
    // fact, that one was ever meant to exist.
    await this.prisma.writer.$transaction(async (tx: any) => {
      const form = formVersion.form as any;
      let resolvedSubjectId: string | null = subjectId ?? null;

      if (
        form.subjectRole === 'REGISTERS' &&
        form.subjectTypeId &&
        !resolvedSubjectId
      ) {
        const identity = buildSubjectIdentity(
          form.subjectType?.identityConfig ?? {},
          questions,
          answers,
        );

        const subject = await tx.subject.create({
          data: {
            organizationId,
            subjectTypeId: form.subjectTypeId,
            displayName: identity.displayName,
            attributes: identity.attributes,
            externalId: identity.externalId,
            registrationSubmissionId: submissionId,
          },
        });

        resolvedSubjectId = subject.id;
      }

      await tx.formSubmission.create({
        data: {
          id: submissionId,
          formId,
          formVersionId,
          organizationId,
          subjectId: resolvedSubjectId,
          answers,
          completionTimeMs: completionTimeMs ?? 0,
          quizScore: grade.score,
          maxQuizScore: grade.max,
          isPassed: grade.passed,
          respondentIpHash,
          userAgent,
          respondentId,
          status: 'SUBMITTED',
          submittedAt: new Date(submittedAt),
          processedAt: new Date(),
        },
      });

      // Running a true mean requires the sum, not (old + new) / 2 — the previous
      // formula was an exponential recency-weighted average that drifted badly.
      await tx.$executeRaw`
        INSERT INTO form_analytics (id, form_id, date, submissions, sum_completion_ms, avg_completion_ms)
        VALUES (gen_random_uuid(), ${formId}::uuid, NOW()::date, 1, ${completionTimeMs ?? 0}, ${completionTimeMs ?? 0})
        ON CONFLICT (form_id, date) DO UPDATE SET
          submissions       = form_analytics.submissions + 1,
          sum_completion_ms = form_analytics.sum_completion_ms + EXCLUDED.sum_completion_ms,
          avg_completion_ms = (form_analytics.sum_completion_ms + EXCLUDED.sum_completion_ms)
                              / GREATEST(form_analytics.submissions + 1, 1)
      `;
    });

    this.logger.log(`Submission ${submissionId} persisted.`);

    await this.runSideEffects({
      formId,
      submissionId,
      questions,
      answers,
      formTitle: formVersion.form.title,
      notifyEmails: formVersion.form.notifyEmails,
    });
  }

  /**
   * Everything that happens once a submission is safely committed.
   *
   * Deliberately AFTER the transaction and individually guarded: a failing mail
   * server must not roll back (or endlessly re-insert) the submission. Split
   * into its own method so the already-persisted path above runs exactly this
   * and nothing else.
   */
  private async runSideEffects(input: {
    formId: string;
    submissionId: string;
    questions: any[];
    answers: Record<string, any>;
    formTitle: string;
    notifyEmails: unknown;
  }) {
    await this.linkAndVerifyFiles(
      input.questions,
      input.answers,
      input.submissionId,
    );
    await this.enqueueWebhooks(input.formId, input.submissionId, input.answers);

    const notifyEmails = Array.isArray(input.notifyEmails)
      ? input.notifyEmails.filter((e): e is string => typeof e === 'string')
      : [];

    if (notifyEmails.length > 0) {
      this.mailService
        .sendSubmissionNotificationEmail(
          notifyEmails,
          input.formTitle,
          input.submissionId,
          input.answers,
        )
        .catch((e) =>
          this.logger.error('Failed to send notification emails', e),
        );
    }
  }

  /**
   * Attach uploaded files to this submission and queue verification.
   *
   * Nothing previously set FormSubmissionFile.submissionId, so every uploaded
   * file was orphaned: never linked, never verified, never counted against the
   * org's storage quota, and never cleanable.
   */
  private async linkAndVerifyFiles(
    questions: any[],
    answers: Record<string, any>,
    submissionId: string,
  ) {
    const fileIds: string[] = [];
    for (const q of questions ?? []) {
      if (q?.type !== 'FILE_UPLOAD') continue;
      const val = answers[q.id];
      if (!val) continue;
      if (Array.isArray(val))
        fileIds.push(...val.filter((v) => typeof v === 'string'));
      else if (typeof val === 'string') fileIds.push(val);
    }

    if (fileIds.length === 0) return;

    try {
      await this.prisma.writer.formSubmissionFile.updateMany({
        where: { id: { in: fileIds }, submissionId: null },
        data: { submissionId },
      });

      await Promise.all(
        fileIds.map((fileId) =>
          this.fileVerifyQueue.add(
            'verify-file',
            { fileId, submissionId },
            { ...defaultJobOptions, jobId: `verify-${fileId}` },
          ),
        ),
      );
    } catch (err) {
      this.logger.error(
        `Failed to link/verify files for submission ${submissionId}`,
        err,
      );
    }
  }

  private async enqueueWebhooks(
    formId: string,
    submissionId: string,
    answers: any,
  ) {
    const webhooks = await this.prisma.reader.formWebhook.findMany({
      where: { formId, isActive: true },
      select: { id: true },
    });

    if (webhooks.length === 0) return;

    const payload = {
      event: 'submission.created',
      formId,
      submissionId,
      answers,
      timestamp: new Date().toISOString(),
    };

    await Promise.all(
      webhooks.map((webhook) =>
        this.webhookQueue.add(
          'deliver-webhook',
          { webhookId: webhook.id, submissionId, payload },
          {
            ...defaultJobOptions,
            jobId: `webhook-${webhook.id}-${submissionId}`,
          },
        ),
      ),
    );
  }
}

/**
 * Auto-grade a quiz submission.
 *
 * Options may be authored as strings or { label, value } objects, and the runner
 * has historically submitted either form — accept both rather than silently
 * scoring every answer as wrong.
 */
function gradeQuiz(questions: any[], answers: Record<string, any>) {
  let score = 0;
  let max = 0;
  let passingScore: number | null = null;

  for (const q of questions ?? []) {
    if (!q || q.type === 'SECTION_HEADER') continue;

    if (typeof q.passingScore === 'number') passingScore = q.passingScore;

    const pts = Number(q.points) || 0;
    if (pts <= 0) continue;
    max += pts;

    const given = answers[q.id];
    if (given == null) continue;

    const correct = correctValues(q);
    if (correct.size === 0) continue;

    if (q.type === 'SINGLE_CHOICE' || q.type === 'DROPDOWN') {
      if (typeof given === 'string' && correct.has(given)) score += pts;
    } else if (q.type === 'MULTI_CHOICE') {
      const chosen = Array.isArray(given)
        ? given.filter((g) => typeof g === 'string')
        : [];
      // Exact set match: every correct option chosen, nothing extra.
      const allChosen = [...correct].every((c) => chosen.includes(c));
      const noExtras = chosen.every((c) => correct.has(c));
      if (allChosen && noExtras && chosen.length > 0) score += pts;
    }
  }

  return {
    score: max > 0 ? score : null,
    max: max > 0 ? max : null,
    passed: max > 0 && passingScore != null ? score >= passingScore : null,
  };
}

function correctValues(q: any): Set<string> {
  const out = new Set<string>();
  for (const o of q.options ?? []) {
    if (!o || typeof o !== 'object' || !o.isCorrect) continue;
    if (typeof o.value === 'string') out.add(o.value);
    if (typeof o.label === 'string') out.add(o.label);
  }
  return out;
}

/**
 * Project a registration submission's identity fields onto the new Subject.
 *
 * `identityConfig` names question KEYS while answers are stored by question ID,
 * so the version's questions translate between them. Keys are used because a
 * form can be re-published with new question ids for the same logical field,
 * and this configuration has to survive that.
 *
 * Duplicated deliberately rather than imported from SubjectsService: the worker
 * runs in a separate process (PROCESS_ROLE=worker) and importing a service
 * would drag its whole Nest dependency graph into the queue runtime.
 */
function buildSubjectIdentity(
  identityConfig: {
    displayName?: string[];
    attributes?: string[];
    externalId?: string;
  },
  questions: any[],
  answers: Record<string, any>,
): {
  displayName: string;
  attributes: Record<string, any>;
  externalId: string | null;
} {
  const idByKey = new Map<string, string>();
  for (const question of questions ?? []) {
    if (!question || typeof question.id !== 'string') continue;
    const key =
      typeof question.key === 'string' && question.key
        ? question.key
        : question.id;
    if (!idByKey.has(key)) idByKey.set(key, question.id);
  }

  const valueOf = (key: string): any => {
    const id = idByKey.get(key);
    return id ? answers[id] : undefined;
  };

  const nameParts = (identityConfig.displayName ?? [])
    .map(valueOf)
    .filter((v) => v !== undefined && v !== null && v !== '')
    .map((v) => (Array.isArray(v) ? v.join(' ') : String(v)));

  const attributes: Record<string, any> = {};
  for (const key of identityConfig.attributes ?? []) {
    const value = valueOf(key);
    if (value !== undefined) attributes[key] = value;
  }

  const rawExternal = identityConfig.externalId
    ? valueOf(identityConfig.externalId)
    : undefined;

  return {
    // A nameless record is unusable in a search list, so fall back to something
    // stable rather than storing an empty string.
    displayName: nameParts.join(' ').trim().slice(0, 200) || 'Unnamed record',
    attributes,
    externalId:
      rawExternal === undefined || rawExternal === null || rawExternal === ''
        ? null
        : String(rawExternal).slice(0, 100),
  };
}
