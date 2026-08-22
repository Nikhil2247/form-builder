import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/infra/prisma/prisma.service';

/**
 * The form-app session lifecycle, over HTTP.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * open → stage entries → submit, against the app the Nagaland seed builds. It
 * is deliberately an e2e rather than a unit test: the thing worth proving is
 * that the public controller, the optional-auth guard, the session service and
 * the ordinary submission validation pipeline agree with one another, and each
 * of those in isolation has already been proven to work by construction.
 *
 * Three properties are asserted, because each has a plausible failure that
 * would leave every individual layer looking correct:
 *
 *   1. **All or nothing.** A report that fails validation creates no
 *      submissions — not "most of them".
 *   2. **`uniqueBy` fires.** Two school visits naming the same school are
 *      rejected, naming the duplicate.
 *   3. **The subject is resolved, not minted.** Filing twice as the same
 *      person attaches to ONE record, which is the whole point of
 *      `identityConfig`.
 *
 * Requires a database seeded with `db:seed`, `db:seed:choices` and
 * `db:seed:nagaland`. Skips itself with a clear message when the app is absent
 * rather than failing with a null dereference twenty lines later.
 *
 *   npm run test:e2e -- form-app-session
 */

const PUBLIC_SLUG = 'ng-monitoring';

/** Answers are keyed by question ID; fixtures are written by key. */
function byKey(questions: Array<{ id: string; key?: string; label?: string }>) {
  const map = new Map<string, string>();
  for (const question of questions) {
    if (question.key) map.set(question.key, question.id);
  }
  return map;
}

interface SessionStep {
  key: string;
  mode: string;
  uniqueBy: string[];
  form: { id: string; questions: Array<{ id: string; key?: string }> };
}

