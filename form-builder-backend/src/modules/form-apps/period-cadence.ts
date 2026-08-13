/**
 * Recurring reporting windows, computed rather than stored.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A monthly programme under hand-made periods needs twelve rows a year, and
 * closes to every worker on the 1st of each month until somebody remembers to
 * add the next one. Under a cadence the current window is a pure function of
 * the configuration and the clock, so there is nothing to remember and nothing
 * to run.
 *
 * ── Why nothing here touches the database ──────────────────────────────────
 * These functions are called on the session-open path, which is the hottest
 * read in the app. An earlier design materialised the window there with an
 * upsert; that put a WRITE on every open, for a row only needed once something
 * is actually filed. Boundaries are computed here for free and the row is
 * written lazily at submit.
 *
 * ── Everything is UTC ──────────────────────────────────────────────────────
 * Deliberately, and it is a real limitation rather than an oversight. A cadence
 * anchored in UTC puts the month boundary at 00:00 UTC, so an organization at
 * UTC+11 sees a new month begin mid-morning on the last day of the old one.
 * Recording the org's zone and computing boundaries in it is the correct fix;
 * until then a window is a date range, entries are placed by `occurredAt`, and
 * the grace period absorbs the edge. See the note on `graceDays`.
 */

export const CADENCES = ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'] as const;
export type Cadence = (typeof CADENCES)[number];

export interface PeriodConfig {
  cadence: Cadence;
  /** ISO date the cycle counts from. Defaults to the start of 2000. */
  anchor?: string;
  /**
   * How long after a window closes it still accepts entries.
   *
   * Field data arrives late by nature: a worker who visited on the 28th and
   * reaches a keyboard on the 3rd must be able to file under the month it
   * happened. Zero means the window shuts the instant it ends.
   */
  graceDays?: number;
  /** How many CLOSED windows back may be filed into. Bounded, not unlimited. */
  backfillPeriods?: number;
}

/** A window. `sequence` is its position in the cadence, counted from the anchor. */
export interface PeriodWindow {
  sequence: number;
  label: string;
  startsAt: Date;
  endsAt: Date;
}

export const CADENCE_DEFAULTS = {
  ANCHOR: Date.UTC(2000, 0, 1),
  GRACE_DAYS: 0,
  BACKFILL_PERIODS: 1,
  /** A ceiling on how far back a caller may ask to file. */
  MAX_BACKFILL: 12,
} as const;

const DAY_MS = 86_400_000;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Read a stored `periodConfig` blob, defaulting every field.
 *
 * Returns null when the cadence is missing or unrecognised, which the caller
 * must treat as "this app has no recurring windows" rather than guessing one:
 * inventing MONTHLY for a misconfigured app would file real entries into
 * windows the author never defined.
 */
export function readPeriodConfig(raw: unknown): Required<PeriodConfig> | null {
  const config = (raw ?? {}) as PeriodConfig;
  if (!CADENCES.includes(config.cadence)) return null;

  const anchorMs = config.anchor ? Date.parse(config.anchor) : NaN;

  return {
    cadence: config.cadence,
    anchor: new Date(
      Number.isNaN(anchorMs) ? CADENCE_DEFAULTS.ANCHOR : anchorMs,
    ).toISOString(),
    graceDays: clampInt(config.graceDays, 0, 90, CADENCE_DEFAULTS.GRACE_DAYS),
    backfillPeriods: clampInt(
      config.backfillPeriods,
      0,
      CADENCE_DEFAULTS.MAX_BACKFILL,
      CADENCE_DEFAULTS.BACKFILL_PERIODS,
    ),
  };
}

