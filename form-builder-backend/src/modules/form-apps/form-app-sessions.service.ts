import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';

import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SubmissionsService } from '../submissions/submissions.service';
import { SubmissionProducer } from '../submissions/queues/submission.producer';
import { evaluateSafe, truthy, type EvalContext, type ExprNode } from '../../common/rules';

/**
 * Form-app sessions — one sitting, many submissions, one act.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A session stages a respondent's answers across an app's steps and turns them
 * into real FormSubmissions in ONE transaction at submit.
 *
 * ── Why staging at all ─────────────────────────────────────────────────────
 * The reference form this models has one "Submit All Reports" button over a
 * respondent block, two repeatable training blocks and N school visits. If each
 * entry were submitted as it was filled, a failure partway through would leave
 * some visits recorded and others not, with nothing on screen to say which. The
 * respondent's only safe move would be to re-enter everything, creating
 * duplicates. Staging first and committing once removes that state entirely:
 * either the whole report exists or none of it does.
 *
 * ── What is NOT trusted ────────────────────────────────────────────────────
 * Staged answers are respondent input sitting in our database. At submit every
 * entry is re-run through `SubmissionsService.prepareAnswers` — the identical
 * pipeline a lone form submission uses — so calculated values are recomputed,
 * hidden answers dropped, and choice values re-checked against their lists. A
 * session is a convenience for the respondent, never a shortcut past validation.
 */

/** Ceilings that apply regardless of how a step is configured. */
export const SESSION_LIMITS = {
  /** Entries in one repeatable step. */
  MAX_ENTRIES_PER_STEP: 100,
  /** Entries across the whole session — the transaction has to stay sane. */
  MAX_ENTRIES_PER_SESSION: 300,
} as const;

export interface SessionActor {
  userId?: string;
  fingerprint?: string;
}

interface LoadedStep {
  id: string;
  key: string;
  order: number;
  title: string;
  description: string | null;
  icon: string | null;
  mode: 'SINGLE' | 'REPEATABLE';
  minEntries: number;
  maxEntries: number | null;
  isOptional: boolean;
  showWhen: unknown;
  uniqueBy: unknown;
  formId: string;
  form: {
    id: string;
    title: string;
    slug: string;
    subjectRole: 'NONE' | 'REGISTERS' | 'ATTACHES';
    currentVersion: number;
    versions: Array<{
      id: string;
      version: number;
      pagesJson: unknown;
      questionsJson: unknown;
      logicJson: unknown;
      themeJson: unknown;
      compiledRules: unknown;
    }>;
  };
}

@Injectable()
export class FormAppSessionsService {
  private readonly logger = new Logger(FormAppSessionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly submissions: SubmissionsService,
    private readonly producer: SubmissionProducer,
  ) {}

  // ══════════════════════════════════════════════════════════════════════════
  // LOADING
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * The app's steps with each step's ACTIVE form version attached.
   *
   * Only the version the form currently points at is taken — the same rule
   * `getPublicForm` follows. A respondent must fill the schema the form is
   * actually published at, not whichever row happens to be newest mid-publish.
   */
  private async loadSteps(appId: string): Promise<LoadedStep[]> {
    const steps = await this.prisma.reader.formAppStep.findMany({
      where: { appId },
      orderBy: { order: 'asc' },
      include: {
        form: {
          select: {
            id: true,
            title: true,
            slug: true,
            subjectRole: true,
            status: true,
            deletedAt: true,
            currentVersion: true,
            versions: {
              orderBy: { version: 'desc' },
              take: 5,
              select: {
                id: true,
                version: true,
                pagesJson: true,
                questionsJson: true,
                logicJson: true,
                themeJson: true,
                compiledRules: true,
              },
            },
          },
        },
      },
    });

    // A step whose form has been unpublished or deleted is dropped rather than
    // rendered as a broken card. The author sees it in the builder; the
    // respondent should simply not be asked for it.
    return steps
      .filter((step) => step.form.status === 'PUBLISHED' && !step.form.deletedAt)
      .filter((step) => step.form.versions.length > 0)
      .map((step) => ({
        ...step,
        form: {
          ...step.form,
          versions: [
            step.form.versions.find((v) => v.version === step.form.currentVersion) ??
              step.form.versions[0],
          ],
        },
      })) as LoadedStep[];
  }

