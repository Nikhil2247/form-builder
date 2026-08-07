import {
  Injectable,
  BadRequestException,
  Logger,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { createHash, randomUUID } from 'crypto';
import { SubmissionProducer, SubmissionPayload } from './queues/submission.producer';
import { SubmitFormDto } from './dto/submit-form.dto';
import { AnswerValidatorService } from './answer-validator.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import {
  parsePagination,
  paginated,
  type Pagination,
} from '../../common/pagination/pagination';
import { submissionListSelect } from '../../common/prisma/selects';

/**
 * Everything the ingest path needs to accept or reject a submission, cached in
 * Redis so the hot path does not hit Postgres.
 */
interface IngestPolicy {
  formId: string;
  organizationId: string;
  orgIsActive: boolean;
  status: string;
  isDeleted: boolean;
  expiresAt: string | null;
  maxSubmissions: number | null;
  requireAuth: boolean;
  isPasswordProtected: boolean;
  passwordHash: string | null;
  allowMultiple: boolean;
  maxSubmissionsMonth: number;
  currentVersionId: string | null;
  currentVersion: number;
  questionsJson: unknown;
}

const POLICY_TTL_SECONDS = 300;

@Injectable()
export class SubmissionsService {
  private readonly logger = new Logger(SubmissionsService.name);

  constructor(
    private readonly producer: SubmissionProducer,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly validator: AnswerValidatorService,
  ) {}

  // ══════════════════════════════════════════════════════════════════════════
  // INGEST
  // ══════════════════════════════════════════════════════════════════════════

  async submitForm(
    formId: string,
    dto: SubmitFormDto,
    ip: string,
    userAgent?: string,
    userId?: string,
  ) {
    // ── 1. Cheap bot checks first (no I/O) ──────────────────────────────────
    if (dto.honeypot && dto.honeypot.trim() !== '') {
      this.logger.warn(`Spam detected via honeypot on form ${formId} from ${maskIp(ip)}`);
      // Return a success-shaped response: telling a bot it was detected just
      // teaches the operator to fix their bot.
      return { submissionId: randomUUID(), status: 'ENQUEUED' };
    }

    // ── 2. Load the form's ingest policy (Redis-cached) ─────────────────────
    const policy = await this.loadIngestPolicy(formId);
    if (!policy) throw new NotFoundException('Form not found');

    // ── 3. Access control. None of this was previously enforced, so drafts,
    //       archived, expired, deleted, auth-required and password-protected
    //       forms all accepted public submissions. ────────────────────────────
    if (policy.isDeleted) throw new NotFoundException('Form not found');

    if (!policy.orgIsActive) {
      throw new ForbiddenException('This form is currently unavailable.');
    }

    if (policy.status !== 'PUBLISHED') {
      throw new ForbiddenException(
        policy.status === 'CLOSED'
          ? 'This form is no longer accepting responses.'
          : 'This form is not accepting responses.',
      );
    }

    if (policy.expiresAt && new Date(policy.expiresAt) < new Date()) {
      throw new ForbiddenException('This form has expired.');
    }

    if (policy.requireAuth && !userId) {
      throw new UnauthorizedException('You must be signed in to submit this form.');
    }

    if (policy.isPasswordProtected) {
      if (!dto.formPassword) {
        throw new UnauthorizedException('This form requires a password.');
      }
      const ok =
        !!policy.passwordHash && (await argon2.verify(policy.passwordHash, dto.formPassword));
      if (!ok) throw new UnauthorizedException('Incorrect form password.');
    }

    if (!policy.currentVersionId) {
      throw new ForbiddenException('This form has not been published yet.');
    }

    // ── 4. Version binding ──────────────────────────────────────────────────
    // Trust the client's version only after confirming it belongs to this form;
    // otherwise fall back to the form's current version.
    let formVersionId = policy.currentVersionId;
    let questionsJson = policy.questionsJson;

    if (dto.formVersionId && dto.formVersionId !== policy.currentVersionId) {
      const claimed = await this.prisma.reader.formVersion.findFirst({
        where: { id: dto.formVersionId, formId },
        select: { id: true, questionsJson: true },
      });
      if (!claimed) {
        throw new BadRequestException('Unknown form version for this form.');
      }
      formVersionId = claimed.id;
      questionsJson = claimed.questionsJson;
    }

    // ── 5. CAPTCHA ──────────────────────────────────────────────────────────
    await this.verifyCaptcha(dto.captchaToken, ip, formId);

    // ── 6. Schema validation. Runs here, synchronously, so the respondent
    //       gets an actionable field-level error instead of a silent failure
    //       inside a worker they never see. ────────────────────────────────────
    const result = this.validator.validate(questionsJson, dto.answers);
    if (!result.valid) {
      throw new UnprocessableEntityException({
        message: 'Some answers are invalid.',
        issues: result.issues,
      });
    }

    // ── 7. File references must belong to this form and be real ─────────────
    await this.assertFileReferencesValid(result.sanitized, questionsJson, formId);

    // ── 8. Duplicate prevention ─────────────────────────────────────────────
    const dailySalt = new Date().toISOString().slice(0, 10);
    const respondentIpHash = createHash('sha256').update(ip + dailySalt).digest('hex');

    if (!policy.allowMultiple) {
      await this.assertNotDuplicate(formId, respondentIpHash, dto.fingerprint, userId);
    }

    // ── 9. Quotas — Redis counters, not COUNT(*) ────────────────────────────
    await this.assertWithinMonthlyQuota(policy);
    await this.assertWithinFormCap(policy);

    // ── 10. Enqueue ─────────────────────────────────────────────────────────
    const submissionId = randomUUID();

    const payload: SubmissionPayload = {
      submissionId,
      formId,
      formVersionId,
      organizationId: policy.organizationId,
      answers: result.sanitized,
      completionTimeMs: dto.completionTimeMs ?? 0,
      respondentIpHash,
      userAgent,
      respondentId: userId,
      submittedAt: new Date().toISOString(),
    };

    await this.producer.enqueue(payload);

    return { submissionId, status: 'ENQUEUED' };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // INGEST POLICY CACHE
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * The submit endpoint previously ran two Postgres queries per request — a form
   * lookup and a COUNT(*) across the org's entire submission history. At any
   * real ingest rate that is the binding constraint. This caches the decision
   * inputs; FormsService invalidates the key on publish/update/delete/restore.
   */
  private async loadIngestPolicy(formId: string): Promise<IngestPolicy | null> {
    const cacheKey = `ingest_policy:${formId}`;

    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) return JSON.parse(cached) as IngestPolicy;
    } catch (err) {
      this.logger.warn('Redis read failed for ingest policy; falling back to DB', err as any);
    }

