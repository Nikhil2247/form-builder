import { exportableSubmissions } from './forms.service';

/**
 * The export predicate.
 *
 * This is the single most safety-relevant `where` clause in the codebase: it
 * decides what leaves the product entirely, into a spreadsheet on somebody's
 * laptop, where no later deletion can reach it. Two properties must hold no
 * matter what the caller asks for, and both are asserted here rather than
 * trusted to review.
 */
describe('exportableSubmissions', () => {
  describe('the soft-delete exclusion is not negotiable', () => {
    it('excludes deleted rows with no filters at all', () => {
      expect(exportableSubmissions('form-1')).toEqual({
        formId: 'form-1',
        deletedAt: null,
        status: { not: 'DELETED' },
      });
    });

    it('still excludes deleted rows when a status filter is supplied', () => {
      const where = exportableSubmissions('form-1', {
        statuses: ['SUBMITTED', 'REJECTED'],
      });

      expect(where.deletedAt).toBeNull();
      expect(where.status).toEqual({ in: ['SUBMITTED', 'REJECTED'] });
    });

    it('refuses to be widened back to DELETED by a caller-supplied status list', () => {
      // The attack/mistake this guards: pass `statuses: ['DELETED']` and get
      // back exactly the responses a customer was told were removed.
      const where = exportableSubmissions('form-1', {
        statuses: ['SUBMITTED', 'DELETED'],
      });

      expect(where.deletedAt).toBeNull();
      expect(where.status).toEqual({ in: ['SUBMITTED'] });
    });

    it('yields an impossible predicate when DELETED is the only status asked for', () => {
      // An empty file is the honest answer. The dangerous alternative is
      // falling back to "no status filter", which would export everything.
      const where = exportableSubmissions('form-1', { statuses: ['DELETED'] });

      expect(where.status).toEqual({ in: [] });
      expect(where.deletedAt).toBeNull();
    });
  });

  describe('date range', () => {
    it('applies an inclusive lower and exclusive upper bound', () => {
      const where = exportableSubmissions('form-1', {
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-02-01T00:00:00.000Z',
      });

      expect(where.submittedAt).toEqual({
        gte: new Date('2026-01-01T00:00:00.000Z'),
        lt: new Date('2026-02-01T00:00:00.000Z'),
      });
    });

    it('applies a one-sided range', () => {
      expect(
        exportableSubmissions('f', { from: '2026-01-01T00:00:00.000Z' })
          .submittedAt,
      ).toEqual({
        gte: new Date('2026-01-01T00:00:00.000Z'),
      });
      expect(
        exportableSubmissions('f', { to: '2026-01-01T00:00:00.000Z' })
          .submittedAt,
      ).toEqual({
        lt: new Date('2026-01-01T00:00:00.000Z'),
      });
    });

    it('omits the clause entirely when neither bound is given', () => {
      expect(
        exportableSubmissions('f', { search: 'x' }).submittedAt,
      ).toBeUndefined();
    });
  });

  describe('search', () => {
    it('matches against the JSONB answer document', () => {
      expect(
        exportableSubmissions('f', { search: 'nagaland' }).answers,
      ).toEqual({
        string_contains: 'nagaland',
      });
    });

    it('omits the clause for an empty string', () => {
      // `search: ''` is what an untouched search box sends. Treating it as a
      // filter would add a no-op predicate that defeats index selection.
      expect(
        exportableSubmissions('f', { search: '' }).answers,
      ).toBeUndefined();
    });
  });

  it('composes every filter at once', () => {
    const where = exportableSubmissions('form-9', {
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-02-01T00:00:00.000Z',
      statuses: ['SUBMITTED'],
      search: 'kohima',
    });

    expect(where).toEqual({
      formId: 'form-9',
      deletedAt: null,
      status: { in: ['SUBMITTED'] },
      submittedAt: {
        gte: new Date('2026-01-01T00:00:00.000Z'),
        lt: new Date('2026-02-01T00:00:00.000Z'),
      },
      answers: { string_contains: 'kohima' },
    });
  });
});