function clampInt(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

/**
 * Which window contains `at`.
 *
 * Sequence is derived arithmetically rather than by stepping from the anchor,
 * so an app anchored in 2000 and read in 2030 costs the same as one anchored
 * last week. A loop would be 360 iterations for a monthly cadence and would
 * grow every month the platform stays up.
 */
export function windowAt(
  config: Required<PeriodConfig>,
  at: Date,
): PeriodWindow {
  const anchor = new Date(config.anchor);

  switch (config.cadence) {
    case 'WEEKLY': {
      const anchorDay = startOfUtcDay(anchor).getTime();
      const target = startOfUtcDay(at).getTime();
      // Math.floor, not a truncating division: an entry dated BEFORE the anchor
      // must land in a negative sequence rather than collapsing onto week 0
      // alongside the anchor week itself.
      const sequence = Math.floor((target - anchorDay) / (7 * DAY_MS));
      const startsAt = new Date(anchorDay + sequence * 7 * DAY_MS);
      const endsAt = new Date(startsAt.getTime() + 7 * DAY_MS - 1);
      return { sequence, label: weekLabel(startsAt), startsAt, endsAt };
    }

    case 'MONTHLY': {
      const sequence = monthsBetween(anchor, at);
      const startsAt = addUtcMonths(startOfUtcMonth(anchor), sequence);
      const endsAt = new Date(addUtcMonths(startsAt, 1).getTime() - 1);
      return {
        sequence,
        label: `${MONTH_NAMES[startsAt.getUTCMonth()]} ${startsAt.getUTCFullYear()}`,
        startsAt,
        endsAt,
      };
    }

    case 'QUARTERLY': {
      const sequence = Math.floor(monthsBetween(anchor, at) / 3);
      const startsAt = addUtcMonths(startOfUtcMonth(anchor), sequence * 3);
      const endsAt = new Date(addUtcMonths(startsAt, 3).getTime() - 1);
      const quarter = Math.floor(startsAt.getUTCMonth() / 3) + 1;
      return {
        sequence,
        label: `Q${quarter} ${startsAt.getUTCFullYear()}`,
        startsAt,
        endsAt,
      };
    }

    case 'YEARLY': {
      const sequence = Math.floor(monthsBetween(anchor, at) / 12);
      const startsAt = addUtcMonths(startOfUtcMonth(anchor), sequence * 12);
      const endsAt = new Date(addUtcMonths(startsAt, 12).getTime() - 1);
      const endYear = new Date(endsAt).getUTCFullYear();
      const startYear = startsAt.getUTCFullYear();
      return {
        sequence,
        label:
          startYear === endYear ? `${startYear}` : `${startYear}–${endYear}`,
        startsAt,
        endsAt,
      };
    }
  }
}

/** The window `n` positions before or after `window`. */
export function shiftWindow(
  config: Required<PeriodConfig>,
  window: PeriodWindow,
  by: number,
): PeriodWindow {
  if (by === 0) return window;
  // Re-derived from a date inside the target window rather than by adding a
  // fixed span: months are not a constant number of milliseconds, so arithmetic
  // on the timestamp drifts across February and every 31-day month.
  const step =
    config.cadence === 'WEEKLY'
      ? new Date(window.startsAt.getTime() + by * 7 * DAY_MS)
      : addUtcMonths(window.startsAt, by * monthsPerPeriod(config.cadence));
  return windowAt(config, step);
}

function monthsPerPeriod(cadence: Cadence): number {
  if (cadence === 'MONTHLY') return 1;
  if (cadence === 'QUARTERLY') return 3;
  if (cadence === 'YEARLY') return 12;
  return 0;
}

/**
 * Every window a report may be filed into right now, newest first.
 *
 * The current one, plus up to `backfillPeriods` closed ones that are still
 * inside their grace. This is the whole of "late entry is normal": a worker on
 * the 3rd sees both March and February and picks the month the visit actually
 * happened in.
 */
export function fileableWindows(
  config: Required<PeriodConfig>,
  now: Date,
): PeriodWindow[] {
  const current = windowAt(config, now);
  const windows = [current];

  for (let back = 1; back <= config.backfillPeriods; back += 1) {
    const previous = shiftWindow(config, current, -back);
    // Grace runs from the window's END, so a 10-day grace on a monthly cadence
    // means "the 1st to the 10th", not "10 days from whenever this is asked".
    if (now.getTime() <= previous.endsAt.getTime() + config.graceDays * DAY_MS) {
      windows.push(previous);
    }
  }

  return windows;
}

// ─────────────────────────────────────────────────────────────────────────────
// UTC date helpers. Kept local rather than pulled from a date library: these
// four are the entire surface, and a dependency here would be load-bearing on
// the submit path.
// ─────────────────────────────────────────────────────────────────────────────

function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function startOfUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addUtcMonths(date: Date, months: number): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1),
  );
}

/** Whole months from `from`'s month to `to`'s month. Negative before the anchor. */
function monthsBetween(from: Date, to: Date): number {
  return (
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth())
  );
}

function weekLabel(startsAt: Date): string {
  const end = new Date(startsAt.getTime() + 6 * DAY_MS);
  const short = (d: Date) =>
    `${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()].slice(0, 3)}`;
  return startsAt.getUTCFullYear() === end.getUTCFullYear()
    ? `${short(startsAt)} – ${short(end)} ${end.getUTCFullYear()}`
    : `${short(startsAt)} ${startsAt.getUTCFullYear()} – ${short(end)} ${end.getUTCFullYear()}`;
}
