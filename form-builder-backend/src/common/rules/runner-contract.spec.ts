import { compileRules, runFormRules, readPlan, type FormRule } from './index';

/**
 * The contract the browser runner depends on.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `frontend/src/lib/rules` is a byte-for-byte mirror of this directory, and
 * `useFormRules` calls exactly the two functions exercised here — `compileRules`
 * for the builder preview (authored rules) and `readPlan` + `runFormRules` for
 * the public form (a compiled plan). These tests pin the behaviour the runner's
 * rendering now relies on:
 *
 *   • a CALCULATE rule produces a value under the TARGET QUESTION'S ID, which
 *     is what the runner displays in place of an input;
 *   • a client-supplied value for a calculated field is discarded, not merged;
 *   • SHOW / REQUIRE / VALIDATE report against question ids too.
 *
 * Before this was wired up, every one of these outputs was computed on the
 * submit path and thrown away without the respondent ever seeing it.
 */
describe('rules engine — runner contract', () => {
  const questions = [
    { id: 'q_dob', key: 'date_of_birth', type: 'DATE' },
    { id: 'q_age', key: 'age', type: 'NUMBER' },
    { id: 'q_a', key: 'amount_a', type: 'NUMBER' },
    { id: 'q_b', key: 'amount_b', type: 'NUMBER' },
    { id: 'q_total', key: 'total', type: 'NUMBER' },
    { id: 'q_why', key: 'why', type: 'SHORT_TEXT' },
  ];
  const knownKeys = questions.map((q) => q.key);

  const compile = (rules: FormRule[]) => {
    const result = compileRules(rules, { knownKeys, allowReferences: false });
    if (!result.ok) throw new Error(result.errors.map((e) => e.message).join('; '));
    return result.plan;
  };

  it('computes an age the respondent can be shown, keyed by question id', () => {
    const plan = compile([
      {
        id: 'r1',
        kind: 'CALCULATE',
        target: 'age',
        expr: { op: 'yearsBetween', args: [{ field: 'date_of_birth' }, { op: 'today', args: [] }] },
      },
    ]);

    const out = runFormRules({
      questions,
      plan,
      answersById: { q_dob: '1990-06-15' },
      evalTime: new Date('2026-08-10T00:00:00Z'),
    });

    expect(out.answersById.q_age).toBe(36);
    expect(out.calculatedQuestionIds.has('q_age')).toBe(true);
  });

  it('is null, not stale, when the calculation has no input yet', () => {
    const plan = compile([
      {
        id: 'r1',
        kind: 'CALCULATE',
        target: 'age',
        expr: { op: 'yearsBetween', args: [{ field: 'date_of_birth' }, { op: 'today', args: [] }] },
      },
    ]);

    const out = runFormRules({ questions, plan, answersById: {} });
    expect(out.answersById.q_age).toBeNull();
  });

  it('discards a client-supplied value for a calculated field', () => {
    const plan = compile([
      {
        id: 'r1',
        kind: 'CALCULATE',
        target: 'total',
        expr: { op: 'add', args: [{ field: 'amount_a' }, { field: 'amount_b' }] },
      },
    ]);

    const out = runFormRules({
      questions,
      plan,
      // A respondent posting a total of their own choosing.
      answersById: { q_a: 2, q_b: 3, q_total: 9999 },
    });

    expect(out.answersById.q_total).toBe(5);
  });

  it('cascades derived values in dependency order', () => {
    const plan = compile([
      {
        id: 'r_total',
        kind: 'CALCULATE',
        target: 'total',
        expr: { op: 'add', args: [{ field: 'amount_a' }, { field: 'amount_b' }] },
      },
      {
        id: 'r_age',
        kind: 'CALCULATE',
        // Depends on `total`, and is declared first in the plan's input order.
        target: 'age',
        expr: { op: 'mul', args: [{ field: 'total' }, { lit: 2 }] },
      },
    ]);

    const out = runFormRules({ questions, plan, answersById: { q_a: 1, q_b: 2 } });
    expect(out.answersById.q_total).toBe(3);
    expect(out.answersById.q_age).toBe(6);
  });

  it('reports SHOW, REQUIRE and VALIDATE against question ids', () => {
    const plan = compile([
      {
        id: 'r_show',
        kind: 'SHOW',
        target: 'why',
        expr: { op: 'lt', args: [{ field: 'amount_a' }, { lit: 7 }] },
      },
      {
        id: 'r_require',
        kind: 'REQUIRE',
        target: 'why',
        expr: { op: 'lt', args: [{ field: 'amount_a' }, { lit: 7 }] },
      },
      {
        id: 'r_validate',
        kind: 'VALIDATE',
        target: 'amount_b',
        message: 'Amount B cannot exceed Amount A.',
        expr: { op: 'gt', args: [{ field: 'amount_b' }, { field: 'amount_a' }] },
      },
    ]);

    const low = runFormRules({ questions, plan, answersById: { q_a: 3, q_b: 9 } });
    expect(low.hiddenQuestionIds.has('q_why')).toBe(false);
    expect(low.requiredQuestionIds.has('q_why')).toBe(true);
    expect(low.violations).toEqual([
      expect.objectContaining({ questionId: 'q_b', message: 'Amount B cannot exceed Amount A.' }),
    ]);

    const high = runFormRules({ questions, plan, answersById: { q_a: 9, q_b: 3 } });
    expect(high.hiddenQuestionIds.has('q_why')).toBe(true);
    // Hidden wins: a question the respondent cannot see must not be mandatory.
    expect(high.requiredQuestionIds.has('q_why')).toBe(false);
    expect(high.violations).toHaveLength(0);
  });

  it('degrades to no rules when the stored plan is missing or malformed', () => {
    // What the public endpoint serves for a version published before rules
    // existed, and what a hand-edited row could contain.
    for (const stored of [undefined, null, {}, [], 'nonsense', 42]) {
      const plan = readPlan(stored);
      const out = runFormRules({ questions, plan, answersById: { q_a: 1 } });
      expect(out.answersById.q_a).toBe(1);
      expect(out.calculatedQuestionIds.size).toBe(0);
      expect(out.violations).toHaveLength(0);
    }
  });

  it('falls back to the question id when a version predates keys', () => {
    // Older versions have no `key` on their questions; the adapter uses the id
    // as the key so a rule authored against such a version still resolves.
    const legacy = [{ id: 'amount_a', type: 'NUMBER' }, { id: 'total', type: 'NUMBER' }];
    const plan = compileRules(
      [
        {
          id: 'r1',
          kind: 'CALCULATE',
          target: 'total',
          expr: { op: 'mul', args: [{ field: 'amount_a' }, { lit: 3 }] },
        },
      ],
      { knownKeys: ['amount_a', 'total'], allowReferences: false },
    );
    if (!plan.ok) throw new Error('expected the plan to compile');

    const out = runFormRules({ questions: legacy, plan: plan.plan, answersById: { amount_a: 4 } });
    expect(out.answersById.total).toBe(12);
  });
});
