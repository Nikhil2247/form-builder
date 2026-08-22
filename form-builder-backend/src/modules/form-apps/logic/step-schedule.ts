/**
 * When a step becomes due, and whether it has been missed.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A timeline shows what DID happen. The thing a monitoring programme actually
 * needs is the opposite — which visit did NOT happen, for whom, and how long
 * ago. That cannot be read off a list of submissions at any price; it needs a
 * statement of when each entry was expected.
 *
 * A schedule is that statement:
 *
 *   { anchor: "REGISTRATION" | "<stepKey>",
 *     offsets: [{ months: 1 }, { months: 3 }, { months: 6 }],
 *     graceDays: 14 }
 *
 * ── Advisory, never a gate ─────────────────────────────────────────────────
 * A step past its date stays fillable, and one not yet due can be filled early.
 * Blocking on a schedule would mean a worker standing in front of the
 * respondent cannot record what just happened — which is a worse failure than
 * an untidy date, and the kind of rule that teaches people to enter fake dates
 * to get past it.
 *
 * ── All arithmetic is UTC and day-granular ─────────────────────────────────
 * Due dates are compared at day resolution because that is the resolution the
 * question is asked at: "is the March visit overdue" is not a question about
 * hours. See the note in `period-cadence.ts` about the org-timezone limitation,
 * which applies here identically.
 */

export const SCHEDULE_ANCHOR_REGISTRATION = 'REGISTRATION';

export interface ScheduleOffset {
  days?: number;
  weeks?: number;
  months?: number;
}

export interface StepSchedule {
  /**
   * What the offsets count from: the record's creation (REGISTRATION), or the
   * most recent entry of another step by key — "three months after course
   * exit", which is when a placement follow-up is actually due.
   */
  anchor?: string;
  offsets?: ScheduleOffset[];
  /** How long past an offset before it counts as missed rather than due. */
  graceDays?: number;
}

/** Where a step stands against its schedule. */
export type DueStatus =
  'NOT_SCHEDULED' | 'UP_TO_DATE' | 'UPCOMING' | 'DUE' | 'OVERDUE';

export interface StepDueState {
  status: DueStatus;
  /** When the next unfilled occurrence was or is expected. */
  dueAt: Date | null;
  /** Whole days past `dueAt`. Zero unless OVERDUE. */
  overdueByDays: number;
  /** How many scheduled occurrences have no entry yet. */
  missedCount: number;
}

const DAY_MS = 86_400_000;
const MAX_OFFSETS = 24;

export const SCHEDULE_DEFAULTS = { GRACE_DAYS: 0 } as const;

/**
 * Read a stored schedule blob, or null when there is nothing usable in it.
 *
 * Null is the common case and must stay cheap — most steps are not scheduled,
 * and every one of them passes through here on every availability check.
 */
export function readSchedule(raw: unknown): Required<StepSchedule> | null {
  if (!raw || typeof raw !== 'object') return null;
  const schedule = raw as StepSchedule;

  const offsets = Array.isArray(schedule.offsets)
    ? schedule.offsets
        .filter(
          (offset): offset is ScheduleOffset =>
            !!offset && typeof offset === 'object',
        )
        .map((offset) => ({
          days: intOr(offset.days, 0),
          weeks: intOr(offset.weeks, 0),
          months: intOr(offset.months, 0),
        }))
        .filter(
          (offset) =>
            offset.days !== 0 || offset.weeks !== 0 || offset.months !== 0,
        )
        .slice(0, MAX_OFFSETS)
    : [];

  if (offsets.length === 0) return null;

  return {
    anchor:
      typeof schedule.anchor === 'string' && schedule.anchor.trim()
        ? schedule.anchor.trim()
        : SCHEDULE_ANCHOR_REGISTRATION,
    offsets,
    graceDays: Math.max(
      intOr(schedule.graceDays, SCHEDULE_DEFAULTS.GRACE_DAYS),
      0,
    ),
  };
}

function intOr(value: unknown, fallback: number): number {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? n : fallback;
}

/** The step key an offset counts from, for callers resolving anchor dates. */
export function scheduleAnchorKey(raw: unknown): string | null {
  const schedule = readSchedule(raw);
  if (!schedule) return null;
  return schedule.anchor === SCHEDULE_ANCHOR_REGISTRATION
    ? null
    : schedule.anchor;
}

/** `anchor` plus one offset, in UTC, with month arithmetic that does not drift. */
export function applyOffset(anchor: Date, offset: ScheduleOffset): Date {
  const withMonths = new Date(
    Date.UTC(
      anchor.getUTCFullYear(),
      anchor.getUTCMonth() + (offset.months ?? 0),
      anchor.getUTCDate(),
      anchor.getUTCHours(),
      anchor.getUTCMinutes(),
      anchor.getUTCSeconds(),
      anchor.getUTCMilliseconds(),
    ),
  );

  // Date.UTC rolls an overlong day into the next month — 31 January plus one
  // month becomes 3 March rather than 28 February. Clamped to the last day of
  // the target month, which is what "a month after the 31st" means to anyone
  // reading a due date.
  const intendedMonth =
    (((anchor.getUTCMonth() + (offset.months ?? 0)) % 12) + 12) % 12;
  if (withMonths.getUTCMonth() !== intendedMonth) {
    withMonths.setUTCDate(0);
  }

  return new Date(
    withMonths.getTime() +
      ((offset.weeks ?? 0) * 7 + (offset.days ?? 0)) * DAY_MS,
  );
}

/**
 * Where a step stands, given its schedule and how many entries exist.
 *
 * Occurrences are matched to entries BY COUNT, not by date. Three entries
 * satisfy the first three offsets regardless of when they were actually
 * recorded — a follow-up done a fortnight late is still that follow-up, and
 * matching by proximity would mark it missed while treating the next one as
 * done. Counting is also what makes this correct for steps whose entries carry
 * no comparable date at all.
 */
export function dueStateFor(input: {
  schedule: unknown;
  /** REGISTRATION date, or the resolved anchor step's latest entry. */
  anchorAt: Date | null;
  existingCount: number;
  now?: Date;
}): StepDueState {
  const schedule = readSchedule(input.schedule);
  const none: StepDueState = {
    status: 'NOT_SCHEDULED',
    dueAt: null,
    overdueByDays: 0,
    missedCount: 0,
  };

  if (!schedule) return none;
  // The anchor has not happened yet — a placement follow-up before the student
  // has exited is not due, it is not yet meaningful.
  if (!input.anchorAt) return none;

  const now = input.now ?? new Date();
  const dueDates = schedule.offsets.map((offset) =>
    applyOffset(input.anchorAt!, offset),
  );
  dueDates.sort((a, b) => a.getTime() - b.getTime());

  if (input.existingCount >= dueDates.length) {
    return { ...none, status: 'UP_TO_DATE' };
  }

  const next = dueDates[input.existingCount];
  const graceMs = schedule.graceDays * DAY_MS;

  // Every remaining occurrence whose grace has already run out.
  const missedCount = dueDates
    .slice(input.existingCount)
    .filter((date) => now.getTime() > date.getTime() + graceMs).length;

  if (now.getTime() < next.getTime()) {
    return {
      status: 'UPCOMING',
      dueAt: next,
      overdueByDays: 0,
      missedCount: 0,
    };
  }

  if (now.getTime() <= next.getTime() + graceMs) {
    return { status: 'DUE', dueAt: next, overdueByDays: 0, missedCount: 0 };
  }

  return {
    status: 'OVERDUE',
    dueAt: next,
    overdueByDays: Math.floor((now.getTime() - next.getTime()) / DAY_MS),
    missedCount,
  };
}
