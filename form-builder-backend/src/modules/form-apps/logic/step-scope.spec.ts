import {
  SubjectHistory,
  effectiveMax,
  effectiveMin,
  occurredAtFor,
  occurrenceKeyFor,
  occurrenceLabelFor,
  type ScopedStep,
} from './step-scope';

/**
 * Step scope is the piece of longitudinal recording that is easy to get subtly
 * wrong and expensive to notice: a mistake here does not crash, it silently
 * merges two students' histories or refuses a visit that never happened.
 *
 * The cases below are the ones that actually bit during design — cycle
 * boundaries, unkeyed singletons, and the difference between "no answer" and
 * "no identity".
 */

const step = (over: Partial<ScopedStep> = {}): ScopedStep => ({
  id: 'step-1',
  key: 'progress',
  title: 'Monthly Progress Check',
  mode: 'REPEATABLE',
  scope: 'SUBJECT_PERIOD',
  minEntries: 0,
  maxEntries: 6,
  isOptional: false,
  uniqueBy: ['month_number'],
  occurredAtKey: null,
  ...over,
});

/** question key → question id, as the form version defines it. */
const keyToId = new Map([
  ['month_number', 'q-month'],
  ['visit_date', 'q-date'],
  ['assessment_type', 'q-type'],
]);

describe('effectiveMin / effectiveMax', () => {
  it('folds SINGLE into a ceiling and a floor of one', () => {
    const single = step({ mode: 'SINGLE', minEntries: 0, maxEntries: null });
    expect(effectiveMax(single)).toBe(1);
    expect(effectiveMin(single)).toBe(1);
  });

  it('lets isOptional relax the floor but never the ceiling', () => {
    const optional = step({ mode: 'SINGLE', isOptional: true });
    expect(effectiveMin(optional)).toBe(0);
    expect(effectiveMax(optional)).toBe(1);
  });

  it('leaves an unbounded repeatable step unbounded', () => {
    expect(effectiveMax(step({ maxEntries: null }))).toBeNull();
  });
});

describe('occurrenceKeyFor', () => {
  it('is null for SESSION scope — there is no cross-session identity', () => {
    const key = occurrenceKeyFor(
      step({ scope: 'SESSION' }),
      'period-1',
      { 'q-month': 3 },
      keyToId,
    );
    expect(key).toBeNull();
  });

  it('is stable for the same answer in the same period', () => {
    const a = occurrenceKeyFor(step(), 'period-1', { 'q-month': 3 }, keyToId);
    const b = occurrenceKeyFor(step(), 'period-1', { 'q-month': 3 }, keyToId);
    expect(a).toBe(b);
    expect(a).not.toBeNull();
  });

  it('distinguishes different answers', () => {
    const three = occurrenceKeyFor(step(), 'p1', { 'q-month': 3 }, keyToId);
    const four = occurrenceKeyFor(step(), 'p1', { 'q-month': 4 }, keyToId);
    expect(three).not.toBe(four);
  });

  it('normalises case and surrounding space, so "Final" and " final " collide', () => {
    const assessment = step({
      uniqueBy: ['assessment_type'],
      scope: 'SUBJECT',
    });
    const a = occurrenceKeyFor(
      assessment,
      null,
      { 'q-type': 'Final' },
      keyToId,
    );
    const b = occurrenceKeyFor(
      assessment,
      null,
      { 'q-type': ' final ' },
      keyToId,
    );
    expect(a).toBe(b);
  });

  // The cycle boundary. Without the period in the key, January–June's "month 3"
  // would block July–December's and a programme could be run exactly once.
  it('separates periods under SUBJECT_PERIOD scope', () => {
    const cycle1 = occurrenceKeyFor(
      step(),
      'period-1',
      { 'q-month': 3 },
      keyToId,
    );
    const cycle2 = occurrenceKeyFor(
      step(),
      'period-2',
      { 'q-month': 3 },
      keyToId,
    );
    expect(cycle1).not.toBe(cycle2);
  });

  // …and the converse: a lifetime-scoped step must NOT be re-openable each
  // cycle, or "registered once, ever" would mean "once a period".
  it('ignores the period under SUBJECT scope', () => {
    const lifetime = step({ scope: 'SUBJECT' });
    const a = occurrenceKeyFor(lifetime, 'period-1', { 'q-month': 3 }, keyToId);
    const b = occurrenceKeyFor(lifetime, 'period-2', { 'q-month': 3 }, keyToId);
    expect(a).toBe(b);
  });

  it('never lets two different steps share an occurrence', () => {
    const one = occurrenceKeyFor(
      step({ id: 'a' }),
      'p',
      { 'q-month': 1 },
      keyToId,
    );
    const two = occurrenceKeyFor(
      step({ id: 'b' }),
      'p',
      { 'q-month': 1 },
      keyToId,
    );
    expect(one).not.toBe(two);
  });

  describe('when no uniqueBy is declared', () => {
    it('treats a step that may exist once as its own identity', () => {
      const registration = step({
        scope: 'SUBJECT',
        mode: 'SINGLE',
        uniqueBy: [],
      });
      expect(occurrenceKeyFor(registration, null, {}, keyToId)).not.toBeNull();
    });

    it('gives an unkeyed multi-entry step no identity at all', () => {
      // Three unkeyed entries have no way to say which of the three a new one
      // is, so only the count can govern them.
      const loose = step({ scope: 'SUBJECT', maxEntries: 3, uniqueBy: [] });
      expect(occurrenceKeyFor(loose, null, {}, keyToId)).toBeNull();
    });
  });

  // A blank required field must fail as a blank required field. Hashing
  // emptiness would make every unfilled entry collide with every other and
  // report a duplicate instead.
  it('gives an entry whose unique answers are all blank no identity', () => {
    expect(occurrenceKeyFor(step(), 'p1', {}, keyToId)).toBeNull();
    expect(
      occurrenceKeyFor(step(), 'p1', { 'q-month': '  ' }, keyToId),
    ).toBeNull();
  });
});

