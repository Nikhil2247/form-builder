import { hiddenByLegacyLogic, type LegacyLogicRule } from './legacy-logic';

/**
 * The legacy show/hide system, which most existing forms still use.
 *
 * These tests exist because this evaluator used to live only in the browser.
 * The submit path derived visibility from the compiled rule plan alone, so a
 * question hidden here was still considered visible by the answer validator —
 * and if it was required, the submission was rejected for a field the
 * respondent had never been shown.
 */
describe('hiddenByLegacyLogic', () => {
  const questions = [{ id: 'q_trigger' }, { id: 'q_target' }, { id: 'q_other' }];

  const rule = (over: Partial<LegacyLogicRule>): LegacyLogicRule => ({
    id: 'r1',
    triggerQuestionId: 'q_trigger',
    operator: 'EQUALS',
    value: 'yes',
    action: 'SHOW',
    targetQuestionId: 'q_target',
    ...over,
  });

  it('leaves a question with no rules visible', () => {
    expect(hiddenByLegacyLogic(questions, [], {}).size).toBe(0);
  });

  it('hides a SHOW target until its condition is met', () => {
    const rules = [rule({})];
    expect(hiddenByLegacyLogic(questions, rules, {}).has('q_target')).toBe(true);
    expect(hiddenByLegacyLogic(questions, rules, { q_trigger: 'yes' }).has('q_target')).toBe(false);
  });

  it('hides a HIDE target only once its condition is met', () => {
    const rules = [rule({ action: 'HIDE' })];
    expect(hiddenByLegacyLogic(questions, rules, {}).has('q_target')).toBe(false);
    expect(hiddenByLegacyLogic(questions, rules, { q_trigger: 'yes' }).has('q_target')).toBe(true);
  });

  it('never touches a question no rule targets', () => {
    const hidden = hiddenByLegacyLogic(questions, [rule({})], {});
    expect(hidden.has('q_other')).toBe(false);
    expect(hidden.has('q_trigger')).toBe(false);
  });

  // A rule's `value` is always a string; an NPS or star-rating answer is a
  // number. A strict === therefore never matched, so every numeric show/hide
  // rule silently did nothing.
  it('matches a numeric answer against the rule\'s string value', () => {
    const rules = [rule({ value: '7' })];
    expect(hiddenByLegacyLogic(questions, rules, { q_trigger: 7 }).has('q_target')).toBe(false);
    expect(hiddenByLegacyLogic(questions, rules, { q_trigger: 8 }).has('q_target')).toBe(true);
  });

  it('matches any member of a multi-choice answer', () => {
    const rules = [rule({ value: 'b' })];
    expect(
      hiddenByLegacyLogic(questions, rules, { q_trigger: ['a', 'b'] }).has('q_target'),
    ).toBe(false);
    expect(hiddenByLegacyLogic(questions, rules, { q_trigger: ['a'] }).has('q_target')).toBe(true);
  });

  it('treats 0 as an answer for IS_FILLED', () => {
    const rules = [rule({ operator: 'IS_FILLED', value: '' })];
    expect(hiddenByLegacyLogic(questions, rules, { q_trigger: 0 }).has('q_target')).toBe(false);
    expect(hiddenByLegacyLogic(questions, rules, { q_trigger: '' }).has('q_target')).toBe(true);
  });

  it('compares numerically for GREATER_THAN / LESS_THAN', () => {
    const gt = [rule({ operator: 'GREATER_THAN', value: '5' })];
    expect(hiddenByLegacyLogic(questions, gt, { q_trigger: '6' }).has('q_target')).toBe(false);
    expect(hiddenByLegacyLogic(questions, gt, { q_trigger: '5' }).has('q_target')).toBe(true);

    const lt = [rule({ operator: 'LESS_THAN', value: '5' })];
    expect(hiddenByLegacyLogic(questions, lt, { q_trigger: 4 }).has('q_target')).toBe(false);
  });

  it('applies a later satisfied rule over an earlier one', () => {
    const rules = [
      rule({ id: 'r1', action: 'SHOW', value: 'yes' }),
      rule({ id: 'r2', action: 'HIDE', value: 'yes' }),
    ];
    expect(hiddenByLegacyLogic(questions, rules, { q_trigger: 'yes' }).has('q_target')).toBe(true);
  });

  it('ignores JUMP_TO_PAGE rules, which target no question', () => {
    const rules = [rule({ action: 'JUMP_TO_PAGE', targetQuestionId: undefined })];
    expect(hiddenByLegacyLogic(questions, rules, {}).size).toBe(0);
  });

  it('does not reveal anything for an unrecognised operator', () => {
    const rules = [rule({ operator: 'NONSENSE' as any })];
    expect(hiddenByLegacyLogic(questions, rules, { q_trigger: 'yes' }).has('q_target')).toBe(true);
  });
});
