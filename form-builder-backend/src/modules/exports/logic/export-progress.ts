/**
 * Byte and record accounting for an in-flight export.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The worker never sees rows. It reuses `FormsService.exportSubmissions`, which
 * hands back an `AsyncGenerator<string>` of already-encoded chunks, and pipes
 * that straight into object storage — deliberately, because the moment this
 * module starts materialising rows to count them it has reintroduced the
 * buffering the whole feature exists to remove.
 *
 * So progress is measured by *reading the stream as it passes*, not by
 * instrumenting the query. Both counters below are single-pass, allocate
 * nothing per row, and are safe across chunk boundaries — a chunk can end in
 * the middle of a quoted CSV cell or a JSON string, and the state carries over.
 *
 * WHY NOT JUST SPLIT ON NEWLINES:
 *  Because `csvCell` quotes every value and a free-text answer routinely
 *  contains a line break. A naive `chunk.split('\n').length` reports a
 *  three-line answer as three submissions, so a 10 000-row export shows
 *  "31 000 of 10 000 rows written" — which is worse than showing no progress at
 *  all, because it makes the user believe the file is wrong.
 */

export type ExportRecordFormat = 'CSV' | 'JSON';

/**
 * How often progress reaches the database.
 *
 * Time-based rather than row-based. A row-based interval sounds tidier but
 * behaves badly at both ends: a wide form with 200 columns writes a batch every
 * few seconds and would barely update, while a narrow one writes several
 * batches a second and would hammer the writer with UPDATEs that nobody reads
 * more than once a second anyway. `rowsWritten` is a progress bar, not an
 * accounting record — the schema says so explicitly — so it is worth exactly
 * one write every couple of seconds and no more.
 */
export const PROGRESS_FLUSH_INTERVAL_MS = 2_000;

export class ExportProgressMeter {
  /** Total bytes handed to object storage, including anything this module added itself. */
  bytes = 0n;
  /** Submissions written so far, as read out of the encoded stream. */
  records = 0;

  private lastFlushAt = 0;
  private lastFlushedRecords = -1;

  // ── CSV scanner state ───────────────────────────────────────────────────
  /** Inside a quoted cell, where a newline is data rather than a row terminator. */
  private inQuotes = false;
  /** Previous character was a `"` while inside quotes — either an escaped quote or the close. */
  private pendingQuote = false;

  // ── JSON scanner state ──────────────────────────────────────────────────
  private depth = 0;
  private inString = false;
  private escaped = false;

  constructor(private readonly format: ExportRecordFormat) {}

  /**
   * Feed a chunk that came from the row source. Counts both bytes and records.
   */
  push(chunk: string): void {
    this.bytes += BigInt(Buffer.byteLength(chunk, 'utf8'));
    if (this.format === 'CSV') this.scanCsv(chunk);
    else this.scanJson(chunk);
  }

  /**
   * Feed a chunk this module produced itself — the per-form banner rows and
   * separators of an org-wide export, or the JSON envelope around them.
   *
   * Bytes only. Running the record scanner over these would count the banner
   * as a submission and, worse, would leave the JSON depth counter permanently
   * offset by the envelope's own braces so that every subsequent row was
   * counted at the wrong nesting level.
   */
  pushRaw(chunk: string): void {
    this.bytes += BigInt(Buffer.byteLength(chunk, 'utf8'));
  }

  /**
   * Should progress be written to the database now?
   *
   * Returns false when nothing has changed since the last flush, so an export
   * that stalls on a slow query does not keep rewriting the same number.
   */
  shouldFlush(now: number = Date.now()): boolean {
    if (this.records === this.lastFlushedRecords) return false;
    return now - this.lastFlushAt >= PROGRESS_FLUSH_INTERVAL_MS;
  }

  /** Record that the current counts have been persisted. */
  markFlushed(now: number = Date.now()): void {
    this.lastFlushAt = now;
    this.lastFlushedRecords = this.records;
  }

  /**
   * Count CSV row terminators outside quoted cells.
   *
   * The stream is `header CRLF row CRLF row …`, so every unquoted newline is
   * followed by exactly one data row — counting newlines counts rows and
   * excludes the header without a special case for it. When several forms are
   * concatenated into one org-wide file each section starts with its own
   * unterminated header, so the property holds per section too.
   *
   * `""` is CSV's escape for a literal quote. The scanner cannot decide what a
   * `"` means until it has seen the next character, which may live in the next
   * chunk — hence `pendingQuote` surviving across calls rather than a lookahead.
   */
  private scanCsv(chunk: string): void {
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i];

      if (this.pendingQuote) {
        this.pendingQuote = false;
        if (ch === '"') continue; // "" — an escaped quote, still inside the cell
        this.inQuotes = false; // the cell really did close
      }

      if (this.inQuotes) {
        if (ch === '"') this.pendingQuote = true;
        continue;
      }

      if (ch === '"') this.inQuotes = true;
      else if (ch === '\n') this.records++;
    }
  }

  /**
   * Count top-level elements of the JSON array the row source emits.
   *
   * Depth 1 is the array itself; each submission object opens at depth 1 and is
   * counted as it does. Objects nested inside an answer open at depth 2 or
   * deeper and are ignored, which is why this tracks depth rather than counting
   * commas — an answer object containing commas would otherwise inflate every
   * count in proportion to how much data the respondent typed.
   */
  private scanJson(chunk: string): void {
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i];

      if (this.escaped) {
        this.escaped = false;
        continue;
      }
      if (this.inString) {
        if (ch === '\\') this.escaped = true;
        else if (ch === '"') this.inString = false;
        continue;
      }

      if (ch === '"') this.inString = true;
      else if (ch === '[' || ch === '{') {
        this.depth++;
        if (this.depth === 2) this.records++;
      } else if (ch === ']' || ch === '}') {
        this.depth--;
      }
    }
  }
}
