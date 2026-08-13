import {
  CADENCE_DEFAULTS,
  fileableWindows,
  readPeriodConfig,
  shiftWindow,
  windowAt,
  type PeriodConfig,
} from './period-cadence';

/**
 * Cadence arithmetic decides which reporting window real entries are filed
 * into. Getting it wrong does not crash — it quietly files March's visits under
 * February, and the per-period counts that govern "one check a month" then
 * disagree with what a human sees on the page.
 *
 * The cases below are the ones month arithmetic actually breaks on: 31-day
 * months, February, year boundaries, and dates before the anchor.
 */

const config = (over: Partial<PeriodConfig> = {}) =>
  readPeriodConfig({ cadence: 'MONTHLY', anchor: '2026-01-01', ...over })!;

const iso = (date: Date) => date.toISOString();

describe('readPeriodConfig', () => {
  it('rejects a missing or unknown cadence rather than guessing one', () => {
    expect(readPeriodConfig({})).toBeNull();
    expect(readPeriodConfig({ cadence: 'FORTNIGHTLY' })).toBeNull();
    expect(readPeriodConfig(null)).toBeNull();
  });

  it('defaults grace and backfill', () => {
    const read = readPeriodConfig({ cadence: 'MONTHLY' })!;
    expect(read.graceDays).toBe(CADENCE_DEFAULTS.GRACE_DAYS);
    expect(read.backfillPeriods).toBe(CADENCE_DEFAULTS.BACKFILL_PERIODS);
  });

  it('clamps values that would otherwise open the app indefinitely', () => {
    const read = readPeriodConfig({
      cadence: 'MONTHLY',
      graceDays: 9999,
      backfillPeriods: 9999,
    })!;
    expect(read.graceDays).toBe(90);
    expect(read.backfillPeriods).toBe(CADENCE_DEFAULTS.MAX_BACKFILL);
  });

  it('falls back to the default anchor when the given one is unreadable', () => {
    const read = readPeriodConfig({ cadence: 'MONTHLY', anchor: 'nonsense' })!;
    expect(iso(new Date(read.anchor))).toBe('2000-01-01T00:00:00.000Z');
  });
});

describe('windowAt — MONTHLY', () => {
  it('places a date in its own month', () => {
    const window = windowAt(config(), new Date('2026-03-14T09:00:00Z'));
    expect(window.label).toBe('March 2026');
    expect(iso(window.startsAt)).toBe('2026-03-01T00:00:00.000Z');
    expect(iso(window.endsAt)).toBe('2026-03-31T23:59:59.999Z');
    expect(window.sequence).toBe(2);
  });

  it('closes February on the 28th of a common year', () => {
    const window = windowAt(config(), new Date('2026-02-10T00:00:00Z'));
    expect(iso(window.endsAt)).toBe('2026-02-28T23:59:59.999Z');
  });

  it('closes February on the 29th of a leap year', () => {
    const window = windowAt(config(), new Date('2028-02-10T00:00:00Z'));
    expect(iso(window.endsAt)).toBe('2028-02-29T23:59:59.999Z');
  });

  // The boundaries have to meet exactly. A gap would leave an instant that
  // belongs to no window; an overlap would let one entry match two.
  it('ends each window one millisecond before the next begins', () => {
    const february = windowAt(config(), new Date('2026-02-15T00:00:00Z'));
    const march = windowAt(config(), new Date('2026-03-15T00:00:00Z'));
    expect(march.startsAt.getTime() - february.endsAt.getTime()).toBe(1);
  });

  it('is stable at the very first and last instant of a window', () => {
    expect(windowAt(config(), new Date('2026-03-01T00:00:00.000Z')).label).toBe(
      'March 2026',
    );
    expect(windowAt(config(), new Date('2026-03-31T23:59:59.999Z')).label).toBe(
      'March 2026',
    );
  });

  // Sequence is derived arithmetically rather than by stepping from the anchor,
  // so a decade-old anchor costs the same as last week's.
  it('handles a date long after the anchor', () => {
    const window = windowAt(
      readPeriodConfig({ cadence: 'MONTHLY', anchor: '2000-01-01' })!,
      new Date('2030-06-15T00:00:00Z'),
    );
    expect(window.label).toBe('June 2030');
    // January 2000 is sequence 0, so June 2030 is 30 years × 12 + 5.
    expect(window.sequence).toBe(365);
  });

  // A backdated entry from before the app existed must not collapse onto the
  // anchor's own window, or two different months would share one bucket.
  it('gives dates before the anchor a negative sequence', () => {
    const window = windowAt(config(), new Date('2025-11-20T00:00:00Z'));
    expect(window.sequence).toBe(-2);
    expect(window.label).toBe('November 2025');
  });
});

