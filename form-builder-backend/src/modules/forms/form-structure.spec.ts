import { BadRequestException } from '@nestjs/common';
import {
  normalizeFormStructure,
  normalizeNotifyEmails,
  normalizeTheme,
  STRUCTURE_LIMITS,
} from './form-structure';

/**
 * These cover the repairs that protect stored responses, not the shape of the
 * output for its own sake. Each `it` name is the failure it prevents.
 */

const q = (over: Record<string, any> = {}) => ({
  id: 'q1',
  type: 'SHORT_TEXT',
  label: 'Name',
  validation: {},
  pageNumber: 1,
  ...over,
});

describe('normalizeFormStructure', () => {
  describe('questions', () => {
    it('gives a duplicate question id a new one, so two questions cannot share an answer key', () => {
      const { questions } = normalizeFormStructure({
        questions: [q({ id: 'dup', label: 'First' }), q({ id: 'dup', label: 'Second' })],
      });

      expect(questions).toHaveLength(2);
      expect(questions[0].id).toBe('dup');
      expect(questions[1].id).not.toBe('dup');
      expect(questions[1].label).toBe('Second');
    });

    it('drops nulls and non-objects rather than persisting them into the canvas', () => {
      const { questions } = normalizeFormStructure({
        questions: [null, q(), 'nonsense', [], undefined],
      });
      expect(questions).toHaveLength(1);
    });

    it('rejects an unknown question type instead of storing a field nothing can render', () => {
      expect(() => normalizeFormStructure({ questions: [q({ type: 'TELEPATHY' })] })).toThrow(
        BadRequestException,
      );
    });

    it('moves a question on a non-existent page onto a real one, so it is not invisible', () => {
      const { questions } = normalizeFormStructure({
        pages: [{ pageNumber: 1, title: 'One' }],
        questions: [q({ pageNumber: 9 })],
      });
      expect(questions[0].pageNumber).toBe(1);
    });

    it('keeps `required` and `validation.required` in agreement', () => {
      const { questions } = normalizeFormStructure({
        questions: [q({ required: false, validation: { required: true } })],
      });
      expect(questions[0].required).toBe(true);
      expect(questions[0].validation.required).toBe(true);
    });

    it('rejects a choice question with no options, which no one could answer', () => {
      expect(() =>
        normalizeFormStructure({ questions: [q({ type: 'SINGLE_CHOICE', options: [] })] }),
      ).toThrow(BadRequestException);
    });

    it('regenerates duplicate option ids so answer-key edits cannot cross-write', () => {
      const { questions } = normalizeFormStructure({
        questions: [
          q({
            type: 'SINGLE_CHOICE',
            options: [
              { id: 'o', label: 'A', value: 'a' },
              { id: 'o', label: 'B', value: 'b' },
            ],
          }),
        ],
      });
      const ids = questions[0].options.map((o: any) => o.id);
      expect(new Set(ids).size).toBe(2);
    });

    it('repairs an inverted slider range that would render an unusable control', () => {
      const { questions } = normalizeFormStructure({
        questions: [q({ type: 'SLIDER', sliderMin: 50, sliderMax: 10, sliderStep: 0 })],
      });
      expect(questions[0].sliderMax).toBeGreaterThan(questions[0].sliderMin);
      expect(questions[0].sliderStep).toBeGreaterThan(0);
    });

    it('rejects a form over the question ceiling', () => {
      const questions = Array.from({ length: STRUCTURE_LIMITS.MAX_QUESTIONS + 1 }, (_, i) =>
        q({ id: `q${i}` }),
      );
      expect(() => normalizeFormStructure({ questions })).toThrow(BadRequestException);
    });
  });

  describe('logic', () => {
    it('drops a rule whose target question was deleted, which would hide a live field forever', () => {
      const { logic } = normalizeFormStructure({
        questions: [q({ id: 'a' }), q({ id: 'b' })],
        logic: [
          { id: 'r1', triggerQuestionId: 'a', operator: 'EQUALS', value: 'x', action: 'HIDE', targetQuestionId: 'b' },
          { id: 'r2', triggerQuestionId: 'a', operator: 'EQUALS', value: 'x', action: 'HIDE', targetQuestionId: 'gone' },
        ],
      });
      expect(logic.map((r: any) => r.id)).toEqual(['r1']);
    });

    it('drops a rule whose trigger question was deleted', () => {
      const { logic } = normalizeFormStructure({
        questions: [q({ id: 'a' })],
        logic: [
          { id: 'r', triggerQuestionId: 'gone', operator: 'EQUALS', value: '', action: 'SHOW', targetQuestionId: 'a' },
        ],
      });
      expect(logic).toHaveLength(0);
    });

    it('drops a self-referential rule, which can never settle', () => {
      const { logic } = normalizeFormStructure({
        questions: [q({ id: 'a' })],
        logic: [
          { id: 'r', triggerQuestionId: 'a', operator: 'EQUALS', value: '1', action: 'HIDE', targetQuestionId: 'a' },
        ],
      });
      expect(logic).toHaveLength(0);
    });

    it('drops a JUMP_TO_PAGE pointing at a page that does not exist', () => {
      const { logic } = normalizeFormStructure({
        pages: [{ pageNumber: 1, title: 'One' }],
        questions: [q({ id: 'a' })],
        logic: [
          { id: 'r', triggerQuestionId: 'a', operator: 'EQUALS', value: '1', action: 'JUMP_TO_PAGE', targetPageNumber: 7 },
        ],
      });
      expect(logic).toHaveLength(0);
    });

    it('validates a partial update against the questions already persisted', () => {
      // The client sent only `logic`; the trigger lives in the stored questions.
      const { logic } = normalizeFormStructure(
        {
          logic: [
            { id: 'r', triggerQuestionId: 'stored', operator: 'EQUALS', value: '1', action: 'HIDE', targetQuestionId: 'stored2' },
          ],
        },
        { questions: [q({ id: 'stored' }), q({ id: 'stored2' })] },
      );
      expect(logic).toHaveLength(1);
    });
  });

  describe('pages', () => {
    it('always yields at least one page', () => {
      expect(normalizeFormStructure({ pages: [] }).pages).toHaveLength(1);
      expect(normalizeFormStructure({}).pages).toHaveLength(1);
    });

    it('de-duplicates page numbers', () => {
      const { pages } = normalizeFormStructure({
        pages: [
          { pageNumber: 1, title: 'A' },
          { pageNumber: 1, title: 'B' },
        ],
      });
      expect(pages).toHaveLength(1);
    });

    it('rejects a non-array', () => {
      expect(() => normalizeFormStructure({ pages: 'nope' })).toThrow(BadRequestException);
    });
  });

  it('rejects a definition larger than the storage ceiling', () => {
    const huge = Array.from({ length: 200 }, (_, i) =>
      q({ id: `q${i}`, description: 'x'.repeat(5_000) }),
    );
    expect(() => normalizeFormStructure({ questions: huge })).toThrow(BadRequestException);
  });
});

