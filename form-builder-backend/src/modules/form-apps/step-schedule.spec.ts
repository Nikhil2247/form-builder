import {
  applyOffset,
  dueStateFor,
  readSchedule,
  scheduleAnchorKey,
} from './step-schedule';

/**
 * Schedules produce the one output a monitoring programme exists for: "this
 * record has no February check". A wrong due date does not crash — it puts a
 * student on a chase list who was visited on time, or leaves one off who was
 * not, and the people acting on that list have no way to tell.
 */

const anchor = new Date('2026-01-31T00:00:00Z');

describe('readSchedule', () => {
  it('is null for the unscheduled case, which is most steps', () => {
    expect(readSchedule(null)).toBeNull();
    expect(readSchedule({})).toBeNull();
    expect(readSchedule({ offsets: [] })).toBeNull();
  });

  it('drops offsets that move nothing, and the schedule with them', () => {
    // { days: 0 } is a due date identical to the anchor, which is not a
    // schedule — it is a step that has no schedule, written at length.
    expect(readSchedule({ offsets: [{ days: 0 }] })).toBeNull();
  });

  it('defaults the anchor to the record itself', () => {
    expect(readSchedule({ offsets: [{ months: 1 }] })!.anchor).toBe(
      'REGISTRATION',
    );
  });

  it('keeps a named step anchor', () => {
    expect(
      readSchedule({ anchor: 'exit', offsets: [{ months: 1 }] })!.anchor,
    ).toBe('exit');
  });

  it('never lets a negative grace pull a due date forward', () => {
    expect(
      readSchedule({ offsets: [{ months: 1 }], graceDays: -30 })!.graceDays,
    ).toBe(0);
  });

  it('caps how many occurrences one step may schedule', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ months: i + 1 }));
    expect(readSchedule({ offsets: many })!.offsets).toHaveLength(24);
  });
});

describe('scheduleAnchorKey', () => {
  it('is null for REGISTRATION, which is not a step', () => {
    expect(scheduleAnchorKey({ offsets: [{ months: 1 }] })).toBeNull();
  });

  it('names the step an offset counts from', () => {
    expect(
      scheduleAnchorKey({ anchor: 'exit', offsets: [{ months: 3 }] }),
    ).toBe('exit');
  });
});

describe('applyOffset', () => {
  it('adds days and weeks', () => {
    expect(applyOffset(anchor, { days: 5 }).toISOString()).toBe(
      '2026-02-05T00:00:00.000Z',
    );
    expect(applyOffset(anchor, { weeks: 2 }).toISOString()).toBe(
      '2026-02-14T00:00:00.000Z',
    );
  });

  // The classic month-arithmetic bug: 31 January plus one month rolls through
  // to 3 March, so a follow-up due "a month after registration" lands in the
  // wrong month and reads as overdue three days early.
  it('clamps a month step that overshoots a short month', () => {
    expect(applyOffset(anchor, { months: 1 }).toISOString()).toBe(
      '2026-02-28T00:00:00.000Z',
    );
  });

  it('clamps to 29 February in a leap year', () => {
    expect(
      applyOffset(new Date('2028-01-31T00:00:00Z'), {
        months: 1,
      }).toISOString(),
    ).toBe('2028-02-29T00:00:00.000Z');
  });

  it('leaves a month step alone when the target month is long enough', () => {
    expect(
      applyOffset(new Date('2026-01-15T00:00:00Z'), {
        months: 3,
      }).toISOString(),
    ).toBe('2026-04-15T00:00:00.000Z');
  });

  it('crosses a year boundary', () => {
    expect(
      applyOffset(new Date('2026-11-15T00:00:00Z'), {
        months: 3,
      }).toISOString(),
    ).toBe('2027-02-15T00:00:00.000Z');
  });

  it('combines months with days', () => {
    expect(
      applyOffset(new Date('2026-01-15T00:00:00Z'), {
        months: 1,
        days: 3,
      }).toISOString(),
    ).toBe('2026-02-18T00:00:00.000Z');
  });
});