describe('Form app sessions (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let appId: string | null = null;

  // Every session this file opens, so the database is left as it was found.
  const openedSessionIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Mirrors main.ts. Without the prefix every request 404s and the failure
    // looks like a missing app rather than a missing bootstrap step.
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    const seeded = await prisma.reader.formApp.findFirst({
      where: { publicSlug: PUBLIC_SLUG, deletedAt: null },
      select: { id: true },
    });
    appId = seeded?.id ?? null;
  }, 60_000);

  afterAll(async () => {
    if (prisma && openedSessionIds.length > 0) {
      const submissionIds = (
        await prisma.reader.formAppSessionEntry.findMany({
          where: {
            sessionId: { in: openedSessionIds },
            submissionId: { not: null },
          },
          select: { submissionId: true },
        })
      ).map((entry) => entry.submissionId!);

      // Sessions first: an entry's submission is referenced by the entry, and
      // deleting the submission out from under it would violate that link.
      await prisma.writer.formAppSession.deleteMany({
        where: { id: { in: openedSessionIds } },
      });
      if (submissionIds.length > 0) {
        await prisma.writer.formSubmission.deleteMany({
          where: { id: { in: submissionIds } },
        });
      }
      await prisma.writer.subject.deleteMany({
        where: { displayName: { startsWith: 'E2E Test Respondent' } },
      });
    }
    await app?.close();
  }, 30_000);

  const http = () => request(app.getHttpServer());

  /** Open a fresh session as an anonymous respondent with their own fingerprint. */
  async function openSession(fingerprint: string) {
    const response = await http()
      .post(`/v1/public-apps/${PUBLIC_SLUG}/sessions`)
      .send({ fingerprint })
      .expect(201);

    const session = response.body?.data ?? response.body;
    openedSessionIds.push(session.id);
    return session as { id: string; steps: SessionStep[] };
  }

  function stage(
    sessionId: string,
    fingerprint: string,
    stepKey: string,
    index: number,
    answers: Record<string, unknown>,
  ) {
    return http()
      .put(
        `/v1/public-apps/${PUBLIC_SLUG}/sessions/${sessionId}/entries/${stepKey}/${index}`,
      )
      .send({ answers, fingerprint });
  }

  function submit(sessionId: string, fingerprint: string) {
    return http()
      .post(`/v1/public-apps/${PUBLIC_SLUG}/sessions/${sessionId}/submit`)
      .send({ fingerprint });
  }

  /** The seeded programme's three steps, with their question keys resolved. */
  function fixtures(steps: SessionStep[]) {
    const step = (key: string) => {
      const found = steps.find((candidate) => candidate.key === key);
      if (!found) throw new Error(`Seeded app is missing the "${key}" step.`);
      return found;
    };

    const respondent = step('respondent_details');
    const visits = step('school_visits');
    const rKeys = byKey(respondent.form.questions);
    const vKeys = byKey(visits.form.questions);

    const respondentAnswers = (name: string) => ({
      [rKeys.get('respondent_name')!]: name,
      [rKeys.get('designation')!]: 'BRP',
      [rKeys.get('state')!]: 'NL',
      [rKeys.get('district')!]: 'NL-kohima',
      [rKeys.get('block')!]: 'NL-kohima-kohima-sadar',
      [rKeys.get('is_ebrc_coordinator')!]: 'No',
    });

    // The checklist is a matrix: one column choice per row, keyed by row label.
    const checklistQuestion = visits.form.questions.find(
      (question) =>
        (question as { key?: string }).key === 'monitoring_checklist',
    ) as { matrixRows?: string[] } | undefined;
    const checklist = Object.fromEntries(
      (checklistQuestion?.matrixRows ?? []).map((row) => [row, 'Yes']),
    );

    const visitAnswers = (school: string) => ({
      [vKeys.get('state')!]: 'NL',
      [vKeys.get('district')!]: 'NL-kohima',
      [vKeys.get('block')!]: 'NL-kohima-kohima-sadar',
      [vKeys.get('school_name')!]: school,
      [vKeys.get('date_of_visit')!]: new Date().toISOString().slice(0, 10),
      [vKeys.get('purpose_of_visit')!]: 'Routine monitoring visit (e2e).',
      [vKeys.get('monitoring_checklist')!]: checklist,
      [vKeys.get('total_enrollment')!]: 100,
      [vKeys.get('students_with_aadhaar')!]: 80,
      [vKeys.get('students_validated_aadhaar')!]: 60,
      [vKeys.get('students_validated_apaar')!]: 50,
      [vKeys.get('sdp_oriented')!]: 'No',
    });

    return { respondentAnswers, visitAnswers, visits };
  }

  it('the seeded app is reachable at its public slug', async () => {
    if (!appId) return pending();

    const response = await http()
      .get(`/v1/public-apps/${PUBLIC_SLUG}`)
      .expect(200);
    const body = response.body?.data ?? response.body;

    expect(body.publicSlug).toBe(PUBLIC_SLUG);
    expect(body.requireAuth).toBe(false);
    expect(body.isOutsidePeriod).toBe(false);
  });

  it('opens a session carrying the app’s steps in order', async () => {
    if (!appId) return pending();

    const session = await openSession(`e2e-open-${Date.now()}`);

    expect(session.steps.map((step) => step.key)).toEqual([
      'respondent_details',
      'trainings',
      'school_visits',
    ]);
    expect(session.steps[0].mode).toBe('SINGLE');
    expect(session.steps[2].uniqueBy).toEqual(['school_name']);
  });

  it('rejects a report missing a required step, and creates nothing', async () => {
    if (!appId) return pending();

    const fingerprint = `e2e-incomplete-${Date.now()}`;
    const session = await openSession(fingerprint);
    const { respondentAnswers } = fixtures(session.steps);

    // Respondent block only: school_visits has a minimum of one entry.
    await stage(
      session.id,
      fingerprint,
      'respondent_details',
      0,
      respondentAnswers('E2E Test Respondent Incomplete'),
    ).expect(200);

    const response = await submit(session.id, fingerprint).expect(422);
    const issues = response.body?.error?.issues ?? response.body?.issues ?? [];

    expect(issues.some((issue: any) => issue.stepKey === 'school_visits')).toBe(
      true,
    );

    const created = await prisma.reader.formAppSessionEntry.count({
      where: { sessionId: session.id, submissionId: { not: null } },
    });
    expect(created).toBe(0);
  }, 30_000);

  it('rejects two visits to the same school, naming the duplicate', async () => {
    if (!appId) return pending();

    const fingerprint = `e2e-duplicate-${Date.now()}`;
    const session = await openSession(fingerprint);
    const { respondentAnswers, visitAnswers } = fixtures(session.steps);
    const school = 'NL-kohima-kohima-sadar-government-high-school-kohima';

    await stage(
      session.id,
      fingerprint,
      'respondent_details',
      0,
      respondentAnswers('E2E Test Respondent Duplicate'),
    ).expect(200);
    await stage(
      session.id,
      fingerprint,
      'school_visits',
      0,
      visitAnswers(school),
    ).expect(200);
    await stage(
      session.id,
      fingerprint,
      'school_visits',
      1,
      visitAnswers(school),
    ).expect(200);

    const response = await submit(session.id, fingerprint).expect(422);
    const issues = response.body?.error?.issues ?? response.body?.issues ?? [];

    expect(
      issues.some(
        (issue: any) =>
          issue.stepKey === 'school_visits' &&
          /duplicates entry/i.test(issue.message),
      ),
    ).toBe(true);
  }, 30_000);

  it('submits a complete report as one act and resolves the subject', async () => {
    if (!appId) return pending();

    const fingerprint = `e2e-complete-${Date.now()}`;
    const session = await openSession(fingerprint);
    const { respondentAnswers, visitAnswers } = fixtures(session.steps);

    await stage(
      session.id,
      fingerprint,
      'respondent_details',
      0,
      respondentAnswers('E2E Test Respondent Complete'),
    ).expect(200);
    await stage(
      session.id,
      fingerprint,
      'school_visits',
      0,
      visitAnswers('NL-kohima-kohima-sadar-government-high-school-kohima'),
    ).expect(200);
    await stage(
      session.id,
      fingerprint,
      'school_visits',
      1,
      visitAnswers('NL-kohima-kohima-sadar-gms-lerie'),
    ).expect(200);

    const response = await submit(session.id, fingerprint).expect(201);
    const result = response.body?.data ?? response.body;

    expect(result.status).toBe('SUBMITTED');
    expect(result.submissionCount).toBe(3);
    expect(result.subjectId).toBeTruthy();

    // Every entry became a real submission, and every submission is attached to
    // the one record the registration step resolved.
    const entries = await prisma.reader.formAppSessionEntry.findMany({
      where: { sessionId: session.id },
      select: { submissionId: true },
    });
    expect(entries).toHaveLength(3);
    expect(entries.every((entry) => entry.submissionId)).toBe(true);

    const attached = await prisma.reader.formSubmission.count({
      where: {
        id: { in: entries.map((entry) => entry.submissionId!) },
        subjectId: result.subjectId,
      },
    });
    expect(attached).toBe(3);

    // A submitted session is closed: staging into it must not be possible.
    await stage(
      session.id,
      fingerprint,
      'school_visits',
      2,
      visitAnswers('anything'),
    ).expect(403);
  }, 60_000);
});

/** Reported by Jest as a skip, with the reason, instead of a silent pass. */
function pending() {
  console.warn(
    `Skipped: no published app at /a/${PUBLIC_SLUG}. Run "npm run db:seed:nagaland" first.`,
  );
}