    const form = await this.prisma.reader.form.findUnique({
      where: { id: formId },
      select: {
        id: true,
        organizationId: true,
        status: true,
        deletedAt: true,
        expiresAt: true,
        maxSubmissions: true,
        requireAuth: true,
        isPasswordProtected: true,
        passwordHash: true,
        allowMultiple: true,
        currentVersion: true,
        organization: { select: { isActive: true, maxSubmissionsMonth: true } },
        versions: {
          orderBy: { version: 'desc' },
          take: 5,
          select: { id: true, version: true, questionsJson: true },
        },
      },
    });

    if (!form) return null;

    const active =
      form.versions.find((v) => v.version === form.currentVersion) ?? form.versions[0] ?? null;

    const policy: IngestPolicy = {
      formId: form.id,
      organizationId: form.organizationId,
      orgIsActive: form.organization.isActive,
      status: form.status,
      isDeleted: form.deletedAt !== null,
      expiresAt: form.expiresAt ? form.expiresAt.toISOString() : null,
      maxSubmissions: form.maxSubmissions,
      requireAuth: form.requireAuth,
      isPasswordProtected: form.isPasswordProtected,
      passwordHash: form.passwordHash,
      allowMultiple: form.allowMultiple,
      maxSubmissionsMonth: form.organization.maxSubmissionsMonth,
      currentVersionId: active?.id ?? null,
      currentVersion: form.currentVersion,
      questionsJson: active?.questionsJson ?? [],
    };

    try {
      await this.redis.set(cacheKey, JSON.stringify(policy), POLICY_TTL_SECONDS);
    } catch (err) {
      this.logger.warn('Redis write failed for ingest policy', err as any);
    }

