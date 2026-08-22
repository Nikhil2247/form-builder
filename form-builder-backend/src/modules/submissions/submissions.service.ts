import {
  Injectable,
  BadRequestException,
  ConflictException,
  Logger,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { createHash, randomUUID } from 'crypto';
import {
  SubmissionProducer,
  SubmissionPayload,
} from './queues/submission.producer';
import { SubmitFormDto } from './dto/submit-form.dto';
import { AnswerValidatorService } from './answer-validator.service';
import { PrismaService } from '../../common/infra/prisma/prisma.service';
import { RedisService } from '../../common/infra/redis/redis.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import {
  parsePagination,
  paginated,
  type Pagination,
} from '../../common/http/pagination/pagination';
import {
  submissionDetailSelect,
  submissionListSelect,
  userSummarySelect,
} from '../../common/infra/prisma/selects';
import { ReviewSubmissionDto } from './dto/review-submission.dto';
import { BulkSubmissionsDto } from './dto/bulk-submissions.dto';
import {
  assertAllBulkIdsAuthorized,
  assertStatusTransition,
  normaliseBulkIds,
} from './submission-review.policy';
import { SubmissionStatus } from '@prisma/client';
import {
  readPlan,
  planIsEmpty,
  runFormRules,
  planLookupRequests,
  resolveLookupBag,
  type CompiledPlan,
  type RuleValue,
} from '../../common/rules';
import { ChoiceListsService } from '../choice-lists/choice-lists.service';
import type {
  ResolvedChoiceItem,
  ValidationIssue,
} from './answer-validator.service';
import {
  hiddenByLegacyLogic,
  type LegacyLogicRule,
} from '../../common/legacy-logic';
import { resolveReferences } from '../subjects/subjects.service';

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
  /// FormVersion.compiledRules. Cached with the rest of the policy so the
  /// submit path stays a single Redis read.
  compiledRules: unknown;
  /// FormVersion.logicJson — the legacy show/hide rules.
  ///
  /// The submit path never loaded these, so `visibleQuestionIds` was derived
  /// from the compiled plan alone and a question hidden by a legacy HIDE rule
  /// was still treated as visible. If it was also required, the submission was
  /// rejected for a field the respondent was never shown.
  logicJson: unknown;
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
    private readonly choiceLists: ChoiceListsService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
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
      this.logger.warn(
        `Spam detected via honeypot on form ${formId} from ${maskIp(ip)}`,
      );
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
      throw new UnauthorizedException(
        'You must be signed in to submit this form.',
      );
    }

    if (policy.isPasswordProtected) {
      if (!dto.formPassword) {
        throw new UnauthorizedException('This form requires a password.');
      }
      const ok =
        !!policy.passwordHash &&
        (await argon2.verify(policy.passwordHash, dto.formPassword));
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
    let compiledRules = policy.compiledRules;
    let logicJson = policy.logicJson;

    if (dto.formVersionId && dto.formVersionId !== policy.currentVersionId) {
      const claimed = await this.prisma.reader.formVersion.findFirst({
        where: { id: dto.formVersionId, formId },
        select: {
          id: true,
          questionsJson: true,
          compiledRules: true,
          logicJson: true,
        },
      });
      if (!claimed) {
        throw new BadRequestException('Unknown form version for this form.');
      }
      formVersionId = claimed.id;
      questionsJson = claimed.questionsJson;
      // Rules travel with the version the respondent actually filled in. Using
      // the current version's rules against an older schema would evaluate
      // formulas over fields that version may not even have.
      compiledRules = claimed.compiledRules;
      logicJson = claimed.logicJson;
    }

    // ── 5. CAPTCHA ──────────────────────────────────────────────────────────
    await this.verifyCaptcha(dto.captchaToken, ip, formId);

    // ── 6. Schema validation. Runs here, synchronously, so the respondent
    //       gets an actionable field-level error instead of a silent failure
    //       inside a worker they never see. ────────────────────────────────────
    //       Rules run FIRST, because they decide three things validation needs:
    //       what the calculated values actually are, which questions are
    //       visible, and which are conditionally required.
    //
    //       Critically, runFormRules drops every client-supplied value for a
    //       calculated field and recomputes it. A respondent posting
    //       {"age": 4} to clear an eligibility gate changes nothing.
    // The subject this entry attaches to, if any. Verified against the form's
    // own org AND subject type — a client-supplied id is otherwise a direct
    // route into another tenant's records.
    const subjectId = await this.resolveSubjectId(
      formId,
      policy.organizationId,
      dto.subjectId,
    );

    const prepared = await this.prepareAnswers({
      organizationId: policy.organizationId,
      formId,
      formVersionId,
      questionsJson,
      logicJson,
      compiledRules,
      answers: dto.answers,
      subjectId,
    });

    if (prepared.issues.length > 0) {
      throw new UnprocessableEntityException({
        message: 'Some answers are invalid.',
        issues: prepared.issues,
      });
    }

    const result = { sanitized: prepared.sanitized };

    // ── 7. File references must belong to this form and be real ─────────────
    await this.assertFileReferencesValid(
      result.sanitized,
      questionsJson,
      formId,
    );

    // ── 8. Duplicate prevention ─────────────────────────────────────────────
    const dailySalt = new Date().toISOString().slice(0, 10);
    const respondentIpHash = createHash('sha256')
      .update(ip + dailySalt)
      .digest('hex');

    if (!policy.allowMultiple) {
      await this.assertNotDuplicate(
        formId,
        respondentIpHash,
        dto.fingerprint,
        userId,
      );
    }

    // ── 9. Quotas — Redis counters, not COUNT(*) ────────────────────────────
    //
    // Both counters CLAIM a slot up front, so anything that fails after this
    // point has to give it back. Without the rollback, a form sitting at its
    // own cap burned a slot of the organization's MONTHLY allowance on every
    // rejected attempt — the monthly counter had already been incremented and
    // nothing put it back. A bot hammering a closed form could therefore
    // exhaust an unrelated quota for the rest of the month, and the same leak
    // applied to any enqueue failure.
    await this.assertWithinMonthlyQuota(policy);
    try {
      await this.assertWithinFormCap(policy);
    } catch (err) {
      await this.releaseQuota(
        `quota:sub:${policy.organizationId}:${monthKey()}`,
      );
      throw err;
    }

    // ── 10. Enqueue ─────────────────────────────────────────────────────────
    const submissionId = randomUUID();

    const payload: SubmissionPayload = {
      submissionId,
      formId,
      formVersionId,
      organizationId: policy.organizationId,
      answers: result.sanitized,
      subjectId,
      completionTimeMs: dto.completionTimeMs ?? 0,
      respondentIpHash,
      userAgent,
      respondentId: userId,
      submittedAt: new Date().toISOString(),
    };

    try {
      await this.producer.enqueue(payload);
    } catch (err) {
      // The response never reached the queue, so it will never be stored. Both
      // claims must be released or the quota drifts permanently upward on every
      // Redis or BullMQ blip.
      await this.releaseQuota(
        `quota:sub:${policy.organizationId}:${monthKey()}`,
      );
      if (policy.maxSubmissions)
        await this.releaseQuota(`quota:form:${policy.formId}`);
      throw err;
    }

    return { submissionId, status: 'ENQUEUED' };
  }

  /**
   * Hand back a claimed quota slot.
   *
   * Never throws: a failure here means the counter reads one higher than the
   * truth until it next expires, which is a far smaller problem than turning a
   * rejected submission into a 500.
   */
  private async releaseQuota(key: string): Promise<void> {
    try {
      await this.redis.decr(key);
    } catch (err) {
      this.logger.warn(`Could not release quota slot ${key}`, err);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ANSWER PIPELINE
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Everything between "raw answers arrived" and "these answers are storable",
   * for ONE form version.
   *
   * Extracted so the form-app session submit runs the identical pipeline. A
   * second implementation there would have been the obvious shortcut and the
   * obvious mistake: a session entry is a submission of a real form, and if the
   * two paths could disagree about visibility, requiredness or a calculated
   * value, then which door a respondent came through would change what got
   * stored. Any divergence here is a data-integrity bug, so there is one copy.
   *
   * Returns issues rather than throwing, because the session path collects them
   * across many entries and reports them together.
   */
  async prepareAnswers(input: {
    organizationId: string;
    formId: string;
    formVersionId: string;
    questionsJson: unknown;
    logicJson: unknown;
    compiledRules: unknown;
    answers: Record<string, any>;
    subjectId?: string | null;
  }): Promise<{ sanitized: Record<string, any>; issues: ValidationIssue[] }> {
    const plan = readPlan(input.compiledRules);
    const questionList = Array.isArray(input.questionsJson)
      ? input.questionsJson
      : [];

    // Cross-form values are resolved to a plain bag here, before evaluation, so
    // the interpreter performs no I/O and the reachable set stays exactly what
    // the compiler recorded at publish time.
    const refs = await resolveReferences(
      this.prisma,
      plan,
      input.subjectId ?? null,
    );

    // Choice-list items this submission touches, resolved once. Two consumers:
    // the validator checks membership and cascade consistency against them,
    // and the rules engine reads their metadata columns for lookup().
    const { choiceItems, lookups } = await this.resolveChoiceData(
      input.organizationId,
      questionList,
      plan,
      input.answers,
    );

    let answers = input.answers;
    let extraRequiredIds: Set<string> | undefined;
    let calculatedQuestionIds: Set<string> | undefined;
    let ruleViolations: Array<{ questionId: string; message: string }> = [];

    // Hidden by EITHER system. The legacy `logic` array is still what most
    // forms use, and it was not consulted here at all — see IngestPolicy.
    // Evaluated with the same module the browser runs, so the two agree on
    // exactly which questions the respondent could see.
    const hiddenQuestionIds = hiddenByLegacyLogic(
      questionList as Array<{ id: string }>,
      Array.isArray(input.logicJson)
        ? (input.logicJson as LegacyLogicRule[])
        : [],
      answers,
    );

    if (!planIsEmpty(plan)) {
      const evaluated = runFormRules({
        questions: questionList,
        plan,
        answersById: answers,
        refs,
        lookups,
      });

      answers = evaluated.answersById as Record<string, any>;
      calculatedQuestionIds = evaluated.calculatedQuestionIds;
      ruleViolations = evaluated.violations.map((v) => ({
        questionId: v.questionId,
        message: v.message,
      }));

      for (const id of evaluated.hiddenQuestionIds) hiddenQuestionIds.add(id);

      // A hidden question cannot be answered, so requiring it would deadlock
      // the respondent. The engine already applies this to its own SHOW rules;
      // repeating it here covers the case where legacy logic did the hiding.
      extraRequiredIds = new Set(
        [...evaluated.requiredQuestionIds].filter(
          (id) => !hiddenQuestionIds.has(id),
        ),
      );

      // A rule that cannot be evaluated is a bug in the published form, not a
      // respondent error. Log it with the version so it is findable, while the
      // fail-closed defaults inside the engine keep this submission safe.
      if (evaluated.errors.length > 0) {
        this.logger.error(
          `Rule evaluation errors on form ${input.formId} version ${input.formVersionId}: ` +
            evaluated.errors.map((e) => `${e.ruleId}: ${e.message}`).join('; '),
        );
      }
    }

    const visibleQuestionIds =
      hiddenQuestionIds.size > 0
        ? new Set(
            questionList
              .map((q: any) => q?.id)
              .filter(
                (id: unknown): id is string =>
                  typeof id === 'string' && !hiddenQuestionIds.has(id),
              ),
          )
        : undefined;

    const result = this.validator.validate(input.questionsJson, answers, {
      visibleQuestionIds,
      extraRequiredIds,
      calculatedQuestionIds,
      choiceItems,
    });

    // Rule violations are respondent-facing and carry the author's own message.
    return {
      sanitized: result.sanitized,
      issues: [
        ...result.issues,
        ...ruleViolations.map((v) => ({
          questionId: v.questionId,
          code: 'RULE',
          message: v.message,
        })),
      ],
    };
  }

  /** File-reference ownership check, reused by the session submit path. */
  async assertFilesBelongToForm(
    answers: Record<string, any>,
    questionsJson: unknown,
    formId: string,
  ) {
    return this.assertFileReferencesValid(answers, questionsJson, formId);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CHOICE LISTS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Everything this submission needs from the choice-list tables, in one pass.
   *
   * Two consumers with overlapping needs, deliberately served together:
   *
   *   • the ANSWER VALIDATOR needs each submitted item's `parentValue`, to
   *     confirm membership and that the cascade the client claims is real;
   *   • the RULES ENGINE needs each item's `metadata`, so `lookup()` can
   *     auto-fill a read-only field.
   *
   * Resolving them separately would be two round trips over the same rows on
   * the request path. Resolving them here also keeps `AnswerValidatorService`
   * synchronous and free of a database dependency.
   */
  private async resolveChoiceData(
    organizationId: string,
    questions: any[],
    plan: CompiledPlan,
    answersById: Record<string, any>,
  ): Promise<{
    choiceItems: Map<string, ResolvedChoiceItem> | undefined;
    lookups: Record<string, RuleValue>;
  }> {
    // What the questions themselves reference.
    const wanted: Array<{ listSlug: string; value: string }> = [];
    let hasListBackedQuestion = false;

    for (const question of questions) {
      const source = question?.optionsSource;
      if (
        !source ||
        source.kind !== 'CHOICE_LIST' ||
        typeof source.listSlug !== 'string'
      )
        continue;
      hasListBackedQuestion = true;

      const answer = answersById[question.id];
      const values = Array.isArray(answer) ? answer : [answer];
      for (const value of values) {
        if (typeof value === 'string' && value !== '') {
          wanted.push({ listSlug: source.listSlug, value });
        }
      }
    }

    // What the rules reference. `planLookupRequests` addresses questions by
    // key, so the answers have to be projected first.
    const keyById = new Map<string, string>();
    for (const question of questions) {
      if (question?.id) keyById.set(question.id, question.key ?? question.id);
    }
    const answersByKey: Record<string, RuleValue> = {};
    for (const [id, value] of Object.entries(answersById)) {
      const key = keyById.get(id);
      if (key) answersByKey[key] = value as RuleValue;
    }

    const lookupRequests = planLookupRequests(plan.lookups, answersByKey);
    for (const request of lookupRequests) {
      wanted.push({ listSlug: request.list, value: request.value });
    }

    if (!hasListBackedQuestion && lookupRequests.length === 0) {
      return { choiceItems: undefined, lookups: {} };
    }

    const resolved = await this.choiceLists.resolveItemsForValidation(
      organizationId,
      wanted,
    );

    const choiceItems = new Map<string, ResolvedChoiceItem>();
    const metadataByKey = new Map<string, Record<string, unknown>>();
    for (const [key, item] of resolved) {
      choiceItems.set(key, {
        value: item.value,
        parentValue: item.parentValue,
      });
      metadataByKey.set(
        key,
        item.metadata &&
          typeof item.metadata === 'object' &&
          !Array.isArray(item.metadata)
          ? (item.metadata as Record<string, unknown>)
          : {},
      );
    }

    return {
      // Undefined rather than an empty map when no question is list-backed:
      // the validator treats a missing catalogue as "could not check" and fails
      // closed, which is only correct when there was something to check.
      choiceItems: hasListBackedQuestion ? choiceItems : undefined,
      lookups: resolveLookupBag(lookupRequests, metadataByKey),
    };
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
      this.logger.warn(
        'Redis read failed for ingest policy; falling back to DB',
        err,
      );
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
          select: {
            id: true,
            version: true,
            questionsJson: true,
            compiledRules: true,
            logicJson: true,
          },
        },
      },
    });

    if (!form) return null;

    const active =
      form.versions.find((v) => v.version === form.currentVersion) ??
      form.versions[0] ??
      null;

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
      compiledRules: active?.compiledRules ?? {},
      logicJson: active?.logicJson ?? [],
    };

    try {
      await this.redis.set(
        cacheKey,
        JSON.stringify(policy),
        POLICY_TTL_SECONDS,
      );
    } catch (err) {
      this.logger.warn('Redis write failed for ingest policy', err);
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
    const key = `quota:sub:${policy.organizationId}:${monthKey()}`;

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
      this.logger.error('Quota counter unavailable; allowing submission', err);
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
        await this.redis
          .del(`ingest_policy:${policy.formId}`)
          .catch(() => undefined);

        throw new ForbiddenException(
          'This form is no longer accepting responses.',
        );
      }
    } catch (err) {
      if (err instanceof ForbiddenException) throw err;
      this.logger.error(
        'Form cap counter unavailable; allowing submission',
        err,
      );
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ══════════════════════════════════════════════════════════════════════════

  private async verifyCaptcha(
    token: string | undefined,
    ip: string,
    formId: string,
  ) {
    const secret = process.env.CLOUDFLARE_TURNSTILE_SECRET;
    if (!secret) return; // not configured — skip

    if (!token) throw new BadRequestException('CAPTCHA verification required');

    try {
      const res = await fetch(
        'https://challenges.cloudflare.com/turnstile/v0/siteverify',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ secret, response: token, remoteip: ip }),
          signal: AbortSignal.timeout(5000),
        },
      );
      const data: any = await res.json();
      if (!data.success) {
        this.logger.warn(
          `CAPTCHA failed for form ${formId} from ${maskIp(ip)}`,
        );
        throw new BadRequestException('CAPTCHA verification failed');
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      // Network error contacting Cloudflare. Fail CLOSED: the operator enabled
      // CAPTCHA deliberately, so bypassing it on error defeats the purpose.
      this.logger.error('Error verifying CAPTCHA', err);
      throw new BadRequestException(
        'CAPTCHA verification unavailable, please retry',
      );
    }
  }

  /**
   * A FILE_UPLOAD answer carries a FormSubmissionFile id. Confirm every id
   * exists, is not already attached to another submission, and was issued for
   * this form — otherwise a caller could attach another tenant's file to their
   * own submission and read it back through the submissions API.
   */
  /**
   * Resolve and authorise the subject an entry attaches to.
   *
   * Three things must all hold, and each closes a distinct hole:
   *   1. the form is actually bound to a subject type — otherwise a caller
   *      could staple arbitrary entries onto records via a standalone form;
   *   2. the subject belongs to the SAME organization as the form — the
   *      cross-tenant check, since subjectId arrives from an unauthenticated
   *      public endpoint;
   *   3. the subject is of the type the form expects — a Household entry must
   *      not land on a Patient record.
   *
   * Returns null for standalone forms, which is every pre-existing form.
   */
  private async resolveSubjectId(
    formId: string,
    organizationId: string,
    requestedSubjectId?: string,
  ): Promise<string | null> {
    if (!requestedSubjectId) return null;

    const form = await this.prisma.reader.form.findFirst({
      where: { id: formId, organizationId },
      select: { subjectTypeId: true, subjectRole: true },
    });

    if (!form?.subjectTypeId || form.subjectRole === 'NONE') {
      throw new BadRequestException('This form is not linked to a record.');
    }

    const subject = await this.prisma.reader.subject.findFirst({
      where: {
        id: requestedSubjectId,
        organizationId,
        subjectTypeId: form.subjectTypeId,
        deletedAt: null,
      },
      select: { id: true },
    });

    // Deliberately the same message for "not found", "wrong tenant" and "wrong
    // type": distinguishing them would confirm the existence of another
    // organization's record to anyone probing ids.
    if (!subject) throw new BadRequestException('Record not found.');

    return subject.id;
  }

  private async assertFileReferencesValid(
    answers: Record<string, any>,
    questionsJson: unknown,
    formId: string,
  ) {
    const questions = Array.isArray(questionsJson) ? questionsJson : [];
    const fileQuestionIds = new Set(
      questions.filter((q) => q?.type === 'FILE_UPLOAD').map((q) => q.id),
    );
    if (fileQuestionIds.size === 0) return;

    const ids: string[] = [];
    for (const qid of fileQuestionIds) {
      const val = answers[qid];
      if (!val) continue;
      if (Array.isArray(val))
        ids.push(...val.filter((v) => typeof v === 'string'));
      else if (typeof val === 'string') ids.push(val);
    }
    if (ids.length === 0) return;

    const files = await this.prisma.reader.formSubmissionFile.findMany({
      where: { id: { in: ids } },
      select: { id: true, objectKey: true, submissionId: true },
    });

    if (files.length !== ids.length) {
      throw new BadRequestException(
        'One or more uploaded files could not be found.',
      );
    }

    for (const f of files) {
      if (f.submissionId) {
        throw new BadRequestException(
          'A referenced file is already attached to a submission.',
        );
      }
      // Object keys embed the form id: uploads/org_{orgId}/form_{formId}/...
      if (!f.objectKey.includes(`/form_${formId}/`)) {
        throw new BadRequestException(
          'A referenced file does not belong to this form.',
        );
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
        // A deleted response does not block a resubmission — that is the point
        // of a moderator deleting one. `deletedAt` joins the existing status
        // check so this path cannot diverge from the read paths if `status` and
        // `deletedAt` ever disagree on a row.
        where: {
          formId,
          respondentId: userId,
          deletedAt: null,
          status: { not: 'DELETED' },
        },
        select: { id: true },
      });
      if (existing) {
        throw new ForbiddenException(
          'You have already responded to this form.',
        );
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
        throw new ForbiddenException(
          'You have already responded to this form.',
        );
      }
    } catch (err) {
      if (err instanceof ForbiddenException) throw err;
      this.logger.warn('Duplicate check unavailable; allowing submission', err);
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
    // `deletedAt: null` alongside the status filter, not instead of it — and
    // this pairing is repeated at every read site, so it is worth stating once
    // why both are there when either alone would do today.
    //
    // `deletedAt` is the primary filter: the migration backfilled a timestamp
    // onto every row already sitting at status DELETED, so it is complete, and
    // it is the column @@index([formId, deletedAt, submittedAt desc]) is built
    // on. The status clause stays because `status` is writable from more places
    // than `deletedAt` is — the spam pipeline and any direct database repair can
    // reach it — and a row that acquires DELETED without a timestamp must not
    // become visible again. The cost of keeping both is nothing; the cost of
    // guessing wrong is a deleted response reappearing in a list or an export.
    const where: any = {
      form: { organizationId: orgId },
      deletedAt: null,
      status: { not: 'DELETED' },
    };

    if (search?.trim()) {
      const term = search.trim();
      // Previously filtered on a non-existent `submissionId` column, so any
      // search threw. Search the fields that actually exist, plus the answer
      // payload via the GIN index on `answers`.
      where.OR = [
        {
          form: {
            organizationId: orgId,
            title: { contains: term, mode: 'insensitive' },
          },
        },
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

  /**
   * One submission, fully resolved: the answers labelled against the schema the
   * respondent actually saw, the attached files with fresh download URLs, and
   * the review/deletion provenance.
   *
   * ── Why the version matters so much here ──────────────────────────────────
   * The answers column is a bag keyed by question id and nothing else. It has no
   * labels, no types, no option lists. Rendering it requires a question schema,
   * and there are two candidates: the form's CURRENT version, which is one query
   * away and always available, and the version this submission is bound to.
   *
   * It must be the latter, and the failure mode of getting it wrong is silent.
   * Re-publishing a form mints a new FormVersion; question ids are stable across
   * that, so an old answer keyed `q_7` will happily find `q_7` in the new
   * version and render under whatever label `q_7` carries *now*. Change "Do you
   * consent to contact?" to "Do you consent to data sharing?" and every historic
   * yes/no is retroactively relabelled as consent to something the respondent
   * was never asked about. Nothing errors; the screen just lies. That is the
   * entire reason FormVersion is immutable, so this reads through
   * `formVersion`, the submission's own relation, and never through `form`.
   */
  async getSubmissionDetail(orgId: string, submissionId: string) {
    const submission = await this.prisma.reader.formSubmission.findFirst({
      // Tenancy goes through `form.organizationId`, not the denormalised
      // `organizationId` column on the submission — the schema says that column
      // is "nullable only so the backfill can run online", and a row the
      // backfill has not reached yet would be invisible to its own org.
      where: {
        id: submissionId,
        form: { organizationId: orgId },
        deletedAt: null,
      },
      select: {
        ...submissionDetailSelect,
        subjectId: true,
        subject: { select: { id: true, displayName: true, externalId: true } },
        // Version metadata AND its questions: one join instead of a second
        // round trip, and it makes it structurally impossible for this method
        // to accidentally resolve against the current version.
        formVersion: {
          select: { id: true, version: true, questionsJson: true },
        },
        reviewNote: true,
        reviewedAt: true,
        reviewedBy: { select: userSummarySelect },
        deletedAt: true,
        deletedBy: { select: userSummarySelect },
        files: {
          select: {
            id: true,
            questionId: true,
            originalName: true,
            mimeType: true,
            sizeBytes: true,
            status: true,
            verifiedAt: true,
          },
        },
      },
    });

    if (!submission) throw new NotFoundException('Submission not found.');

    const questions = Array.isArray(submission.formVersion?.questionsJson)
      ? (submission.formVersion.questionsJson as any[])
      : [];
    const answers = (submission.answers ?? {}) as Record<string, unknown>;

    const { formVersion, files, ...rest } = submission;

    return {
      ...rest,
      formVersion: { id: formVersion.id, version: formVersion.version },
      answers: resolveAnswers(questions, answers),
      files: await this.resolveSubmissionFiles(orgId, files),
    };
  }

  /**
   * Attach a short-lived download URL to each file on a submission.
   *
   * Deliberately reuses `StorageService.generateDownloadUrl` rather than
   * signing here. That method re-checks the tenant, refuses QUARANTINED objects
   * and refuses anything not yet VERIFIED — three rules that must not have a
   * second implementation, because a second implementation is how a quarantined
   * object eventually gets served to somebody.
   *
   * The cost is one lookup per file, which is acceptable for a single-submission
   * detail view and is not on any list or export path. A file that cannot be
   * signed (still uploading, quarantined, reaped) yields a null URL instead of
   * failing the whole request — the reviewer should still see that the file
   * exists and what state it is in.
   */
  private async resolveSubmissionFiles(
    orgId: string,
    files: Array<{
      id: string;
      questionId: string;
      originalName: string;
      mimeType: string;
      sizeBytes: bigint;
      status: string;
      verifiedAt: Date | null;
    }>,
  ) {
    return Promise.all(
      files.map(async (file) => {
        let downloadUrl: string | null = null;
        try {
          downloadUrl = (await this.storage.generateDownloadUrl(orgId, file.id))
            .downloadUrl;
        } catch (err) {
          // Expected for PENDING_UPLOAD and QUARANTINED files. Logged at debug
          // because on a submission with many pending uploads this would
          // otherwise be a wall of warnings describing normal operation.
          this.logger.debug(
            `No download URL for file ${file.id} (status ${file.status}): ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }

        return {
          ...file,
          // BigInt does not survive JSON.stringify — it throws rather than
          // producing a wrong number, so this is a 500 rather than a display
          // bug if it is forgotten. Same treatment as Organization.storageUsedBytes.
          sizeBytes: file.sizeBytes.toString(),
          downloadUrl,
        };
      }),
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // REVIEW & MODERATION
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Annotate and/or re-status a single submission.
   *
   * `reviewedById`/`reviewedAt` are stamped on every successful call, including
   * a note-only edit: "who last looked at this and when" is the question the
   * fields exist to answer, and it is answered by any review action, not only by
   * a status change.
   */
  async reviewSubmission(
    orgId: string,
    submissionId: string,
    dto: ReviewSubmissionDto,
    userId: string,
    ipAddress?: string,
  ) {
    // `undefined` means "leave alone" and `null` means "clear", so presence has
    // to be tested with `in`/`!== undefined` rather than truthiness — a note of
    // `null` is a real instruction and `if (dto.reviewNote)` would drop it.
    const wantsNote = dto.reviewNote !== undefined;
    const wantsStatus = dto.status !== undefined;
    if (!wantsNote && !wantsStatus) {
      throw new BadRequestException('Provide a reviewNote, a status, or both.');
    }

    const current = await this.prisma.reader.formSubmission.findFirst({
      where: {
        id: submissionId,
        form: { organizationId: orgId },
        deletedAt: null,
      },
      select: { id: true, formId: true, status: true, reviewNote: true },
    });
    if (!current) throw new NotFoundException('Submission not found.');

    if (wantsStatus) assertStatusTransition(current.status, dto.status!);

    const reviewedAt = new Date();
    const result = await this.prisma.writer.formSubmission.updateMany({
      // The tenancy and not-deleted predicates are repeated on the WRITE, not
      // just checked on the read above. Between the two statements another
      // reviewer can delete this row, and an update whose WHERE is only `{ id }`
      // would happily resurrect the status of a submission that is now deleted.
      //
      // When a status change is requested the current status joins the WHERE as
      // a compare-and-swap: two reviewers acting on the same submission at once
      // should not have one silently overwrite a transition the other just made
      // and that this request never validated against.
      where: {
        id: submissionId,
        form: { organizationId: orgId },
        deletedAt: null,
        ...(wantsStatus ? { status: current.status } : {}),
      },
      data: {
        ...(wantsStatus ? { status: dto.status } : {}),
        ...(wantsNote ? { reviewNote: dto.reviewNote } : {}),
        reviewedById: userId,
        reviewedAt,
      },
    });

    if (result.count === 0) {
      throw new ConflictException(
        'This submission changed while you were reviewing it. Reload and try again.',
      );
    }

    this.audit.log({
      organizationId: orgId,
      userId,
      action: 'submission.reviewed',
      resource: 'submission',
      resourceId: submissionId,
      // Both sides of the status move, because "what did it used to be" is the
      // question an audit trail is read to answer. The note bodies are NOT
      // recorded — they are internal free text that can quote respondent PII,
      // and audit logs have a longer retention than the submissions themselves.
      metadata: {
        formId: current.formId,
        ...(wantsStatus
          ? { fromStatus: current.status, toStatus: dto.status }
          : {}),
        ...(wantsNote
          ? { noteChanged: true, noteCleared: dto.reviewNote === null }
          : {}),
      },
      ipAddress,
    });

    return this.reviewStateOf(submissionId);
  }

  /**
   * Soft-delete one submission.
   *
   * All three columns move together — `status`, `deletedAt`, `deletedById` — for
   * the reason the schema gives: a submission is evidence, and "deleted" without
   * "when" and "by whom" cannot answer a question anyone will later ask.
   *
   * What deliberately does NOT happen here: no analytics counter is decremented
   * and no Redis quota slot is released. A response that was received was
   * received, the organization was charged for it on arrival, and letting a
   * delete hand the slot back would turn "delete after submit" into an unlimited
   * quota bypass. The FormAnalytics rows and the `quota:sub:*` counters are
   * therefore untouched by every path in this section.
   */
  async deleteSubmission(
    orgId: string,
    submissionId: string,
    userId: string,
    ipAddress?: string,
  ) {
    const current = await this.prisma.reader.formSubmission.findFirst({
      where: {
        id: submissionId,
        form: { organizationId: orgId },
        deletedAt: null,
      },
      select: { id: true, formId: true, status: true },
    });
    if (!current) throw new NotFoundException('Submission not found.');

    const deletedAt = new Date();
    const result = await this.prisma.writer.formSubmission.updateMany({
      where: {
        id: submissionId,
        form: { organizationId: orgId },
        deletedAt: null,
      },
      data: {
        status: SubmissionStatus.DELETED,
        deletedAt,
        deletedById: userId,
      },
    });

    // Zero rows means a concurrent delete won. That is the outcome the caller
    // wanted, so it is reported as success rather than as a conflict — but the
    // audit entry is skipped, because the deletion this request describes is not
    // the one that actually happened.
    if (result.count === 0) {
      return { id: submissionId, deleted: true, alreadyDeleted: true };
    }

    this.audit.log({
      organizationId: orgId,
      userId,
      action: 'submission.deleted',
      resource: 'submission',
      resourceId: submissionId,
      metadata: { formId: current.formId, previousStatus: current.status },
      ipAddress,
    });

    return {
      id: submissionId,
      deleted: true,
      alreadyDeleted: false,
      deletedAt,
    };
  }

  /**
   * Bulk status change or bulk soft-delete over an explicit list of ids.
   *
   * ── The tenancy shape ─────────────────────────────────────────────────────
   * Every id is resolved against this organization in ONE query, before anything
   * is written. The alternative — loop the ids, check each, act on each — is the
   * standard way this endpoint becomes a cross-tenant write: the org predicate
   * has to be repeated on every branch of the loop, and it only takes one branch
   * where it is missing or where an early `continue` skips it. Here the org
   * filter exists in exactly one place, and `assertAllBulkIdsAuthorized` treats
   * anything the query did not return as unauthorised without caring whether it
   * belongs to another tenant, does not exist, or is already deleted.
   *
   * The write repeats the same predicates rather than trusting the pre-check,
   * for the same reason the single-row paths do: rows can change between the two
   * statements.
   */
  async bulkUpdateSubmissions(
    orgId: string,
    dto: BulkSubmissionsDto,
    userId: string,
    ipAddress?: string,
  ) {
    const ids = normaliseBulkIds(dto.ids);

    if (dto.action === 'SET_STATUS' && !dto.status) {
      throw new BadRequestException(
        'A status is required when action is SET_STATUS.',
      );
    }

    const rows = await this.prisma.reader.formSubmission.findMany({
      where: {
        id: { in: ids },
        form: { organizationId: orgId },
        deletedAt: null,
      },
      select: { id: true, status: true },
    });

    const authorized = assertAllBulkIdsAuthorized(
      ids,
      rows.map((row) => row.id),
    );

    // Shared by both branches, and repeated on the write for the reason above.
    const scope = {
      id: { in: authorized },
      form: { organizationId: orgId },
      deletedAt: null,
    };

    if (dto.action === 'DELETE') {
      const deletedAt = new Date();
      const result = await this.prisma.writer.formSubmission.updateMany({
        where: scope,
        data: {
          status: SubmissionStatus.DELETED,
          deletedAt,
          deletedById: userId,
        },
      });

      this.audit.log({
        organizationId: orgId,
        userId,
        action: 'submission.bulk_deleted',
        resource: 'submission',
        // No single resourceId applies, so the ids go in the metadata. Capped
        // by MAX_BULK_SUBMISSION_IDS, so this JSON column cannot grow unbounded.
        metadata: {
          submissionIds: authorized,
          requested: ids.length,
          affected: result.count,
        },
        ipAddress,
      });

      return {
        action: dto.action,
        requested: ids.length,
        affected: result.count,
      };
    }

    const target = dto.status!;
    // Validated per row against that row's OWN current status. A bulk call is
    // still a set of individual transitions and gets the same rules as PATCH —
    // "it was a bulk action" is not a reason to let a DELETED row be revived.
    for (const row of rows) assertStatusTransition(row.status, target);

    const result = await this.prisma.writer.formSubmission.updateMany({
      where: scope,
      data: { status: target, reviewedById: userId, reviewedAt: new Date() },
    });

    this.audit.log({
      organizationId: orgId,
      userId,
      action: 'submission.bulk_status_changed',
      resource: 'submission',
      metadata: {
        submissionIds: authorized,
        toStatus: target,
        requested: ids.length,
        affected: result.count,
      },
      ipAddress,
    });

    return {
      action: dto.action,
      status: target,
      requested: ids.length,
      affected: result.count,
    };
  }

  /**
   * The review fields as they now stand, for the mutation response.
   *
   * Re-read rather than assembled from the DTO so the client renders what the
   * database holds — including `reviewedBy`, which the request only knows as an
   * id, and any field a concurrent writer touched.
   */
  private async reviewStateOf(submissionId: string) {
    return this.prisma.reader.formSubmission.findUniqueOrThrow({
      where: { id: submissionId },
      select: {
        id: true,
        status: true,
        reviewNote: true,
        reviewedAt: true,
        reviewedBy: { select: userSummarySelect },
      },
    });
  }
}

/**
 * Label a stored answer bag against the question schema it was captured under.
 *
 * Iterates the QUESTIONS rather than the answers, so the result is in the order
 * the respondent saw and an unanswered question is present-and-null instead of
 * absent — "they skipped this" and "this field did not exist" are different
 * facts and a reviewer needs to tell them apart.
 *
 * Anything left in the bag afterwards is emitted as an orphan. That should be
 * impossible, since answers are validated against this same version at ingest,
 * but a hand-repaired row or a future migration can produce one, and silently
 * dropping stored respondent data from the only screen that displays it is the
 * worst available response to that.
 */
/**
 * Exported because it appears in `getSubmissionDetail`'s inferred return type,
 * which the controller re-exports — TypeScript cannot name a type it cannot
 * reach. Also the contract the frontend's `SubmissionAnswer` mirrors.
 */
export interface ResolvedAnswer {
  questionId: string;
  key: string | null;
  label: string;
  type: string;
  value: unknown;
  answered: boolean;
  orphaned: boolean;
}

function resolveAnswers(
  questions: any[],
  answers: Record<string, unknown>,
): ResolvedAnswer[] {
  const seen = new Set<string>();

  const resolved: ResolvedAnswer[] = questions
    .filter((question) => question && typeof question.id === 'string')
    .map((question) => {
      seen.add(question.id);
      return {
        questionId: question.id as string,
        // The stable author-facing name, when the form defines one. Exports and
        // cross-form references address questions by key, so surfacing it here
        // is what lets a reviewer match a column in a CSV to a row on screen.
        key:
          typeof question.key === 'string' && question.key
            ? question.key
            : null,
        label:
          typeof question.label === 'string' ? question.label : question.id,
        type: typeof question.type === 'string' ? question.type : 'UNKNOWN',
        value: answers[question.id] ?? null,
        answered:
          answers[question.id] !== undefined && answers[question.id] !== null,
        orphaned: false,
      };
    });

  for (const [questionId, value] of Object.entries(answers)) {
    if (seen.has(questionId)) continue;
    resolved.push({
      questionId,
      key: null,
      label: questionId,
      type: 'UNKNOWN',
      value,
      answered: value !== undefined && value !== null,
      orphaned: true,
    });
  }

  return resolved;
}

/**
 * The bucket the monthly quota counter lives in, as `YYYY-MM`.
 *
 * One definition, because the claim and the release must agree on it. Deriving
 * it twice would silently stop releasing at a month boundary — the rollback
 * would decrement a fresh month's counter instead of the one it incremented.
 */
function monthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    v,
  );
}

/** Never log a full IP — these logs are retained and the raw IP is PII. */
function maskIp(ip: string): string {
  const parts = ip.split('.');
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.x.x` : 'ip';
}