describe('occurredAtFor', () => {
  const fallback = new Date('2026-03-20T10:00:00.000Z');

  it('falls back when the step nominates no date question', () => {
    expect(occurredAtFor(step(), {}, keyToId, fallback)).toEqual(fallback);
  });

  it('reads the nominated answer', () => {
    const dated = step({ occurredAtKey: 'visit_date' });
    const at = occurredAtFor(
      dated,
      { 'q-date': '2026-02-14' },
      keyToId,
      fallback,
    );
    expect(at.toISOString()).toBe('2026-02-14T00:00:00.000Z');
  });

  // The whole point: a February visit typed up in March belongs in February.
  it('backdates ahead of the submission time', () => {
    const dated = step({ occurredAtKey: 'visit_date' });
    const at = occurredAtFor(
      dated,
      { 'q-date': '2026-02-14' },
      keyToId,
      fallback,
    );
    expect(at.getTime()).toBeLessThan(fallback.getTime());
  });

  it('falls back rather than throwing on an unreadable date', () => {
    const dated = step({ occurredAtKey: 'visit_date' });
    expect(
      occurredAtFor(dated, { 'q-date': 'not a date' }, keyToId, fallback),
    ).toEqual(fallback);
    expect(occurredAtFor(dated, { 'q-date': '' }, keyToId, fallback)).toEqual(
      fallback,
    );
  });

  it('rejects years so far out they can only be a typo', () => {
    const dated = step({ occurredAtKey: 'visit_date' });
    expect(
      occurredAtFor(dated, { 'q-date': '0202-02-14' }, keyToId, fallback),
    ).toEqual(fallback);
  });
});

describe('SubjectHistory', () => {
  const rows = [
    {
      formAppStepId: 'step-1',
      periodId: 'p1',
      occurrenceKey: 'k1',
      occurredAt: new Date('2026-01-10'),
    },
    {
      formAppStepId: 'step-1',
      periodId: 'p1',
      occurrenceKey: 'k2',
      occurredAt: new Date('2026-02-10'),
    },
    {
      formAppStepId: 'step-1',
      periodId: 'p2',
      occurrenceKey: 'k3',
      occurredAt: new Date('2026-08-10'),
    },
    {
      formAppStepId: 'step-2',
      periodId: null,
      occurrenceKey: null,
      occurredAt: new Date('2026-01-05'),
    },
  ];
  const history = new SubjectHistory(rows);

  it('counts a SUBJECT-scoped step across every period', () => {
    expect(history.countFor(step({ scope: 'SUBJECT' }), 'p1')).toBe(3);
  });

  it('counts a SUBJECT_PERIOD step only within the period asked about', () => {
    expect(history.countFor(step({ scope: 'SUBJECT_PERIOD' }), 'p1')).toBe(2);
    expect(history.countFor(step({ scope: 'SUBJECT_PERIOD' }), 'p2')).toBe(1);
  });

  // A SESSION-scoped step's history IS the current sitting, which the caller
  // holds and this class never sees. Answering anything but zero would double
  // count the entries the caller is about to add.
  it('reports zero for a SESSION-scoped step', () => {
    expect(history.countFor(step({ scope: 'SESSION' }), 'p1')).toBe(0);
  });

  it('recognises an occurrence already on file', () => {
    expect(history.hasOccurrence('step-1', 'k1')).toBe(true);
    expect(history.hasOccurrence('step-1', 'nope')).toBe(false);
    expect(history.hasOccurrence('step-2', 'k1')).toBe(false);
  });

  it('reports the most recent occurrence, not the most recently written', () => {
    expect(history.lastOccurredAt('step-1')).toEqual(new Date('2026-08-10'));
  });

  it('is empty for a record with nothing on file', () => {
    const empty = SubjectHistory.empty();
    expect(empty.countFor(step({ scope: 'SUBJECT' }), null)).toBe(0);
    expect(empty.lastOccurredAt('step-1')).toBeNull();
  });

  it('ignores rows with no step, which are standalone submissions', () => {
    const mixed = new SubjectHistory([
      {
        formAppStepId: null,
        periodId: null,
        occurrenceKey: 'x',
        occurredAt: new Date(),
      },
    ]);
    expect(mixed.countFor(step({ scope: 'SUBJECT' }), null)).toBe(0);
  });
});

describe('occurrenceLabelFor', () => {
  it('names the occurrence from its unique answers', () => {
    expect(occurrenceLabelFor(step(), { 'q-month': 3 }, keyToId)).toBe('3');
  });

  it('joins a composite key', () => {
    const composite = step({ uniqueBy: ['month_number', 'assessment_type'] });
    expect(
      occurrenceLabelFor(
        composite,
        { 'q-month': 3, 'q-type': 'Final' },
        keyToId,
      ),
    ).toBe('3 · Final');
  });

  it('is null when there is nothing to name it by', () => {
    expect(occurrenceLabelFor(step({ uniqueBy: [] }), {}, keyToId)).toBeNull();
  });
});