describe('normalizeTheme', () => {
  it('strips a javascript: cover image, which would be stored XSS on the public form', () => {
    const theme = normalizeTheme({
      primaryColor: '#fff',
      coverImageUrl: 'javascript:alert(document.cookie)',
    });
    expect(theme.coverImageUrl).toBeUndefined();
    expect(theme.primaryColor).toBe('#fff');
  });

  it('strips a data: URL logo', () => {
    expect(normalizeTheme({ logoUrl: 'data:text/html,<script>x</script>' }).logoUrl).toBeUndefined();
  });

  it('keeps ordinary http(s) images', () => {
    const url = 'https://images.example.com/a.png';
    expect(normalizeTheme({ coverImageUrl: url }).coverImageUrl).toBe(url);
  });
});

describe('normalizeNotifyEmails', () => {
  it('lowercases, trims and de-duplicates', () => {
    expect(normalizeNotifyEmails([' A@B.com ', 'a@b.com'])).toEqual(['a@b.com']);
  });

  it('drops anything that is not an address', () => {
    expect(normalizeNotifyEmails(['nope', 42, null, 'ok@ok.com'])).toEqual(['ok@ok.com']);
  });

  it('caps the list', () => {
    const many = Array.from({ length: 50 }, (_, i) => `p${i}@x.com`);
    expect(normalizeNotifyEmails(many)).toHaveLength(STRUCTURE_LIMITS.MAX_NOTIFY_EMAILS);
  });
});
