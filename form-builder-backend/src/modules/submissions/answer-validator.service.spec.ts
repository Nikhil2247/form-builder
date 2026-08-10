import { AnswerValidatorService } from './answer-validator.service';

/**
 * Regression cover for the schema-name mismatches that made three of these
 * checks no-ops, and for the calculated-field requiredness exemption.
 */
describe('AnswerValidatorService', () => {
  const validator = new AnswerValidatorService();

  describe('MATRIX', () => {
    // The validator read `q.rows` / `q.columns`, which no stored question has —
    // the builder writes `matrixRows` / `matrixColumns`. Both key sets were
    // therefore empty, and both guards were `if (size > 0 && ...)`, so every
    // row key and every column value was accepted.
    const question = {
      id: 'q1',
      type: 'MATRIX',
      label: 'Checklist',
      matrixRows: ['Item A', 'Item B'],
      matrixColumns: ['Yes', 'No', 'NA'],
    };

    it('accepts a valid row/column pair', () => {
      const result = validator.validate([question], { q1: { 'Item A': 'Yes' } });
      expect(result.valid).toBe(true);
      expect(result.sanitized.q1).toEqual({ 'Item A': 'Yes' });
    });

    it('rejects a row that is not on the question', () => {
      const result = validator.validate([question], { q1: { 'Made up row': 'Yes' } });
      expect(result.valid).toBe(false);
      expect(result.issues[0].code).toBe('OPTION');
    });

    it('rejects a column value that is not on the question', () => {
      const result = validator.validate([question], { q1: { 'Item A': 'Maybe' } });
      expect(result.valid).toBe(false);
      expect(result.issues[0].code).toBe('OPTION');
    });
  });

  describe('SLIDER', () => {
    // Bounds were read from `q.min`/`q.max`; normalizeFormStructure writes
    // `sliderMin`/`sliderMax`, so any number at all was accepted.
    const question = {
      id: 'q1',
      type: 'SLIDER',
      label: 'Score',
      sliderMin: 10,
      sliderMax: 20,
    };

    it('accepts a value inside the slider range', () => {
      expect(validator.validate([question], { q1: 15 }).valid).toBe(true);
    });

    it('rejects a value below the slider minimum', () => {
      const result = validator.validate([question], { q1: 5 });
      expect(result.valid).toBe(false);
      expect(result.issues[0].code).toBe('MIN');
    });

    it('rejects a value above the slider maximum', () => {
      const result = validator.validate([question], { q1: 25 });
      expect(result.valid).toBe(false);
      expect(result.issues[0].code).toBe('MAX');
    });
  });

  describe('requiredness', () => {
    const required = {
      id: 'q1',
      type: 'SHORT_TEXT',
      label: 'Name',
      validation: { required: true },
    };

    it('reports a missing required answer', () => {
      const result = validator.validate([required], {});
      expect(result.issues[0].code).toBe('REQUIRED');
    });

    it('does not require a question hidden by conditional logic', () => {
      const result = validator.validate([required], {}, { visibleQuestionIds: new Set() });
      expect(result.valid).toBe(true);
    });

    // A CALCULATE rule owns its target's value: the respondent's input is
    // stripped and recomputed. Requiring such a field whose formula yields
    // nothing told the respondent to fill in a box they are forbidden from
    // filling, and no one could ever submit the form.
    it('does not require a calculated question whose value came out empty', () => {
      const result = validator.validate(
        [required],
        {},
        { calculatedQuestionIds: new Set(['q1']) },
      );
      expect(result.valid).toBe(true);
    });

    it('still applies a REQUIRE rule to an otherwise-optional question', () => {
      const optional = { id: 'q1', type: 'SHORT_TEXT', label: 'Why?' };
      const result = validator.validate([optional], {}, { extraRequiredIds: new Set(['q1']) });
      expect(result.issues[0].code).toBe('REQUIRED');
    });
  });

  describe('STAR_RATING', () => {
    it('narrows the 1–5 default when validation.max is set', () => {
      const question = {
        id: 'q1',
        type: 'STAR_RATING',
        label: 'Rating',
        validation: { max: 3 },
      };
      expect(validator.validate([question], { q1: 3 }).valid).toBe(true);
      expect(validator.validate([question], { q1: 4 }).valid).toBe(false);
    });
  });
});