describe('dueStateFor', () => {
  // The ALAMB placement follow-ups: 1, 3 and 6 months after course exit.
  const schedule = {
    anchor: 'exit',
    offsets: [{ months: 1 }, { months: 3 }, { months: 6 }],
    graceDays: 14,
  };
  const exitedAt = new Date('2026-01-15T00:00:00Z');

  const at = (iso: string, existingCount = 0) =>
    dueStateFor({
      schedule,
      anchorAt: exitedAt,
      existingCount,
      now: new Date(iso),
    });

  it('is NOT_SCHEDULED without a schedule', () => {
    expect(
      dueStateFor({ schedule: null, anchorAt: exitedAt, existingCount: 0 })
        .status,
    ).toBe('NOT_SCHEDULED');
  });

  // A placement follow-up before the student has exited is not overdue; it is
  // not yet meaningful. Treating a missing anchor as "due now" would put every
  // enrolled student on the chase list from day one.
  it('is NOT_SCHEDULED while the anchor has not happened', () => {
    expect(
      dueStateFor({ schedule, anchorAt: null, existingCount: 0 }).status,
    ).toBe('NOT_SCHEDULED');
  });

  it('is UPCOMING before the first date', () => {
    const state = at('2026-01-20T00:00:00Z');
    expect(state.status).toBe('UPCOMING');
    expect(state.dueAt?.toISOString()).toBe('2026-02-15T00:00:00.000Z');
    expect(state.missedCount).toBe(0);
  });

  it('is DUE from the date until the grace runs out', () => {
    expect(at('2026-02-15T00:00:00Z').status).toBe('DUE');
    expect(at('2026-02-28T00:00:00Z').status).toBe('DUE');
  });

  it('is OVERDUE once the grace has run out, and says by how long', () => {
    const state = at('2026-03-10T00:00:00Z');
    expect(state.status).toBe('OVERDUE');
    expect(state.overdueByDays).toBe(23);
  });

  // Occurrences are matched to entries BY COUNT. A follow-up done a fortnight
  // late is still THAT follow-up; matching by proximity would mark it missed
  // and treat the next one as already done.
  it('advances to the next occurrence once one is recorded', () => {
    const state = at('2026-03-10T00:00:00Z', 1);
    expect(state.dueAt?.toISOString()).toBe('2026-04-15T00:00:00.000Z');
    expect(state.status).toBe('UPCOMING');
  });

  it('is UP_TO_DATE once every occurrence has an entry', () => {
    expect(at('2027-01-01T00:00:00Z', 3).status).toBe('UP_TO_DATE');
    expect(at('2027-01-01T00:00:00Z', 5).status).toBe('UP_TO_DATE');
  });

  // The number that matters on a chase list: a student six months past exit
  // with nothing recorded has missed all three, not one.
  it('counts every occurrence whose grace has already passed', () => {
    const state = at('2026-12-01T00:00:00Z');
    expect(state.status).toBe('OVERDUE');
    expect(state.missedCount).toBe(3);
  });

  it('counts only the ones still outstanding', () => {
    expect(at('2026-12-01T00:00:00Z', 2).missedCount).toBe(1);
  });

  it('reports no misses while merely upcoming', () => {
    expect(at('2026-01-20T00:00:00Z').missedCount).toBe(0);
  });

  it('reads offsets in date order however they were written', () => {
    const state = dueStateFor({
      schedule: { anchor: 'exit', offsets: [{ months: 6 }, { months: 1 }] },
      anchorAt: exitedAt,
      existingCount: 0,
      now: new Date('2026-01-20T00:00:00Z'),
    });
    expect(state.dueAt?.toISOString()).toBe('2026-02-15T00:00:00.000Z');
  });

  it('treats a zero grace as due-then-immediately-overdue', () => {
    const strict = dueStateFor({
      schedule: { anchor: 'exit', offsets: [{ months: 1 }] },
      anchorAt: exitedAt,
      existingCount: 0,
      now: new Date('2026-02-16T00:00:00Z'),
    });
    expect(strict.status).toBe('OVERDUE');
  });
});
