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
import {
  evaluateSafe,
  truthy,
  type EvalContext,
  type ExprNode,
} from '../../common/rules';
import {
  SubjectHistory,
  effectiveMax,
  effectiveMin,
  occurredAtFor,
  occurrenceKeyFor,
  occurrenceLabelFor,
  uniqueByKeys,
  type StepScope,
} from './step-scope';

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

/** Why a step is or is not offerable for a record right now. */
export type StepAvailabilityReason =
  | 'OPEN'
  | 'ALREADY_COMPLETED'
  | 'PERIOD_SATISFIED'
  | 'MAX_REACHED'
  | 'HIDDEN_BY_CONDITION';

export interface StepAvailability {
  stepKey: string;
  title: string;
  description: string | null;
  icon: string | null;
  order: number;
  scope: StepScope;
  mode: 'SINGLE' | 'REPEATABLE';
  formId: string;
  formTitle: string;
  /** Entries already on file for this record, counted in the step's scope. */
  existingCount: number;
  /** NULL when the step has no ceiling. */
  remaining: number | null;
  lastOccurredAt: Date | null;
  available: boolean;
  reason: StepAvailabilityReason;
  /** A sentence for the greyed-out case. NULL when the step is open. */
  detail: string | null;
}

interface LoadedStep {
  id: string;
  key: string;
  order: number;
  title: string;
  description: string | null;
  icon: string | null;
  mode: 'SINGLE' | 'REPEATABLE';
  scope: StepScope;
  minEntries: number;
  maxEntries: number | null;
  isOptional: boolean;
  showWhen: unknown;
  uniqueBy: unknown;
  occurredAtKey: string | null;
  formId: string;
  form: {
    id: string;
    title: string;
    slug: string;
    subjectRole: 'NONE' | 'REGISTERS' | 'ATTACHES';
    currentVersion: number;
    /** The form's own arrangement. Read only when the app's layout is INHERIT. */
    layoutMode: string;
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
            layoutMode: true,
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
      .filter(
        (step) => step.form.status === 'PUBLISHED' && !step.form.deletedAt,
      )
      .filter((step) => step.form.versions.length > 0)
      .map((step) => ({
        ...step,
        form: {
          ...step.form,
          versions: [
            step.form.versions.find(
              (v) => v.version === step.form.currentVersion,
            ) ?? step.form.versions[0],
          ],
        },
      }));
  }

  /**
   * What this subject already has on file, for the steps in play.
   *
   * ONE query, and deliberately so. The obvious shape — a COUNT per step —
   * turns opening a record into six or more round-trips for an app like a
   * training programme, which is exactly what makes longitudinal tools feel
   * slow. Served by the [subjectId, formAppStepId, periodId] index, projected
   * to four small columns so no JSONB answer payload is read.
   */
  private async loadSubjectHistory(
    subjectId: string | null,
    stepIds: string[],
  ): Promise<SubjectHistory> {
    if (!subjectId || stepIds.length === 0) return SubjectHistory.empty();

    const rows = await this.prisma.reader.formSubmission.findMany({
      where: {
        subjectId,
        formAppStepId: { in: stepIds },
        deletedAt: null,
        status: { not: 'DELETED' },
      },
      select: {
        formAppStepId: true,
        periodId: true,
        occurrenceKey: true,
        occurredAt: true,
      },
    });

    return new SubjectHistory(rows);
  }

  /**
   * The subject's latest answers per step, for evaluating `showWhen` in a
   * follow-up session.
   *
   * In a REGISTER session every answer a condition might reference is staged in
   * the session itself. In a FOLLOW_UP one it is not — registration happened
   * months ago and lives on a submission. Without this a condition like
   * "show the placement follow-up when the student wanted employment" would
   * evaluate against nothing and, fail-closed, hide the step forever.
   *
   * Cost is controlled by only fetching steps some condition actually names.
   * That set is static — it comes from the app's own step definitions — so an
   * app without conditions issues no query at all.
   */
  private async loadAccumulatedAnswers(
    subjectId: string | null,
    steps: LoadedStep[],
  ): Promise<Map<string, Record<string, unknown>>> {
    const result = new Map<string, Record<string, unknown>>();
    if (!subjectId) return result;

    const referenced = this.stepKeysReferencedByConditions(steps);
    if (referenced.size === 0) return result;

    const wanted = steps.filter((step) => referenced.has(step.key));
    if (wanted.length === 0) return result;

    const rows = await this.prisma.reader.formSubmission.findMany({
      where: {
        subjectId,
        formAppStepId: { in: wanted.map((step) => step.id) },
        deletedAt: null,
        status: { not: 'DELETED' },
      },
      // Newest first, then keep the first seen per step: "the answer that
      // stands today" is the most recent one, not the original.
      orderBy: { occurredAt: 'desc' },
      select: { formAppStepId: true, answers: true },
    });

    const byId = new Map(wanted.map((step) => [step.id, step.key]));
    for (const row of rows) {
      const stepKey = row.formAppStepId ? byId.get(row.formAppStepId) : null;
      if (!stepKey || result.has(stepKey)) continue;
      result.set(stepKey, (row.answers ?? {}) as Record<string, unknown>);
    }

    return result;
  }