/**
 * List-backed options.
 *
 * A question bound to a ChoiceList has an EMPTY `options` array — its options
 * live in the database. `validateOne` reads an empty option set as "the author
 * left this unconfigured, accept the value", which is right for a hand-typed
 * dropdown and catastrophic for a list-backed one: without the checks below a
 * district field would accept any string at all.
 */
describe('AnswerValidatorService — choice lists', () => {
  const validator = new AnswerValidatorService();

  const district = {
    id: 'q_district',
    key: 'district',
    type: 'DROPDOWN',
    label: 'District',
    options: [],
    optionsSource: { kind: 'CHOICE_LIST', listSlug: 'in-districts' },
  };

  const block = {
    id: 'q_block',
    key: 'block',
    type: 'DROPDOWN',
    label: 'Block',
    options: [],
    optionsSource: {
      kind: 'CHOICE_LIST',
      listSlug: 'ng-blocks',
      parentQuestionKey: 'district',
    },
  };

  const catalogue = new Map([
    ['in-districts::NL-kohima', { value: 'NL-kohima', parentValue: 'NL' }],
    ['in-districts::NL-phek', { value: 'NL-phek', parentValue: 'NL' }],
    ['ng-blocks::NL-kohima-chiephobozou', {
      value: 'NL-kohima-chiephobozou',
      parentValue: 'NL-kohima',
    }],
    ['ng-blocks::NL-phek-chozuba', { value: 'NL-phek-chozuba', parentValue: 'NL-phek' }],
  ]);

  it('accepts a value that is on the list', () => {
    const result = validator.validate([district], { q_district: 'NL-kohima' }, {
      choiceItems: catalogue,
    });
    expect(result.valid).toBe(true);
    expect(result.sanitized.q_district).toBe('NL-kohima');
  });

  it('rejects a value that is not on the list', () => {
    const result = validator.validate([district], { q_district: 'MADE-UP' }, {
      choiceItems: catalogue,
    });
    expect(result.valid).toBe(false);
    expect(result.issues[0].code).toBe('OPTION');
  });

  // The check that matters. The UI enforces the hierarchy, but the UI is not a
  // security boundary — a crafted payload could otherwise pair a Kohima block
  // with a Phek district and look entirely plausible in every export forever.
  it('rejects a child that does not belong to the submitted parent', () => {
    const result = validator.validate(
      [district, block],
      { q_district: 'NL-phek', q_block: 'NL-kohima-chiephobozou' },
      { choiceItems: catalogue },
    );
    expect(result.valid).toBe(false);
    expect(result.issues[0].code).toBe('CASCADE');
    expect(result.issues[0].questionId).toBe('q_block');
  });

  it('accepts a consistent parent/child pair', () => {
    const result = validator.validate(
      [district, block],
      { q_district: 'NL-phek', q_block: 'NL-phek-chozuba' },
      { choiceItems: catalogue },
    );
    expect(result.valid).toBe(true);
  });

  it('fails closed when the catalogue could not be resolved', () => {
    // Accepting the value would silently store something that is not on the
    // list; there is no safe way to "skip" this check.
    const result = validator.validate([district], { q_district: 'NL-kohima' }, {});
    expect(result.valid).toBe(false);
    expect(result.issues[0].code).toBe('OPTION_SOURCE');
  });

  it('checks every selection of a list-backed multi-choice', () => {
    const multi = { ...district, id: 'q_multi', type: 'MULTI_CHOICE' };
    const ok = validator.validate([multi], { q_multi: ['NL-kohima', 'NL-phek'] }, {
      choiceItems: catalogue,
    });
    expect(ok.valid).toBe(true);

    const bad = validator.validate([multi], { q_multi: ['NL-kohima', 'MADE-UP'] }, {
      choiceItems: catalogue,
    });
    expect(bad.valid).toBe(false);
  });

  it('leaves hand-typed options alone', () => {
    const plain = {
      id: 'q1',
      type: 'DROPDOWN',
      label: 'Colour',
      options: [{ label: 'Red', value: 'red' }],
    };
    expect(validator.validate([plain], { q1: 'Red' }).valid).toBe(true);
    expect(validator.validate([plain], { q1: 'Purple' }).valid).toBe(false);
  });
});