  /** Question `key` → id, for the active version of a step's form. */
  private keyToId(step: LoadedStep): Map<string, string> {
    const questions = step.form.versions[0].questionsJson;
    const list = Array.isArray(questions) ? (questions as any[]) : [];
    const map = new Map<string, string>();
    for (const question of list) {
      if (question?.id) map.set(question.key ?? question.id, question.id);
    }
    return map;
  }

  /**
   * Which steps are in play, given what has been answered so far.
   *
   * `showWhen` is an ExprNode over EARLIER steps, addressed `stepKey.questionKey`.
   * Evaluated with the same interpreter as a SHOW rule and in the same
   * fail-closed direction: a condition that cannot be evaluated hides its step.
   * Revealing a step on error would ask a respondent for data the author never
   * intended to collect, and would then store it.
   */
  private visibleSteps(
    steps: LoadedStep[],
    answersByStepKey: Map<string, Record<string, unknown>>,
  ): LoadedStep[] {
    const fields: Record<string, any> = {};
    const visible: LoadedStep[] = [];

    for (const step of steps) {
      if (step.showWhen) {
        const ctx: EvalContext = { fields, refs: {}, lookups: {}, evalTime: new Date() };
        const { value, error } = evaluateSafe(step.showWhen as ExprNode, ctx);
        if (error || !truthy(value)) continue;
      }
      visible.push(step);

      // Only a visible step contributes to what follows it — a hidden step's
      // staged answers must not decide anything downstream.
      const answers = answersByStepKey.get(step.key) ?? {};
      const keyToId = this.keyToId(step);
      for (const [key, id] of keyToId) {
        fields[`${step.key}.${key}`] = answers[id] ?? null;
      }
    }

    return visible;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LIFECYCLE
  // ══════════════════════════════════════════════════════════════════════════

  /** The app, checked for availability. Shared by every session operation. */
  private async loadApp(appId: string) {
    const app = await this.prisma.reader.formApp.findFirst({
      where: { id: appId, deletedAt: null },
      include: {
        subjectType: { select: { id: true, name: true, slug: true, identityConfig: true } },
        organization: { select: { id: true, isActive: true, name: true } },
        periods: { where: { isActive: true }, orderBy: { startsAt: 'desc' } },
      },
    });
    if (!app) throw new NotFoundException('App not found.');
    if (!app.organization.isActive) {
      throw new ForbiddenException('This app is currently unavailable.');
    }
    return app;
  }

  /**
   * The period a new session belongs to.
   *
   * The window that contains "now". An app with periods configured but none
   * currently open is closed — that is what "Fixed Reporting Period" means, and
   * accepting a report outside its window would file it against the wrong cycle.
   */
  private activePeriod(app: { periods: Array<{ id: string; label: string; startsAt: Date; endsAt: Date }> }) {
    if (app.periods.length === 0) return null;
    const now = Date.now();
    return (
      app.periods.find(
        (period) => period.startsAt.getTime() <= now && period.endsAt.getTime() >= now,
      ) ?? null
    );
  }

  /** Open a session, or resume the respondent's existing draft. */
  async openSession(appId: string, actor: SessionActor) {
    const app = await this.loadApp(appId);

    if (!app.isPublished) throw new ForbiddenException('This app is not published yet.');
    if (app.requireAuth && !actor.userId) {
      throw new ForbiddenException('You must be signed in to use this app.');
    }
    if (!actor.userId && !actor.fingerprint) {
      throw new BadRequestException('A session needs either a signed-in user or a fingerprint.');
    }

    const period = this.activePeriod(app);
    if (app.periods.length > 0 && !period) {
      throw new ForbiddenException(
        'This app is outside its reporting period and is not accepting reports right now.',
      );
    }

    const identity = actor.userId
      ? { respondentId: actor.userId }
      : { fingerprint: actor.fingerprint };

    const existing = app.allowDrafts
      ? await this.prisma.reader.formAppSession.findFirst({
          where: { appId, status: 'DRAFT', ...identity },
          select: { id: true },
        })
      : null;

    if (existing) return this.getSession(appId, existing.id, actor);

    const session = await this.prisma.writer.formAppSession.create({
      data: {
        appId,
        organizationId: app.organizationId,
        periodId: period?.id ?? null,
        status: 'DRAFT',
        respondentId: actor.userId ?? null,
        fingerprint: actor.userId ? null : (actor.fingerprint ?? null),
      },
      select: { id: true },
    });

    return this.getSession(appId, session.id, actor);
  }

  /**
   * A session with its steps and staged entries.
   *
   * Ownership is part of the WHERE clause, not a check afterwards: a session id
   * is a bearer token for someone's half-written report, and looking it up
   * without binding it to the caller would let anyone with the id read it.
   */
  async getSession(appId: string, sessionId: string, actor: SessionActor) {
    const identity = actor.userId
      ? { respondentId: actor.userId }
      : { fingerprint: actor.fingerprint ?? '__none__' };

    const session = await this.prisma.reader.formAppSession.findFirst({
      where: { id: sessionId, appId, ...identity },
      include: {
        entries: { orderBy: [{ stepId: 'asc' }, { index: 'asc' }] },
        period: { select: { id: true, label: true, startsAt: true, endsAt: true } },
      },
    });
    if (!session) throw new NotFoundException('Session not found.');

    const steps = await this.loadSteps(appId);
    const byStepId = new Map(steps.map((step) => [step.id, step]));

    const answersByStepKey = new Map<string, Record<string, unknown>>();
    for (const entry of session.entries) {
      const step = byStepId.get(entry.stepId);
      // Only the FIRST entry of a step feeds `showWhen`: a condition over a
      // repeatable step has no single answer to read, and picking one silently
      // would make the rule mean something different per respondent.
      if (step && entry.index === 0) {
        answersByStepKey.set(step.key, (entry.answers ?? {}) as Record<string, unknown>);
      }
    }

    const visible = this.visibleSteps(steps, answersByStepKey);
    const visibleIds = new Set(visible.map((step) => step.id));

    return {
      id: session.id,
      appId,
      status: session.status,
      period: session.period,
      startedAt: session.startedAt,
      submittedAt: session.submittedAt,
      subjectId: session.subjectId,
      steps: visible.map((step) => {
        const version = step.form.versions[0];
        return {
          key: step.key,
          order: step.order,
          title: step.title,
          description: step.description,
          icon: step.icon,
          mode: step.mode,
          minEntries: step.isOptional ? 0 : step.minEntries,
          maxEntries: step.maxEntries,
          isOptional: step.isOptional,
          uniqueBy: Array.isArray(step.uniqueBy) ? step.uniqueBy : [],
          form: {
            id: step.form.id,
            slug: step.form.slug,
            title: step.form.title,
            subjectRole: step.form.subjectRole,
            formVersionId: version.id,
            // Flattened into exactly the shape FormRunner already consumes, so
            // the app runner mounts it unchanged.
            pages: version.pagesJson ?? [],
            questions: version.questionsJson ?? [],
            logic: version.logicJson ?? [],
            theme: version.themeJson ?? {},
            compiledRules: version.compiledRules ?? {},
          },
          entries: session.entries
            .filter((entry) => entry.stepId === step.id)
            .map((entry) => ({ index: entry.index, answers: entry.answers ?? {} })),
        };
      }),
      // Surfaced rather than silently dropped: an author who unpublishes a form
      // mid-cycle should be able to see that a step vanished.
      hiddenStepCount: steps.length - visibleIds.size,
    };
  }

  /** Stage one entry's answers. Called on autosave, so it must be cheap. */
  async saveEntry(
    appId: string,
    sessionId: string,
    stepKey: string,
    index: number,
    answers: Record<string, unknown>,
    actor: SessionActor,
  ) {
    const session = await this.assertDraft(appId, sessionId, actor);

    const step = await this.prisma.reader.formAppStep.findFirst({
      where: { appId, key: stepKey },
      include: {
        form: { select: { id: true, currentVersion: true, versions: { orderBy: { version: 'desc' }, take: 5, select: { id: true, version: true } } } },
      },
    });
    if (!step) throw new NotFoundException('Step not found.');

    if (step.mode === 'SINGLE' && index !== 0) {
      throw new BadRequestException('This step is filled once and has only one entry.');
    }
    if (index < 0 || index >= SESSION_LIMITS.MAX_ENTRIES_PER_STEP) {
      throw new BadRequestException('Entry index out of range.');
    }
    if (step.maxEntries !== null && index >= step.maxEntries) {
      throw new BadRequestException(`This step allows at most ${step.maxEntries} entries.`);
    }

    const total = await this.prisma.reader.formAppSessionEntry.count({
      where: { sessionId },
    });
    if (total >= SESSION_LIMITS.MAX_ENTRIES_PER_SESSION) {
      throw new BadRequestException(
        `A session may hold at most ${SESSION_LIMITS.MAX_ENTRIES_PER_SESSION} entries.`,
      );
    }

    const activeVersion =
      step.form.versions.find((v) => v.version === step.form.currentVersion) ??
      step.form.versions[0];
    if (!activeVersion) throw new BadRequestException('That step\'s form is not published.');

    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
      throw new BadRequestException('Answers must be an object.');
    }

    await this.prisma.writer.formAppSessionEntry.upsert({
      where: { sessionId_stepId_index: { sessionId, stepId: step.id, index } },
      update: { answers: answers as any },
      create: {
        sessionId,
        stepId: step.id,
        index,
        answers: answers as any,
        // Pinned on FIRST write, not on submit: the respondent is filling this
        // schema now, and a publish before they finish must not re-attribute
        // their answers to a version they never saw.
        formVersionId: activeVersion.id,
      },
    });

    return { ok: true, sessionId, stepKey, index };
  }