    return policy;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // QUOTAS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Monthly org quota via a Redis counter.
   *
   * Replaces `formSubmission.count({ where: { form: { organizationId }, ... } })`
   * which was a join + aggregate over the org's whole submission history,
   * executed synchronously on every public submission.
   *
   * The counter is authoritative for admission control; a nightly reconcile job
   * should reseed it from the database to correct any drift.
   */
  private async assertWithinMonthlyQuota(policy: IngestPolicy) {
    const period = new Date().toISOString().slice(0, 7); // YYYY-MM
    const key = `quota:sub:${policy.organizationId}:${period}`;

    try {
      const used = await this.redis.incr(key);
      if (used === 1) {
        // ~40 days: comfortably past month end, so the key self-expires.
        await this.redis.expire(key, 60 * 60 * 24 * 40);
      }
      if (used > policy.maxSubmissionsMonth) {
        await this.redis.decr(key); // don't let rejected attempts inflate usage
        throw new ForbiddenException(
          'Monthly submission limit reached for this organization.',
        );
      }
    } catch (err) {
      if (err instanceof ForbiddenException) throw err;
      // Redis unavailable: fail OPEN. Losing a customer's responses is worse
      // than briefly overshooting a soft quota.
      this.logger.error('Quota counter unavailable; allowing submission', err as any);
    }
  }