describe('windowAt — other cadences', () => {
  it('groups quarters and names them', () => {
    const q = config({ cadence: 'QUARTERLY' });
    expect(windowAt(q, new Date('2026-05-02T00:00:00Z')).label).toBe('Q2 2026');
    expect(iso(windowAt(q, new Date('2026-05-02T00:00:00Z')).startsAt)).toBe(
      '2026-04-01T00:00:00.000Z',
    );
    expect(iso(windowAt(q, new Date('2026-05-02T00:00:00Z')).endsAt)).toBe(
      '2026-06-30T23:59:59.999Z',
    );
  });

  it('names a calendar-aligned year by its year alone', () => {
    const y = config({ cadence: 'YEARLY' });
    expect(windowAt(y, new Date('2026-07-01T00:00:00Z')).label).toBe('2026');
  });

  // An April-anchored year runs April–March and is NOT one calendar year — the
  // Indian financial year, which several of these programmes report on.
  it('names a straddling year with both years', () => {
    const y = readPeriodConfig({ cadence: 'YEARLY', anchor: '2026-04-01' })!;
    const window = windowAt(y, new Date('2026-09-01T00:00:00Z'));
    expect(window.label).toBe('2026–2027');
    expect(iso(window.startsAt)).toBe('2026-04-01T00:00:00.000Z');
    expect(iso(window.endsAt)).toBe('2027-03-31T23:59:59.999Z');
  });

  it('runs weeks from the anchor day, not from Sunday', () => {
    // 2026-01-01 is a Thursday, so weeks run Thursday to Wednesday.
    const w = config({ cadence: 'WEEKLY' });
    const window = windowAt(w, new Date('2026-01-05T12:00:00Z'));
    expect(iso(window.startsAt)).toBe('2026-01-01T00:00:00.000Z');
    expect(window.sequence).toBe(0);

    const next = windowAt(w, new Date('2026-01-08T12:00:00Z'));
    expect(iso(next.startsAt)).toBe('2026-01-08T00:00:00.000Z');
    expect(next.sequence).toBe(1);
  });
});

describe('shiftWindow', () => {
  // Stepping by a fixed number of milliseconds drifts across February and every
  // 31-day month; this re-derives from a date inside the target window.
  it('steps months without drifting across short ones', () => {
    const march = windowAt(config(), new Date('2026-03-15T00:00:00Z'));
    expect(shiftWindow(config(), march, -1).label).toBe('February 2026');
    expect(shiftWindow(config(), march, -2).label).toBe('January 2026');
    expect(shiftWindow(config(), march, 1).label).toBe('April 2026');
  });

  it('steps across a year boundary', () => {
    const january = windowAt(config(), new Date('2026-01-15T00:00:00Z'));
    expect(shiftWindow(config(), january, -1).label).toBe('December 2025');
  });

  it('returns the same window for a zero shift', () => {
    const march = windowAt(config(), new Date('2026-03-15T00:00:00Z'));
    expect(shiftWindow(config(), march, 0)).toBe(march);
  });

  it('steps weeks', () => {
    const w = config({ cadence: 'WEEKLY' });
    const window = windowAt(w, new Date('2026-01-08T00:00:00Z'));
    expect(iso(shiftWindow(w, window, -1).startsAt)).toBe(
      '2026-01-01T00:00:00.000Z',
    );
  });
});

describe('fileableWindows', () => {
  it('offers only the current window when there is no grace', () => {
    const windows = fileableWindows(
      config({ graceDays: 0, backfillPeriods: 2 }),
      new Date('2026-03-05T00:00:00Z'),
    );
    expect(windows.map((w) => w.label)).toEqual(['March 2026']);
  });

  // The point of the whole feature: a worker who visited on 28 February and
  // reaches a keyboard on 3 March can still file it under February.
  it('offers the previous window inside its grace', () => {
    const windows = fileableWindows(
      config({ graceDays: 10, backfillPeriods: 1 }),
      new Date('2026-03-03T00:00:00Z'),
    );
    expect(windows.map((w) => w.label)).toEqual(['March 2026', 'February 2026']);
  });

  it('stops offering it once the grace has run out', () => {
    const windows = fileableWindows(
      config({ graceDays: 10, backfillPeriods: 1 }),
      new Date('2026-03-20T00:00:00Z'),
    );
    expect(windows.map((w) => w.label)).toEqual(['March 2026']);
  });

  // Grace runs from each window's OWN end, not from "now minus N days" applied
  // uniformly. Asked on 20 March with 45 days: February ended 28 Feb, so its
  // grace runs to 14 April and it is open; January ended 31 Jan, so its grace
  // ran out on 17 March and it is closed. The two windows are treated
  // differently by the same setting, which is the property under test.
  it('measures grace from the end of the window it applies to', () => {
    const at = new Date('2026-03-20T00:00:00Z');

    expect(
      fileableWindows(config({ graceDays: 45, backfillPeriods: 2 }), at).map(
        (w) => w.label,
      ),
    ).toEqual(['March 2026', 'February 2026']);

    // Sixty days reaches back past 31 January and lets the third window in.
    expect(
      fileableWindows(config({ graceDays: 60, backfillPeriods: 2 }), at).map(
        (w) => w.label,
      ),
    ).toEqual(['March 2026', 'February 2026', 'January 2026']);
  });

  it('never offers more than backfillPeriods, however long the grace', () => {
    const windows = fileableWindows(
      config({ graceDays: 90, backfillPeriods: 1 }),
      new Date('2026-03-20T00:00:00Z'),
    );
    expect(windows).toHaveLength(2);
  });

  it('lists the current window first', () => {
    const windows = fileableWindows(
      config({ graceDays: 30, backfillPeriods: 2 }),
      new Date('2026-03-05T00:00:00Z'),
    );
    expect(windows[0].label).toBe('March 2026');
  });
});