  async deleteEntry(
    appId: string,
    sessionId: string,
    stepKey: string,
    index: number,
    actor: SessionActor,
  ) {
    await this.assertDraft(appId, sessionId, actor);

    const step = await this.prisma.reader.formAppStep.findFirst({
      where: { appId, key: stepKey },
      select: { id: true, mode: true },
    });
    if (!step) throw new NotFoundException('Step not found.');
    if (step.mode === 'SINGLE') {
      throw new BadRequestException('This step is filled once and cannot be removed.');
    }

    await this.prisma.writer.$transaction(async (tx) => {
      await tx.formAppSessionEntry.deleteMany({
        where: { sessionId, stepId: step.id, index },
      });

      // Close the gap. Indexes are positional — leaving a hole would make
      // "School Visit #3" appear above "#2" on the next load, and would break
      // the unique constraint the moment a new entry reused the free number.
      const remaining = await tx.formAppSessionEntry.findMany({
        where: { sessionId, stepId: step.id, index: { gt: index } },
        orderBy: { index: 'asc' },
        select: { id: true, index: true },
      });
      for (const entry of remaining) {
        await tx.formAppSessionEntry.update({
          where: { id: entry.id },
          data: { index: entry.index - 1 },
        });
      }
    });

    return { ok: true };
  }