  /** Per-form maxSubmissions cap, and auto-close once reached. */
  private async assertWithinFormCap(policy: IngestPolicy) {
    if (!policy.maxSubmissions) return;

    const key = `quota:form:${policy.formId}`;
    try {
      let used = await this.redis.incr(key);

      // First increment after a cache miss: seed from the database so a Redis
      // restart cannot silently reset a form's cap to zero.
      if (used === 1) {
        const actual = await this.prisma.reader.formSubmission.count({
          where: { formId: policy.formId, status: 'SUBMITTED' },
        });
        if (actual > 0) {
          await this.redis.set(key, String(actual + 1));
          used = actual + 1;
        }
        await this.redis.expire(key, 60 * 60 * 24 * 30);
      }

      if (used > policy.maxSubmissions) {
        await this.redis.decr(key);
        // Reflect the terminal state in the database so the UI and the public
        // page agree with the ingest decision.
        await this.prisma.writer.form
          .updateMany({
            where: { id: policy.formId, status: 'PUBLISHED' },
            data: { status: 'CLOSED' },
          })
          .catch(() => undefined);
        await this.redis.del(`ingest_policy:${policy.formId}`).catch(() => undefined);

        throw new ForbiddenException('This form is no longer accepting responses.');
      }
    } catch (err) {
      if (err instanceof ForbiddenException) throw err;
      this.logger.error('Form cap counter unavailable; allowing submission', err as any);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ══════════════════════════════════════════════════════════════════════════

  private async verifyCaptcha(token: string | undefined, ip: string, formId: string) {
    const secret = process.env.CLOUDFLARE_TURNSTILE_SECRET;
    if (!secret) return; // not configured — skip

    if (!token) throw new BadRequestException('CAPTCHA verification required');

    try {
      const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret, response: token, remoteip: ip }),
        signal: AbortSignal.timeout(5000),
      });
      const data: any = await res.json();
      if (!data.success) {
        this.logger.warn(`CAPTCHA failed for form ${formId} from ${maskIp(ip)}`);
        throw new BadRequestException('CAPTCHA verification failed');
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      // Network error contacting Cloudflare. Fail CLOSED: the operator enabled
      // CAPTCHA deliberately, so bypassing it on error defeats the purpose.
      this.logger.error('Error verifying CAPTCHA', err as any);
      throw new BadRequestException('CAPTCHA verification unavailable, please retry');
    }
  }

  /**
   * A FILE_UPLOAD answer carries a FormSubmissionFile id. Confirm every id
   * exists, is not already attached to another submission, and was issued for
   * this form — otherwise a caller could attach another tenant's file to their
   * own submission and read it back through the submissions API.
   */
  private async assertFileReferencesValid(
    answers: Record<string, any>,
    questionsJson: unknown,
    formId: string,
  ) {
    const questions = Array.isArray(questionsJson) ? (questionsJson as any[]) : [];
    const fileQuestionIds = new Set(
      questions.filter((q) => q?.type === 'FILE_UPLOAD').map((q) => q.id),
    );
    if (fileQuestionIds.size === 0) return;

    const ids: string[] = [];
    for (const qid of fileQuestionIds) {
      const val = answers[qid];
      if (!val) continue;
      if (Array.isArray(val)) ids.push(...val.filter((v) => typeof v === 'string'));
      else if (typeof val === 'string') ids.push(val);
    }
    if (ids.length === 0) return;

    const files = await this.prisma.reader.formSubmissionFile.findMany({
      where: { id: { in: ids } },
      select: { id: true, objectKey: true, submissionId: true },
    });

    if (files.length !== ids.length) {
      throw new BadRequestException('One or more uploaded files could not be found.');
    }

    for (const f of files) {
      if (f.submissionId) {
        throw new BadRequestException('A referenced file is already attached to a submission.');
      }
      // Object keys embed the form id: uploads/org_{orgId}/form_{formId}/...
      if (!f.objectKey.includes(`/form_${formId}/`)) {
        throw new BadRequestException('A referenced file does not belong to this form.');
      }
    }
  }

  private async assertNotDuplicate(
    formId: string,
    respondentIpHash: string,
    fingerprint?: string,
    userId?: string,
  ) {
    // A signed-in respondent is the strongest signal available.
    if (userId) {
      const existing = await this.prisma.reader.formSubmission.findFirst({
        where: { formId, respondentId: userId, status: { not: 'DELETED' } },
        select: { id: true },
      });
      if (existing) {
        throw new ForbiddenException('You have already responded to this form.');
      }
      return;
    }

    // Anonymous: fingerprint first (survives shared NAT), then the daily-salted
    // IP hash as a weaker backstop.
    const marker = fingerprint
      ? `dedupe:${formId}:fp:${createHash('sha256').update(fingerprint).digest('hex')}`
      : `dedupe:${formId}:ip:${respondentIpHash}`;

    try {
      const client = this.redis.getClient();
      // SET NX: only succeeds if the marker is absent.
      const ok = await client.set(marker, '1', 'EX', 60 * 60 * 24 * 30, 'NX');
      if (ok === null) {
        throw new ForbiddenException('You have already responded to this form.');
      }
    } catch (err) {
      if (err instanceof ForbiddenException) throw err;
      this.logger.warn('Duplicate check unavailable; allowing submission', err as any);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // READ
  // ══════════════════════════════════════════════════════════════════════════

  async listSubmissions(
    orgId: string,
    pagination: Pagination = parsePagination(),
    search?: string,
  ) {
    const where: any = { form: { organizationId: orgId }, status: { not: 'DELETED' } };

    if (search?.trim()) {
      const term = search.trim();
      // Previously filtered on a non-existent `submissionId` column, so any
      // search threw. Search the fields that actually exist, plus the answer
      // payload via the GIN index on `answers`.
      where.OR = [
        { form: { organizationId: orgId, title: { contains: term, mode: 'insensitive' } } },
        ...(isUuid(term) ? [{ id: term }] : []),
        { answers: { string_contains: term } },
      ];
    }

    const [submissions, total] = await Promise.all([
      this.prisma.reader.formSubmission.findMany({
        where,
        skip: pagination.skip,
        take: pagination.take,
        orderBy: [{ submittedAt: 'desc' }, { id: 'asc' }],
        // No `answers` here. The org-wide list shows respondent, form, status
        // and time — the previous `include` shipped every answer payload on the
        // page, which on a 50-row page of long-form surveys was the single
        // largest response the API produced.
        select: {
          ...submissionListSelect,
          form: { select: { id: true, title: true, slug: true } },
        },
      }),
      this.prisma.reader.formSubmission.count({ where }),
    ]);

    return paginated('submissions', submissions, pagination, total);
  }
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

/** Never log a full IP — these logs are retained and the raw IP is PII. */
function maskIp(ip: string): string {
  const parts = ip.split('.');
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.x.x` : 'ip';
}
