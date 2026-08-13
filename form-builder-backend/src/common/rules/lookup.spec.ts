import { lookupKey, type FormRule } from './ast';
import { compileRules } from './compiler';
import { planLookupRequests, resolveLookupBag } from './lookup-bag';
import { runFormRules } from './form-adapter';

/**
 * `lookup()` — reading a column of the choice-list item the respondent picked.
 *
 * This is the mechanism behind an auto-filled read-only field: pick a school,
 * and its UDISE code appears. The tests below pin the two things that make it
 * safe to run on the submit path:
 *
 *   • the compiler REJECTS any shape that would need more than one resolve
 *     pass, so the interpreter never has to perform I/O;
 *   • an unresolvable lookup is `null`, never an error — a respondent who has
 *     not picked a school yet is an ordinary state, not a fault.
 */
describe('lookup()', () => {
  const knownKeys = ['school_name', 'udise_code', 'district', 'block'];
  const knownChoiceLists = ['ng-schools', 'in-districts'];

  const compile = (rules: FormRule[], opts: Record<string, unknown> = {}) =>
    compileRules(rules, { knownKeys, allowReferences: false, ...opts });

  const udiseRule: FormRule = {
    id: 'r1',
    kind: 'CALCULATE',
    target: 'udise_code',
    expr: {
      op: 'lookup',
      args: [
        { lit: 'ng-schools' },
        { field: 'school_name' },
        { lit: 'udise_code' },
      ],
    },
  };

  describe('compilation', () => {
    it('accepts the canonical shape and emits the spec', () => {
      const result = compile([udiseRule], { knownChoiceLists });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.plan.lookups).toEqual([
        { list: 'ng-schools', field: 'school_name', column: 'udise_code' },
      ]);
    });

    it('records the looked-up question as a dependency', () => {
      // Otherwise the topological sort could run this calculation before the
      // one that produces `school_name`, and it would read a stale blank.
      const result = compile(
        [
          udiseRule,
          {
            id: 'r2',
            kind: 'CALCULATE',
            target: 'school_name',
            expr: { op: 'upper', args: [{ field: 'district' }] },
          },
        ],
        { knownChoiceLists },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const order = result.plan.calculations.map((r) => r.target);
      expect(order.indexOf('school_name')).toBeLessThan(
        order.indexOf('udise_code'),
      );
    });

    // The restriction that keeps the interpreter pure. Without it, one lookup's
    // result could form another's key, which needs iterative resolution.
    it('rejects a computed value argument', () => {
      const result = compile([
        {
          id: 'r1',
          kind: 'CALCULATE',
          target: 'udise_code',
          expr: {
            op: 'lookup',
            args: [
              { lit: 'ng-schools' },
              { op: 'upper', args: [{ field: 'school_name' }] },
              { lit: 'udise_code' },
            ],
          },
        },
      ]);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors[0].message).toMatch(
        /read the answer to a question directly/i,
      );
    });

    it('rejects a computed list name', () => {
      const result = compile([
        {
          id: 'r1',
          kind: 'CALCULATE',
          target: 'udise_code',
          expr: {
            op: 'lookup',
            args: [
              { field: 'district' },
              { field: 'school_name' },
              { lit: 'udise_code' },
            ],
          },
        },
      ]);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors[0].message).toMatch(
        /must be chosen, not calculated/i,
      );
    });

    it('rejects a question that is not on the form', () => {
      const result = compile([
        {
          id: 'r1',
          kind: 'CALCULATE',
          target: 'udise_code',
          expr: {
            op: 'lookup',
            args: [
              { lit: 'ng-schools' },
              { field: 'nope' },
              { lit: 'udise_code' },
            ],
          },
        },
      ]);
      expect(result.ok).toBe(false);
    });

    it('rejects a list the organization cannot use', () => {
      const result = compile([udiseRule], {
        knownChoiceLists: ['in-districts'],
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors[0].message).toMatch(
        /not a list this organization can use/i,
      );
    });

    it('skips the catalogue check when no catalogue is supplied', () => {
      // The builder preview compiles before the lists have loaded.
      expect(compile([udiseRule]).ok).toBe(true);
    });

    it('rejects the wrong number of inputs', () => {
      const result = compile([
        {
          id: 'r1',
          kind: 'CALCULATE',
          target: 'udise_code',
          expr: {
            op: 'lookup',
            args: [{ lit: 'ng-schools' }, { field: 'school_name' }],
          },
        },
      ]);
      expect(result.ok).toBe(false);
    });
  });

  describe('request planning', () => {
    const specs = [
      { list: 'ng-schools', field: 'school_name', column: 'udise_code' },
    ];

    it('pairs the spec with the answer', () => {
      expect(planLookupRequests(specs, { school_name: 'GHS Botsa' })).toEqual([
        {
          list: 'ng-schools',
          value: 'GHS Botsa',
          column: 'udise_code',
          key: lookupKey('ng-schools', 'GHS Botsa', 'udise_code'),
        },
      ]);
    });

    it('asks for nothing when the question is unanswered', () => {
      expect(planLookupRequests(specs, {})).toEqual([]);
      expect(planLookupRequests(specs, { school_name: '' })).toEqual([]);
      expect(planLookupRequests(specs, { school_name: null })).toEqual([]);
    });

    it('asks for nothing for a multi-value answer', () => {
      // No single item to look up.
      expect(planLookupRequests(specs, { school_name: ['a', 'b'] })).toEqual(
        [],
      );
    });

    it('de-duplicates two rules reading the same column', () => {
      const requests = planLookupRequests(
        [
          ...specs,
          ...specs,
          { list: 'ng-schools', field: 'school_name', column: 'block_code' },
        ],
        { school_name: 'GHS Botsa' },
      );
      expect(requests).toHaveLength(2);
    });

    it('handles a plan with no lookups at all', () => {
      expect(planLookupRequests(undefined, { a: 1 })).toEqual([]);
      expect(planLookupRequests([], { a: 1 })).toEqual([]);
    });
  });

  describe('bag resolution', () => {
    const requests = planLookupRequests(
      [{ list: 'ng-schools', field: 'school_name', column: 'udise_code' }],
      { school_name: 'GHS Botsa' },
    );

    it('files the found value under the interpreter key', () => {
      const items = new Map([
        ['ng-schools::GHS Botsa', { udise_code: '13070300802' }],
      ]);
      const bag = resolveLookupBag(requests, items);
      expect(bag[lookupKey('ng-schools', 'GHS Botsa', 'udise_code')]).toBe(
        '13070300802',
      );
    });

    it('files a miss as null rather than leaving a hole', () => {
      const bag = resolveLookupBag(requests, new Map());
      expect(
        bag[lookupKey('ng-schools', 'GHS Botsa', 'udise_code')],
      ).toBeNull();
    });

    it('treats a structured column value as absent', () => {
      const items = new Map([
        ['ng-schools::GHS Botsa', { udise_code: { nested: true } }],
      ]);
      const bag = resolveLookupBag(requests, items);
      expect(
        bag[lookupKey('ng-schools', 'GHS Botsa', 'udise_code')],
      ).toBeNull();
    });
  });

  describe('end to end', () => {
    const questions = [
      { id: 'q_school', key: 'school_name', type: 'DROPDOWN' },
      { id: 'q_udise', key: 'udise_code', type: 'SHORT_TEXT' },
    ];

    const plan = (() => {
      const result = compileRules([udiseRule], {
        knownKeys,
        allowReferences: false,
        knownChoiceLists,
      });
      if (!result.ok) throw new Error('expected the rule to compile');
      return result.plan;
    })();

    it('auto-fills the code from the picked school', () => {
      const answersByKey = { school_name: 'GHS Botsa' };
      const requests = planLookupRequests(plan.lookups, answersByKey);
      const lookups = resolveLookupBag(
        requests,
        new Map([['ng-schools::GHS Botsa', { udise_code: '13070300802' }]]),
      );

      const out = runFormRules({
        questions,
        plan,
        answersById: { q_school: 'GHS Botsa' },
        lookups,
      });

      expect(out.answersById.q_udise).toBe('13070300802');
      expect(out.calculatedQuestionIds.has('q_udise')).toBe(true);
    });

    it('is null — not an error — before a school is picked', () => {
      const out = runFormRules({
        questions,
        plan,
        answersById: {},
        lookups: {},
      });
      expect(out.answersById.q_udise).toBeNull();
      expect(out.errors).toHaveLength(0);
    });

    it('discards a client-supplied code', () => {
      // The respondent cannot forge a UDISE code by posting one.
      const out = runFormRules({
        questions,
        plan,
        answersById: { q_school: 'GHS Botsa', q_udise: 'FORGED' },
        lookups: resolveLookupBag(
          planLookupRequests(plan.lookups, { school_name: 'GHS Botsa' }),
          new Map([['ng-schools::GHS Botsa', { udise_code: '13070300802' }]]),
        ),
      });
      expect(out.answersById.q_udise).toBe('13070300802');
    });
  });
});