  /** Discard everything staged. The reference form's "Reset". */
  async resetSession(appId: string, sessionId: string, actor: SessionActor) {
    await this.assertDraft(appId, sessionId, actor);
    await this.prisma.writer.formAppSessionEntry.deleteMany({ where: { sessionId } });
    return { ok: true };
  }

  private async assertDraft(appId: string, sessionId: string, actor: SessionActor) {
    const identity = actor.userId
      ? { respondentId: actor.userId }
      : { fingerprint: actor.fingerprint ?? '__none__' };

    const session = await this.prisma.reader.formAppSession.findFirst({
      where: { id: sessionId, appId, ...identity },
      select: { id: true, status: true, organizationId: true, periodId: true },
    });
    if (!session) throw new NotFoundException('Session not found.');
    if (session.status !== 'DRAFT') {
      throw new ForbiddenException('This report has already been submitted.');
    }
    return session;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SUBMIT
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Turn the whole session into submissions. All or nothing.
   *
   * Order matters and is deliberate:
   *   1. re-validate EVERYTHING before writing anything, so a failure costs the
   *      respondent nothing;
   *   2. check the org's monthly quota against the FULL entry count up front —
   *      a session that would exceed it must be rejected whole, never half
   *      accepted;
   *   3. only then open the transaction.
   */
  async submitSession(
    appId: string,
    sessionId: string,
    actor: SessionActor,
    meta: { ip?: string; userAgent?: string } = {},
  ) {
    const app = await this.loadApp(appId);
    const session = await this.assertDraft(appId, sessionId, actor);

    const steps = await this.loadSteps(appId);
    const stepById = new Map(steps.map((step) => [step.id, step]));

    const entries = await this.prisma.reader.formAppSessionEntry.findMany({
      where: { sessionId },
      orderBy: [{ stepId: 'asc' }, { index: 'asc' }],
    });

    const answersByStepKey = new Map<string, Record<string, unknown>>();
    for (const entry of entries) {
      const step = stepById.get(entry.stepId);
      if (step && entry.index === 0) {
        answersByStepKey.set(step.key, (entry.answers ?? {}) as Record<string, unknown>);
      }
    }
    const visible = this.visibleSteps(steps, answersByStepKey);
    const visibleIds = new Set(visible.map((step) => step.id));

    // Entries belonging to a step that is no longer visible are dropped, not
    // rejected: a respondent may legitimately have filled it and then changed
    // an earlier answer that hid it.
    const liveEntries = entries.filter((entry) => visibleIds.has(entry.stepId));

    const issues: Array<{ stepKey: string; index: number; questionId?: string; message: string }> = [];

    // ── Cardinality ──────────────────────────────────────────────────────────
    for (const step of visible) {
      const count = liveEntries.filter((entry) => entry.stepId === step.id).length;
      const min = step.isOptional ? 0 : Math.max(step.minEntries, step.mode === 'SINGLE' ? 1 : 0);

      if (count < min) {
        issues.push({
          stepKey: step.key,
          index: 0,
          message:
            min === 1
              ? `"${step.title}" must be completed.`
              : `"${step.title}" needs at least ${min} entries.`,
        });
      }
      if (step.maxEntries !== null && count > step.maxEntries) {
        issues.push({
          stepKey: step.key,
          index: 0,
          message: `"${step.title}" allows at most ${step.maxEntries} entries.`,
        });
      }
    }

    // ── Per-entry validation, through the single-form pipeline ───────────────
    const prepared = new Map<string, Record<string, any>>();

    for (const entry of liveEntries) {
      const step = stepById.get(entry.stepId)!;
      const version = step.form.versions[0];

      // The entry pinned a version when it was created; if that version is not
      // the one loaded here, honour the pinned one.
      const pinned =
        version.id === entry.formVersionId
          ? version
          : await this.prisma.reader.formVersion.findFirst({
              where: { id: entry.formVersionId, formId: step.formId },
              select: {
                id: true,
                questionsJson: true,
                logicJson: true,
                compiledRules: true,
              },
            });

      if (!pinned) {
        issues.push({
          stepKey: step.key,
          index: entry.index,
          message: 'The form for this entry has changed. Please review and re-enter it.',
        });
        continue;
      }

      const result = await this.submissions.prepareAnswers({
        organizationId: app.organizationId,
        formId: step.formId,
        formVersionId: pinned.id,
        questionsJson: pinned.questionsJson,
        logicJson: (pinned as any).logicJson,
        compiledRules: pinned.compiledRules,
        answers: (entry.answers ?? {}) as Record<string, any>,
      });

      for (const issue of result.issues) {
        issues.push({
          stepKey: step.key,
          index: entry.index,
          questionId: issue.questionId,
          message: issue.message,
        });
      }

      if (result.issues.length === 0) {
        await this.submissions.assertFilesBelongToForm(
          result.sanitized,
          pinned.questionsJson,
          step.formId,
        );
        prepared.set(entry.id, result.sanitized);
      }
    }

    // ── Uniqueness across a repeatable step's entries ────────────────────────
    // "Duplicate schools not allowed", expressed declaratively.
    for (const step of visible) {
      const uniqueBy = Array.isArray(step.uniqueBy) ? (step.uniqueBy as string[]) : [];
      if (uniqueBy.length === 0) continue;

      const keyToId = this.keyToId(step);
      const seen = new Map<string, number>();

      for (const entry of liveEntries.filter((e) => e.stepId === step.id)) {
        const answers = prepared.get(entry.id) ?? (entry.answers as Record<string, any>) ?? {};
        const composite = uniqueBy
          .map((key) => {
            const id = keyToId.get(key);
            return id ? JSON.stringify(answers[id] ?? null) : 'null';
          })
          .join('|');

        // An entry with none of the unique keys answered cannot collide with
        // anything meaningfully — it will fail its own required check instead.
        if (composite.replace(/[|]|null/g, '') === '') continue;

        const first = seen.get(composite);
        if (first !== undefined) {
          issues.push({
            stepKey: step.key,
            index: entry.index,
            message: `This duplicates entry ${first + 1}. Each entry in "${step.title}" must be different.`,
          });
        } else {
          seen.set(composite, entry.index);
        }
      }
    }

    if (issues.length > 0) {
      throw new UnprocessableEntityException({
        message: 'This report cannot be submitted yet.',
        issues,
      });
    }

    // ── Quota, for the whole session at once ─────────────────────────────────
    await this.assertSessionWithinQuota(app.organizationId, liveEntries.length);

    // ── Subject ──────────────────────────────────────────────────────────────
    const registrationStep = visible.find((step) => step.form.subjectRole === 'REGISTERS');
    const registrationEntry = registrationStep
      ? liveEntries.find((entry) => entry.stepId === registrationStep.id && entry.index === 0)
      : undefined;

    const dailySalt = new Date().toISOString().slice(0, 10);
    const respondentIpHash = meta.ip
      ? createHash('sha256').update(meta.ip + dailySalt).digest('hex')
      : null;

    const submittedAt = new Date();
    const created: Array<{ submissionId: string; formId: string; formVersionId: string }> = [];

    const result = await this.prisma.writer.$transaction(async (tx) => {
      let subjectId: string | null = null;

      if (registrationStep && registrationEntry) {
        subjectId = await this.resolveOrCreateSubject(tx, {
          organizationId: app.organizationId,
          subjectType: app.subjectType,
          step: registrationStep,
          answers: prepared.get(registrationEntry.id) ?? {},
        });
      }

      for (const entry of liveEntries) {
        const step = stepById.get(entry.stepId)!;
        const submissionId = randomUUID();

        await tx.formSubmission.create({
          data: {
            id: submissionId,
            formId: step.formId,
            formVersionId: entry.formVersionId,
            organizationId: app.organizationId,
            subjectId,
            respondentId: actor.userId ?? null,
            respondentIpHash,
            userAgent: meta.userAgent ?? null,
            answers: (prepared.get(entry.id) ?? {}) as any,
            completionTimeMs: 0,
            submittedAt,
            status: 'SUBMITTED',
          },
        });

        await tx.formAppSessionEntry.update({
          where: { id: entry.id },
          data: { submissionId },
        });

        created.push({ submissionId, formId: step.formId, formVersionId: entry.formVersionId });
      }

      // The registration submission is what the subject was created from.
      if (subjectId && registrationEntry) {
        const registrationSubmission = created.find(
          (item) => item.formId === registrationStep!.formId,
        );
        if (registrationSubmission) {
          await tx.subject.updateMany({
            where: { id: subjectId, registrationSubmissionId: null },
            data: { registrationSubmissionId: registrationSubmission.submissionId },
          });
        }
      }

      await tx.formAppSession.update({
        where: { id: sessionId },
        data: {
          status: 'SUBMITTED',
          subjectId,
          submittedAt,
          completionTimeMs: null,
        },
      });

      return { subjectId };
    });

    // ── Downstream ───────────────────────────────────────────────────────────
    // Enqueued AFTER the transaction commits. Enqueuing inside it would let a
    // worker pick up a submission id that a rollback then erased.
    for (const item of created) {
      await this.producer
        .enqueue({
          submissionId: item.submissionId,
          formId: item.formId,
          formVersionId: item.formVersionId,
          organizationId: app.organizationId,
          // The worker reads the STORED answers for an already-persisted row;
          // sending them again would just duplicate a large payload through
          // the queue.
          answers: {},
          subjectId: result.subjectId ?? undefined,
          completionTimeMs: 0,
          respondentIpHash: respondentIpHash ?? '',
          userAgent: meta.userAgent,
          respondentId: actor.userId,
          submittedAt: submittedAt.toISOString(),
        })
        .catch((error) => {
          // A failed enqueue must not fail the submission: the data is safely
          // committed, and only the side effects are delayed.
          this.logger.error(
            `Failed to enqueue post-processing for submission ${item.submissionId}`,
            error as any,
          );
        });
    }

    this.audit.log({
      organizationId: app.organizationId,
      userId: actor.userId,
      action: 'FORM_APP_SESSION_SUBMITTED',
      resource: 'FormAppSession',
      resourceId: sessionId,
      metadata: { appId, entries: created.length, subjectId: result.subjectId },
    });

    return {
      sessionId,
      status: 'SUBMITTED',
      subjectId: result.subjectId,
      submissionCount: created.length,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SUBJECTS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Find the subject this report belongs to, or create it.
   *
   * WITHOUT THIS, longitudinal reporting is meaningless: every session would
   * mint a new "Respondent", and a person's visits would scatter across a fresh
   * record each cycle instead of accumulating against one.
   *
   * `SubjectType.identityConfig` decides what "the same person" means:
   *   { displayName: ["name"], attributes: [...], externalId: "staff_number" }
   * With an `externalId` key configured, that answer IS the identity and the
   * existing `@@unique([subjectTypeId, externalId])` does the matching. Without
   * one, the displayName keys are hashed into a synthetic external id — same
   * index, same guarantee, no extra column, and stable across sessions because
   * it is derived from the answers rather than generated.
   */
  private async resolveOrCreateSubject(
    tx: any,
    input: {
      organizationId: string;
      subjectType: { id: string; name: string; identityConfig: unknown };
      step: LoadedStep;
      answers: Record<string, any>;
    },
  ): Promise<string> {
    const config = (input.subjectType.identityConfig ?? {}) as {
      displayName?: string[];
      attributes?: string[];
      externalId?: string;
    };
    const keyToId = this.keyToId(input.step);

    const read = (key: string) => {
      const id = keyToId.get(key);
      const value = id ? input.answers[id] : undefined;
      if (value === null || value === undefined) return '';
      return Array.isArray(value) ? value.join(', ') : String(value);
    };

    const displayKeys = Array.isArray(config.displayName) ? config.displayName : [];
    const displayName =
      displayKeys.map(read).filter(Boolean).join(' ').trim() || `${input.subjectType.name} record`;

    let externalId: string;
    if (config.externalId && read(config.externalId)) {
      externalId = read(config.externalId).slice(0, 100);
    } else {
      // Derived, not random: two sessions by the same person must land on the
      // same subject. Hashed so an arbitrarily long composite still fits the
      // column and so the raw answers are not exposed in an identifier.
      const basis = (displayKeys.length > 0 ? displayKeys : [...keyToId.keys()])
        .map((key) => `${key}=${read(key).trim().toLowerCase()}`)
        .join('|');
      externalId = `auto:${createHash('sha256').update(basis).digest('hex').slice(0, 40)}`;
    }

    const attributes: Record<string, unknown> = {};
    for (const key of Array.isArray(config.attributes) ? config.attributes : []) {
      const value = read(key);
      if (value) attributes[key] = value;
    }

    const existing = await tx.subject.findFirst({
      where: { subjectTypeId: input.subjectType.id, externalId, deletedAt: null },
      select: { id: true },
    });

    if (existing) {
      // Refreshed, not left stale: a respondent who has changed block should
      // not still be filed under the old one.
      await tx.subject.update({
        where: { id: existing.id },
        data: { displayName, attributes: attributes as any },
      });
      return existing.id;
    }

    const subject = await tx.subject.create({
      data: {
        organizationId: input.organizationId,
        subjectTypeId: input.subjectType.id,
        displayName: displayName.slice(0, 200),
        externalId,
        attributes: attributes as any,
      },
      select: { id: true },
    });
    return subject.id;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // QUOTA
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * A session consumes N of the org's monthly allowance, not one.
   *
   * Checked before the transaction opens and counted as a block, so a session
   * that would cross the line is refused whole. Counting per-submission inside
   * the loop could accept the first eight visits and reject the ninth, which is
   * precisely the partial state this whole design exists to prevent.
   */
  private async assertSessionWithinQuota(organizationId: string, entryCount: number) {
    if (entryCount === 0) {
      throw new BadRequestException('There is nothing to submit yet.');
    }

    const org = await this.prisma.reader.organization.findUnique({
      where: { id: organizationId },
      select: { maxSubmissionsMonth: true },
    });
    if (!org) throw new NotFoundException('Organization not found.');

    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const used = await this.prisma.reader.formSubmission.count({
      where: { organizationId, submittedAt: { gte: monthStart }, status: { not: 'DELETED' } },
    });

    if (used + entryCount > org.maxSubmissionsMonth) {
      throw new ForbiddenException(
        `This report has ${entryCount} entries but only ${Math.max(
          org.maxSubmissionsMonth - used,
          0,
        )} submissions remain in this month's allowance.`,
      );
    }
  }
}