  /**
   * Step keys named by any `showWhen` in this app.
   *
   * Conditions address `stepKey.questionKey`, so the leading segment of every
   * field reference is a step key. Walking the expression tree is cheap and
   * happens once per session load; guessing instead — fetching every step's
   * history unconditionally — would pull JSONB answer blobs nobody reads.
   */
  private stepKeysReferencedByConditions(steps: LoadedStep[]): Set<string> {
    const keys = new Set<string>();

    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        for (const child of node) walk(child);
        return;
      }
      const record = node as Record<string, unknown>;
      if (typeof record.field === 'string') {
        const [stepKey] = record.field.split('.');
        if (stepKey) keys.add(stepKey);
      }
      for (const value of Object.values(record)) walk(value);
    };

    for (const step of steps) if (step.showWhen) walk(step.showWhen);
    return keys;
  }

  /** Question `key` → id, for the active version of a step's form. */
  private keyToId(step: LoadedStep): Map<string, string> {
    const questions = step.form.versions[0].questionsJson;
    const list = Array.isArray(questions) ? questions : [];
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
   *
   * `accumulated` carries the subject's previously submitted answers and is
   * consulted only where the current session has nothing staged for a step. A
   * follow-up session has no registration entry in it, so without this every
   * condition over registration would evaluate against nothing and — being
   * fail-closed — hide its step permanently. Session answers still win, so a
   * step re-answered in this sitting decides against what was just typed rather
   * than what is on file.
   */
  private visibleSteps(
    steps: LoadedStep[],
    answersByStepKey: Map<string, Record<string, unknown>>,
    accumulated: Map<string, Record<string, unknown>> = new Map(),
  ): LoadedStep[] {
    const fields: Record<string, any> = {};
    const visible: LoadedStep[] = [];

    for (const step of steps) {
      if (step.showWhen) {
        const ctx: EvalContext = {
          fields,
          refs: {},
          lookups: {},
          evalTime: new Date(),
        };
        const { value, error } = evaluateSafe(step.showWhen as ExprNode, ctx);
        if (error || !truthy(value)) continue;
      }
      visible.push(step);

      // Only a visible step contributes to what follows it — a hidden step's
      // staged answers must not decide anything downstream.
      const answers =
        answersByStepKey.get(step.key) ?? accumulated.get(step.key) ?? {};
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
        subjectType: {
          select: { id: true, name: true, slug: true, identityConfig: true },
        },
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
  private activePeriod(app: {
    periods: Array<{ id: string; label: string; startsAt: Date; endsAt: Date }>;
  }) {
    if (app.periods.length === 0) return null;
    const now = Date.now();
    return (
      app.periods.find(
        (period) =>
          period.startsAt.getTime() <= now && period.endsAt.getTime() >= now,
      ) ?? null
    );
  }

  /**
   * Every window a report may be filed into right now, newest first.
   *
   * ── The three modes ────────────────────────────────────────────────────────
   *  NONE       no windows; nothing to choose and nothing to close.
   *  FIXED      hand-made rows. Outside all of them the app is CLOSED, which is
   *             the original behaviour and still right for a survey that runs
   *             February to May and then stops.
   *  RECURRING  windows derived from a cadence. The current one, plus any
   *             recently closed one still inside its grace — so a worker who
   *             visited on the 28th and reaches a keyboard on the 3rd files it
   *             under the month it happened. Being between windows is ordinary
   *             here, never closed.
   *
   * An app predating `periodMode` was migrated to FIXED if it had periods, so
   * this reproduces exactly what it did before.
   */
  private fileablePeriods(
    app: {
      periodMode: 'NONE' | 'FIXED' | 'RECURRING';
      periodConfig: unknown;
      periods: Array<{ id: string; label: string; startsAt: Date; endsAt: Date }>;
    },
    now: Date = new Date(),
  ): { windows: FileablePeriod[]; isClosed: boolean } {
    if (app.periodMode === 'RECURRING') {
      const config = readPeriodConfig(app.periodConfig);
      // A RECURRING app whose cadence is missing or unreadable has no windows
      // we can honestly name. Treated as NONE rather than guessed at: inventing
      // MONTHLY would file real entries into windows nobody defined.
      if (!config) return { windows: [], isClosed: false };

      const byStart = new Map(
        app.periods.map((period) => [period.startsAt.getTime(), period]),
      );

      return {
        windows: fileableWindows(config, now).map((window) => {
          const existing = byStart.get(window.startsAt.getTime());
          return {
            // NULL until the window is materialised, which happens the first
            // time anyone actually files into it.
            id: existing?.id ?? null,
            label: existing?.label ?? window.label,
            startsAt: window.startsAt,
            endsAt: window.endsAt,
            sequence: window.sequence,
          };
        }),
        isClosed: false,
      };
    }

    if (app.periodMode === 'FIXED' || app.periods.length > 0) {
      const current = this.activePeriod(app);
      return {
        windows: current
          ? [
              {
                id: current.id,
                label: current.label,
                startsAt: current.startsAt,
                endsAt: current.endsAt,
                sequence: null,
              },
            ]
          : [],
        isClosed: !current,
      };
    }

    return { windows: [], isClosed: false };
  }

  /**
   * The chosen window as a real row, creating it the first time it is used.
   *
   * ── Why this is not on the read path, despite being called from open ───────
   * In the steady state this is ONE indexed read against the (appId, startsAt)
   * unique key. The INSERT happens once per window per app — once a month for a
   * monthly cadence — not once per session. An earlier draft avoided the row
   * entirely by counting entries against a date range, which removed the write
   * but made a backdated entry's window disagree with the window it was filed
   * under. A stamped `periodId` is what the filer actually chose, and that has
   * to be the authority.
   *
   * The P2002 branch is the concurrent case: two workers opening the first
   * session of a new month. They must converge on ONE row, or the same month
   * would exist twice and per-period counting would split across both.
   */
  private async materialisePeriod(
    appId: string,
    window: FileablePeriod,
  ): Promise<string> {
    if (window.id) return window.id;

    const existing = await this.prisma.reader.formAppPeriod.findUnique({
      where: { appId_startsAt: { appId, startsAt: window.startsAt } },
      select: { id: true },
    });
    if (existing) return existing.id;

    try {
      const created = await this.prisma.writer.formAppPeriod.create({
        data: {
          appId,
          label: window.label,
          startsAt: window.startsAt,
          endsAt: window.endsAt,
          sequence: window.sequence,
          isGenerated: true,
          isActive: true,
        },
        select: { id: true },
      });
      return created.id;
    } catch (err: any) {
      if (err?.code === 'P2002') {
        const winner = await this.prisma.reader.formAppPeriod.findUnique({
          where: { appId_startsAt: { appId, startsAt: window.startsAt } },
          select: { id: true },
        });
        if (winner) return winner.id;
      }
      throw err;
    }
  }

  /**
   * Which window this session is filing into.
   *
   * A requested window must be one the app is actually offering. Accepting an
   * arbitrary id would let a caller file this month's visit into a cycle that
   * closed a year ago, which is worse than refusing it — the entry would look
   * filed, and would be counted against the wrong cohort forever.
   */
  private pickPeriod(
    windows: FileablePeriod[],
    requestedPeriodId: string | undefined,
  ): FileablePeriod | null {
    if (windows.length === 0) return null;
    if (!requestedPeriodId) return windows[0];

    const chosen = windows.find((window) => window.id === requestedPeriodId);
    if (!chosen) {
      throw new ForbiddenException(
        'That reporting period is not open for new entries.',
      );
    }
    return chosen;
  }

  /**
   * Open a session, or resume the respondent's existing draft.
   *
   * `subjectId` switches the session to FOLLOW_UP: it is bound to a record that
   * already exists, registration is skipped, and only the steps still open for
   * that record are offered. Without it the only way to add March's progress
   * check was to re-fill the student's whole registration so the identity hash
   * would land on the same Subject — a re-typed registration every visit, and a
   * silently duplicated student on any typo.
   *
   * `stepKeys` narrows the session to particular steps, so "add one visit" from
   * a record page is one form rather than a six-step wizard with five skipped.
   * It is validated against what is actually open, never trusted as given.
   */
  async openSession(
    appId: string,
    actor: SessionActor,
    options: { subjectId?: string; stepKeys?: string[] } = {},
  ) {
    const app = await this.loadApp(appId);

    if (!app.isPublished)
      throw new ForbiddenException('This app is not published yet.');
    if (app.requireAuth && !actor.userId) {
      throw new ForbiddenException('You must be signed in to use this app.');
    }
    if (!actor.userId && !actor.fingerprint) {
      throw new BadRequestException(
        'A session needs either a signed-in user or a fingerprint.',
      );
    }

    const period = this.activePeriod(app);
    if (app.periods.length > 0 && !period) {
      throw new ForbiddenException(
        'This app is outside its reporting period and is not accepting reports right now.',
      );
    }

    // ── Follow-up: bind the subject before anything else ────────────────────
    //
    // A follow-up session exposes the record's identity and prior answers as
    // on-screen context. Accepting a subject id from an unauthenticated caller
    // would therefore turn a public app link into a record-enumeration oracle:
    // walk the ids, read the registrations. REGISTER mode stays open to
    // anonymous respondents, because it reveals nothing it was not just given.
    let subjectId: string | null = null;
    if (options.subjectId) {
      if (!actor.userId) {
        throw new ForbiddenException(
          'You must be signed in to add an entry to an existing record.',
        );
      }
      subjectId = await this.assertSubjectUsableBy(app, options.subjectId);
    }

    const mode = subjectId ? 'FOLLOW_UP' : 'REGISTER';

    const stepKeys = await this.resolveRequestedStepKeys(
      app,
      subjectId,
      period?.id ?? null,
      options.stepKeys,
      mode,
    );

    // Said plainly, at the point of asking. An empty narrowing would otherwise
    // fall through to "no narrowing" and put the worker in front of a session
    // judged against every step in the app, whose only outcome is a refusal
    // naming a registration completed months ago.
    if (mode === 'FOLLOW_UP' && stepKeys.length === 0) {
      throw new ForbiddenException(
        'There is nothing left to record against this record right now.',
      );
    }

    const identity = actor.userId
      ? { respondentId: actor.userId }
      : { fingerprint: actor.fingerprint };

    // Scoped to the subject as well as the respondent: a field worker mid-round
    // has one unfinished visit per student, not one in total, and resuming
    // student A's staged answers when they opened student B's form would be a
    // data-corruption bug rather than a UX annoyance.
    const existing = app.allowDrafts
      ? await this.prisma.reader.formAppSession.findFirst({
          where: { appId, status: 'DRAFT', subjectId, ...identity },
          select: { id: true },
        })
      : null;

    if (existing) {
      // The narrowing is refreshed on resume: the worker may have come back
      // through a different "add entry" link than the one that opened it.
      if (stepKeys.length > 0) {
        await this.prisma.writer.formAppSession.update({
          where: { id: existing.id },
          data: { stepKeys: stepKeys as any },
        });
      }
      return this.getSession(appId, existing.id, actor);
    }

    const session = await this.prisma.writer.formAppSession.create({
      data: {
        appId,
        organizationId: app.organizationId,
        periodId: period?.id ?? null,
        status: 'DRAFT',
        mode,
        subjectId,
        stepKeys: stepKeys as any,
        respondentId: actor.userId ?? null,
        fingerprint: actor.userId ? null : (actor.fingerprint ?? null),
      },
      select: { id: true },
    });

    return this.getSession(appId, session.id, actor);
  }

  /**
   * The subject exists, belongs to this app's org AND its record type, and is
   * not deleted.
   *
   * The record-type check is not redundant with the org check: an organization
   * running a training programme and a grievance registry has subjects of both
   * kinds, and attaching a training progress check to a grievance would produce
   * a record whose timeline mixes two unrelated histories.
   */
  private async assertSubjectUsableBy(
    app: { organizationId: string; subjectTypeId: string },
    subjectId: string,
  ): Promise<string> {
    const subject = await this.prisma.reader.subject.findFirst({
      where: {
        id: subjectId,
        organizationId: app.organizationId,
        subjectTypeId: app.subjectTypeId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!subject) {
      throw new NotFoundException('Record not found for this app.');
    }
    return subject.id;
  }

  /**
   * Which steps the session may actually contain.
   *
   * Requested keys are filtered against real availability rather than accepted
   * as given: a stale "add entry" link, or a hand-edited request, must not be
   * able to open a second registration for somebody already registered.
   *
   * A FOLLOW_UP with NO request is narrowed to everything still open for the
   * record. Left unnarrowed it would be judged against every step in the app
   * and refused for a registration completed months ago — the very thing this
   * mode exists to avoid. A REGISTER with no request stays unnarrowed, because
   * there its steps genuinely are all of them.
   */
  private async resolveRequestedStepKeys(
    app: { id: string },
    subjectId: string | null,
    periodId: string | null,
    requested: string[] | undefined,
    mode: 'REGISTER' | 'FOLLOW_UP',
  ): Promise<string[]> {
    const asked = Array.isArray(requested)
      ? requested.filter((key) => typeof key === 'string').map(String)
      : [];

    if (asked.length === 0 && mode === 'REGISTER') return [];

    const availability = await this.stepsAvailableForSubject(
      app.id,
      subjectId,
      periodId,
    );
    const open = availability.filter((step) => step.available);

    if (asked.length === 0) return open.map((step) => step.stepKey);

    const wanted = new Set(asked);
    return open
      .filter((step) => wanted.has(step.stepKey))
      .map((step) => step.stepKey);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // AVAILABILITY
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Which steps are still open for a record, and why the rest are not.
   *
   * This is what a record page needs to render "Add entry". Unavailable steps
   * are RETURNED rather than filtered out, with a reason attached: a worker who
   * cannot find "Monthly Progress Check" in a menu learns nothing, whereas one
   * who sees it greyed with "already recorded for this period" learns that the
   * job is done. A menu that silently omits things reads as a bug.
   *
   * Costs two queries regardless of how many steps the app has — one for the
   * history, one for the conditions' answers (skipped entirely when no step has
   * a condition). Never one per step.
   */
  async stepsAvailableForSubject(
    appId: string,
    subjectId: string | null,
    periodId: string | null,
  ): Promise<StepAvailability[]> {
    const steps = await this.loadSteps(appId);
    if (steps.length === 0) return [];

    const [history, accumulated] = await Promise.all([
      this.loadSubjectHistory(
        subjectId,
        steps.map((step) => step.id),
      ),
      this.loadAccumulatedAnswers(subjectId, steps),
    ]);

    const visible = this.visibleSteps(steps, new Map(), accumulated);
    const visibleIds = new Set(visible.map((step) => step.id));

    return steps.map((step): StepAvailability => {
      const existingCount = history.countFor(step, periodId);
      const max = effectiveMax(step);
      const remaining = max === null ? null : Math.max(max - existingCount, 0);

      const base = {
        stepKey: step.key,
        title: step.title,
        description: step.description,
        icon: step.icon,
        order: step.order,
        scope: step.scope,
        mode: step.mode,
        formId: step.formId,
        formTitle: step.form.title,
        existingCount,
        remaining,
        lastOccurredAt: history.lastOccurredAt(step.id),
      };

      // A record that exists was already registered. Checked before scope so
      // that apps predating `scope` — where every step still says SESSION —
      // cannot offer a second registration and mint a duplicate identity.
      if (subjectId && step.form.subjectRole === 'REGISTERS') {
        return {
          ...base,
          available: false,
          reason: 'ALREADY_COMPLETED',
          detail: 'This record has already been registered.',
        };
      }

      if (!visibleIds.has(step.id)) {
        return {
          ...base,
          available: false,
          reason: 'HIDDEN_BY_CONDITION',
          detail: "This step does not apply to this record's answers.",
        };
      }

      if (max !== null && existingCount >= max) {
        const perPeriod = step.scope === 'SUBJECT_PERIOD';
        return {
          ...base,
          available: false,
          reason: perPeriod
            ? 'PERIOD_SATISFIED'
            : max === 1
              ? 'ALREADY_COMPLETED'
              : 'MAX_REACHED',
          detail: perPeriod
            ? max === 1
              ? 'Already recorded for this reporting period.'
              : `All ${max} entries for this reporting period are recorded.`
            : max === 1
              ? 'Already completed for this record.'
              : `All ${max} entries are recorded for this record.`,
        };
      }

      return { ...base, available: true, reason: 'OPEN', detail: null };
    });
  }

  /**
   * Everything that can be added to a record right now, across every app that
   * records against its type.
   *
   * This is what the record page's "Add entry" menu is built from. Grouped by
   * app rather than flattened: two apps may both define a step called "Visit",
   * and a worker choosing between them needs to know which programme they are
   * filing under.
   */
  async entryOptionsForSubject(orgId: string, subjectId: string) {
    const subject = await this.prisma.reader.subject.findFirst({
      where: { id: subjectId, organizationId: orgId, deletedAt: null },
      select: { id: true, subjectTypeId: true },
    });
    if (!subject) throw new NotFoundException('Record not found.');

    const apps = await this.prisma.reader.formApp.findMany({
      where: {
        organizationId: orgId,
        subjectTypeId: subject.subjectTypeId,
        isPublished: true,
        deletedAt: null,
      },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        icon: true,
        publicSlug: true,
        periods: {
          where: { isActive: true },
          orderBy: { startsAt: 'desc' },
          select: { id: true, label: true, startsAt: true, endsAt: true },
        },
      },
    });

    // Sequential rather than concurrent, and bounded by how many apps record
    // against ONE record type — in practice one, occasionally two. Fanning out
    // would trade a real connection-pool risk for a saving nobody can perceive.
    const options = [];
    for (const app of apps) {
      const period = this.activePeriod(app);
      const steps = await this.stepsAvailableForSubject(
        app.id,
        subjectId,
        period?.id ?? null,
      );
      options.push({
        app: {
          id: app.id,
          name: app.name,
          slug: app.slug,
          icon: app.icon,
          publicSlug: app.publicSlug,
        },
        period,
        // An app whose periods are all closed accepts nothing right now, and
        // says so once rather than repeating it on every step.
        isOutsidePeriod: app.periods.length > 0 && !period,
        steps,
      });
    }

    return { subjectId, options };
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
        period: {
          select: { id: true, label: true, startsAt: true, endsAt: true },
        },
        subject: {
          select: {
            id: true,
            displayName: true,
            externalId: true,
            attributes: true,
          },
        },
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
        answersByStepKey.set(
          step.key,
          (entry.answers ?? {}) as Record<string, unknown>,
        );
      }
    }

    // A follow-up session stages almost nothing: the answers its conditions
    // read were submitted months ago. Loaded only in that mode, so an ordinary
    // registration session pays nothing for the capability.
    const accumulated =
      session.mode === 'FOLLOW_UP'
        ? await this.loadAccumulatedAnswers(session.subjectId, steps)
        : new Map<string, Record<string, unknown>>();

    const conditionallyVisible = this.visibleSteps(
      steps,
      answersByStepKey,
      accumulated,
    );

    // The session's own narrowing, applied last. A step filtered out here is
    // not hidden — it simply is not what this sitting is for.
    const narrowing = Array.isArray(session.stepKeys)
      ? new Set((session.stepKeys as string[]).map(String))
      : new Set<string>();

    const visible = conditionallyVisible.filter((step) => {
      if (narrowing.size > 0 && !narrowing.has(step.key)) return false;
      // Registration is never part of a follow-up: the record already exists.
      if (session.mode === 'FOLLOW_UP' && step.form.subjectRole === 'REGISTERS')
        return false;
      return true;
    });
    const visibleIds = new Set(visible.map((step) => step.id));

    return {
      id: session.id,
      appId,
      status: session.status,
      mode: session.mode,
      period: session.period,
      startedAt: session.startedAt,
      submittedAt: session.submittedAt,
      subjectId: session.subjectId,
      // Who this sitting is about. The worker must see the record they are
      // recording against before they type anything — a follow-up form with no
      // subject on screen is indistinguishable from a blank one.
      subject: session.subject,
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
            // The form's OWN arrangement, which the app uses only when its
            // layout is INHERIT. Sent unconditionally because the app cannot
            // ask for it later — the session payload is the only thing the
            // public runner ever loads.
            layoutMode: step.form.layoutMode,
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
            .map((entry) => ({
              index: entry.index,
              answers: entry.answers ?? {},
            })),
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
    // Called for the assertion, not the row — matching the other call sites.
    await this.assertDraft(appId, sessionId, actor);

    const step = await this.prisma.reader.formAppStep.findFirst({
      where: { appId, key: stepKey },
      include: {
        form: {
          select: {
            id: true,
            currentVersion: true,
            versions: {
              orderBy: { version: 'desc' },
              take: 5,
              select: { id: true, version: true },
            },
          },
        },
      },
    });
    if (!step) throw new NotFoundException('Step not found.');

    if (step.mode === 'SINGLE' && index !== 0) {
      throw new BadRequestException(
        'This step is filled once and has only one entry.',
      );
    }
    if (index < 0 || index >= SESSION_LIMITS.MAX_ENTRIES_PER_STEP) {
      throw new BadRequestException('Entry index out of range.');
    }
    if (step.maxEntries !== null && index >= step.maxEntries) {
      throw new BadRequestException(
        `This step allows at most ${step.maxEntries} entries.`,
      );
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
    if (!activeVersion)
      throw new BadRequestException("That step's form is not published.");

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
      throw new BadRequestException(
        'This step is filled once and cannot be removed.',
      );
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
    await this.prisma.writer.formAppSessionEntry.deleteMany({
      where: { sessionId },
    });
    return { ok: true };
  }

  private async assertDraft(
    appId: string,
    sessionId: string,
    actor: SessionActor,
  ) {
    const identity = actor.userId
      ? { respondentId: actor.userId }
      : { fingerprint: actor.fingerprint ?? '__none__' };

    const session = await this.prisma.reader.formAppSession.findFirst({
      where: { id: sessionId, appId, ...identity },
      select: {
        id: true,
        status: true,
        organizationId: true,
        periodId: true,
        mode: true,
        subjectId: true,
        stepKeys: true,
      },
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
        answersByStepKey.set(
          step.key,
          (entry.answers ?? {}) as Record<string, unknown>,
        );
      }
    }

    const isFollowUp = session.mode === 'FOLLOW_UP';
    const boundSubjectId = isFollowUp ? session.subjectId : null;

    const accumulated = isFollowUp
      ? await this.loadAccumulatedAnswers(boundSubjectId, steps)
      : new Map<string, Record<string, unknown>>();

    const conditionallyVisible = this.visibleSteps(
      steps,
      answersByStepKey,
      accumulated,
    );

    // The session's narrowing bounds what this sitting is responsible for.
    // Without it, a session opened to add one progress check would be judged
    // against every step in the app and refused for a missing registration it
    // was never asked to collect.
    const narrowing = Array.isArray(session.stepKeys)
      ? new Set((session.stepKeys as string[]).map(String))
      : new Set<string>();

    const visible = conditionallyVisible.filter((step) => {
      if (narrowing.size > 0 && !narrowing.has(step.key)) return false;
      if (isFollowUp && step.form.subjectRole === 'REGISTERS') return false;
      return true;
    });
    const visibleIds = new Set(visible.map((step) => step.id));

    // Entries belonging to a step that is no longer visible are dropped, not
    // rejected: a respondent may legitimately have filled it and then changed
    // an earlier answer that hid it.
    const liveEntries = entries.filter((entry) => visibleIds.has(entry.stepId));

    const issues: Array<{
      stepKey: string;
      index: number;
      questionId?: string;
      message: string;
    }> = [];

    // ── Cardinality, in each step's own scope ────────────────────────────────
    //
    // `existing` is what the RECORD already has on file; `count` is what this
    // sitting adds. Counting only the sitting — the original behaviour, still
    // correct for SESSION scope — made `maxEntries: 6` on a monthly check mean
    // six per sitting, and made a minimum of 1 demand a registration the record
    // had completed months ago.
    const history = await this.loadSubjectHistory(
      boundSubjectId,
      steps.map((step) => step.id),
    );
    const periodId = session.periodId ?? null;

    for (const step of visible) {
      const count = liveEntries.filter(
        (entry) => entry.stepId === step.id,
      ).length;
      const existing = history.countFor(step, periodId);
      const total = existing + count;

      const min = effectiveMin(step);
      const max = effectiveMax(step);

      if (total < min) {
        issues.push({
          stepKey: step.key,
          index: 0,
          message:
            min === 1
              ? `"${step.title}" must be completed.`
              : `"${step.title}" needs at least ${min} entries.`,
        });
      }

      if (max !== null && total > max) {
        issues.push({
          stepKey: step.key,
          index: 0,
          message:
            existing > 0
              ? `"${step.title}" allows at most ${max} ${
                  step.scope === 'SUBJECT_PERIOD'
                    ? 'entries per reporting period'
                    : 'entries for this record'
                }, and ${existing} ${existing === 1 ? 'is' : 'are'} already recorded.`
              : `"${step.title}" allows at most ${max} entries.`,
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
          message:
            'The form for this entry has changed. Please review and re-enter it.',
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

    // ── Uniqueness within this sitting ───────────────────────────────────────
    // "Duplicate schools not allowed", expressed declaratively.
    for (const step of visible) {
      const uniqueBy = uniqueByKeys(step);
      if (uniqueBy.length === 0) continue;

      const keyToId = this.keyToId(step);
      const seen = new Map<string, number>();

      for (const entry of liveEntries.filter((e) => e.stepId === step.id)) {
        const answers =
          prepared.get(entry.id) ??
          (entry.answers as Record<string, any>) ??
          {};
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

    // ── Uniqueness against what the record already has ───────────────────────
    //
    // The check above compares entries staged side by side, which is all that
    // was ever possible when cardinality lived inside one sitting. It cannot
    // see that March was already recorded last week, in a session that closed.
    //
    // This pass is for the error MESSAGE. The guarantee is the partial unique
    // index on (subject_id, form_app_step_id, occurrence_key), because two
    // coordinators submitting March concurrently both read a count of zero here
    // and both pass. Caught below as P2002.
    const occurrenceByEntryId = new Map<string, string>();

    for (const step of visible) {
      if (step.scope === 'SESSION') continue;

      const keyToId = this.keyToId(step);

      for (const entry of liveEntries.filter((e) => e.stepId === step.id)) {
        const answers =
          prepared.get(entry.id) ??
          (entry.answers as Record<string, any>) ??
          {};

        const occurrence = occurrenceKeyFor(step, periodId, answers, keyToId);
        if (!occurrence) continue;
        occurrenceByEntryId.set(entry.id, occurrence);

        if (history.hasOccurrence(step.id, occurrence)) {
          const label = occurrenceLabelFor(step, answers, keyToId);
          issues.push({
            stepKey: step.key,
            index: entry.index,
            message: label
              ? `"${step.title}" already has an entry for ${label} on this record.`
              : step.scope === 'SUBJECT_PERIOD'
                ? `"${step.title}" is already recorded for this reporting period.`
                : `"${step.title}" is already recorded for this record.`,
          });
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
    const registrationStep = visible.find(
      (step) => step.form.subjectRole === 'REGISTERS',
    );
    const registrationEntry = registrationStep
      ? liveEntries.find(
          (entry) => entry.stepId === registrationStep.id && entry.index === 0,
        )
      : undefined;

    const dailySalt = new Date().toISOString().slice(0, 10);
    const respondentIpHash = meta.ip
      ? createHash('sha256')
          .update(meta.ip + dailySalt)
          .digest('hex')
      : null;

    const submittedAt = new Date();
    const created: Array<{
      submissionId: string;
      formId: string;
      formVersionId: string;
    }> = [];

    const result = await this.prisma.writer
      .$transaction(async (tx) => {
        // A follow-up already knows who it is about, and re-resolving would be
        // actively wrong: the identity answers are not in this session, so the
        // hash would be computed from nothing and mint a second record.
        let subjectId: string | null = boundSubjectId;

        if (!subjectId && registrationStep && registrationEntry) {
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
          const answers = prepared.get(entry.id) ?? {};

          // Recomputed here rather than reused from the pre-flight pass: for a
          // REGISTER session the subject did not exist until a moment ago, so the
          // occurrence of its very first entries could not have been keyed then.
          const occurrenceKey =
            subjectId && step.scope !== 'SESSION'
              ? (occurrenceByEntryId.get(entry.id) ??
                occurrenceKeyFor(step, periodId, answers, this.keyToId(step)))
              : null;

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
              answers: answers as any,
              completionTimeMs: 0,
              submittedAt,
              // The date the thing HAPPENED, which is not the date it was typed.
              // A February visit entered in March belongs in February, and the
              // timeline orders by this.
              occurredAt: occurredAtFor(
                step,
                answers,
                this.keyToId(step),
                submittedAt,
              ),
              appSessionId: sessionId,
              formAppStepId: step.id,
              periodId,
              occurrenceKey,
              status: 'SUBMITTED',
            },
          });

          await tx.formAppSessionEntry.update({
            where: { id: entry.id },
            data: { submissionId },
          });

          created.push({
            submissionId,
            formId: step.formId,
            formVersionId: entry.formVersionId,
          });
        }

        // The registration submission is what the subject was created from.
        if (subjectId && registrationEntry) {
          const registrationSubmission = created.find(
            (item) => item.formId === registrationStep!.formId,
          );
          if (registrationSubmission) {
            await tx.subject.updateMany({
              where: { id: subjectId, registrationSubmissionId: null },
              data: {
                registrationSubmissionId: registrationSubmission.submissionId,
              },
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
      })
      .catch((err: any) => {
        // The occurrence index fired. Reaching here means the pre-flight check
        // above passed and the row still collided, which is the concurrent case
        // it cannot cover: two coordinators submitting the same month for the
        // same record both read a count of zero, and the database arbitrates.
        //
        // Surfaced as the same 422 shape a pre-flight duplicate produces, so the
        // runner renders it identically and the respondent cannot tell — nor
        // should they — whether they lost a race or simply repeated themselves.
        if (
          err?.code === 'P2002' &&
          String(err?.meta?.target ?? '').includes('occurrence')
        ) {
          throw new UnprocessableEntityException({
            message: 'This report cannot be submitted yet.',
            issues: [
              {
                stepKey: '',
                index: 0,
                message:
                  'Someone recorded this same entry for this record a moment ago. Reload the record to see it.',
              },
            ],
          });
        }
        throw err;
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
            error,
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

    const displayKeys = Array.isArray(config.displayName)
      ? config.displayName
      : [];
    const displayName =
      displayKeys.map(read).filter(Boolean).join(' ').trim() ||
      `${input.subjectType.name} record`;

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
    for (const key of Array.isArray(config.attributes)
      ? config.attributes
      : []) {
      const value = read(key);
      if (value) attributes[key] = value;
    }

    const existing = await tx.subject.findFirst({
      where: {
        subjectTypeId: input.subjectType.id,
        externalId,
        deletedAt: null,
      },
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
  private async assertSessionWithinQuota(
    organizationId: string,
    entryCount: number,
  ) {
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

    // Deliberately NOT given the `deletedAt: null` filter that every display
    // read path gained alongside soft delete. This is admission control, not a
    // view: the schema comment on FormSubmission.deletedAt states that quota is
    // charged on receipt and is not refunded, so a response that was received
    // and later deleted still occupies a slot in the month it arrived. Filtering
    // it out here would make "submit, then delete" an unlimited quota bypass.
    // (The pre-existing `status` exclusion is left as-is rather than widened in
    // this change — see WIRING-submissions.md.)
    const used = await this.prisma.reader.formSubmission.count({
      where: {
        organizationId,
        submittedAt: { gte: monthStart },
        status: { not: 'DELETED' },
      },
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
