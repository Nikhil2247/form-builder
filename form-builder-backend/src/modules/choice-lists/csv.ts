/**
 * CSV parsing for dictionary imports.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Hand-written rather than a dependency, and parsed HERE rather than in the
 * browser, for one reason: the preview the user maps their columns against and
 * the import that consumes that mapping must come from the same parser. Parsing
 * in the browser for the preview and again on the server for the commit means
 * two implementations that disagree about quoting the day someone uploads a
 * district called `Kadapa, YSR` — the preview shows one set of columns and the
 * import maps a different one, silently, into the wrong fields.
 *
 * Follows RFC 4180 where it matters in practice:
 *   • `"` quotes a field; `""` inside a quoted field is a literal quote
 *   • a quoted field may contain the delimiter, CR, and LF
 *   • CRLF and LF both end a record
 *
 * And two concessions to the files people actually have:
 *   • a UTF-8 BOM is stripped, because Excel writes one and it would otherwise
 *     become part of the first column's name and match no mapping
 *   • the delimiter is detected, because "CSV" exported from a spreadsheet in
 *     much of Europe and India is semicolon-separated
 */

/** Ceilings that keep a malformed or hostile upload from becoming an outage. */
export const CSV_LIMITS = {
  /** Characters of CSV text accepted in one request (~8 MB of UTF-8). */
  MAX_TEXT_LENGTH: 8_000_000,
  /** Columns read from the header. Beyond this the file is not a dictionary. */
  MAX_COLUMNS: 60,
  /** Records parsed, header excluded. Matches CHOICE_LIMITS.MAX_IMPORT_ITEMS. */
  MAX_ROWS: 20_000,
} as const;

export interface ParsedCsv {
  /** Header names, in file order, de-duplicated and trimmed. */
  columns: string[];
  /** Records as column-name → cell. Cells absent from a short row read as ''. */
  rows: Array<Record<string, string>>;
  /** Which delimiter was detected. Surfaced so the UI can say so. */
  delimiter: string;
  /**
   * True when MAX_ROWS cut the file short. The caller must not silently import
   * a truncated dictionary — a list quietly missing its last 40 000 schools is
   * far worse than a refusal.
   */
  truncated: boolean;
}

const CANDIDATE_DELIMITERS = [',', ';', '\t', '|'] as const;

/**
 * Guess the delimiter from the header line.
 *
 * Counts occurrences OUTSIDE quotes on the first line only. A file whose first
 * data row contains a comma inside a quoted label would otherwise outvote a
 * genuinely semicolon-separated header.
 */
function detectDelimiter(text: string): string {
  let headerEnd = text.length;
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      // `""` inside a quoted field is an escaped quote, not a close-then-open.
      if (quoted && text[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (!quoted && (char === '\n' || char === '\r')) {
      headerEnd = i;
      break;
    }
  }

  const header = text.slice(0, headerEnd);
  let best = ',';
  let bestCount = 0;

  for (const delimiter of CANDIDATE_DELIMITERS) {
    let count = 0;
    let inQuotes = false;
    for (let i = 0; i < header.length; i++) {
      const char = header[i];
      if (char === '"') inQuotes = !inQuotes;
      else if (char === delimiter && !inQuotes) count++;
    }
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }

  return best;
}

/** Split CSV text into records of raw cells. */
function parseRecords(
  text: string,
  delimiter: string,
  maxRecords: number,
): {
  records: string[][];
  truncated: boolean;
} {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  let sawAnyChar = false;

  const endField = () => {
    record.push(field);
    field = '';
  };

  const endRecord = () => {
    endField();
    // A trailing newline produces one final empty record; so does a blank line
    // in the middle of a file exported by a tool that pads. Neither is a row.
    if (!(record.length === 1 && record[0] === '')) records.push(record);
    record = [];
    sawAnyChar = false;
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && !sawAnyChar) {
      // Only opens a quoted field at the start of one. A stray quote mid-field
      // (`5" pipe`) is data, not syntax.
      quoted = true;
      sawAnyChar = true;
      continue;
    }

    if (char === delimiter) {
      endField();
      sawAnyChar = false;
      continue;
    }

    if (char === '\r') {
      if (text[i + 1] === '\n') i++;
      endRecord();
      if (records.length > maxRecords) return { records, truncated: true };
      continue;
    }

    if (char === '\n') {
      endRecord();
      if (records.length > maxRecords) return { records, truncated: true };
      continue;
    }

    field += char;
    sawAnyChar = true;
  }

  // Whatever is left when the text ends is the last record, unless the file
  // ended on a newline and there is nothing pending.
  if (field !== '' || record.length > 0) endRecord();

  return { records, truncated: false };
}

/**
 * Make header names usable as mapping keys.
 *
 * De-duplicated by suffix rather than dropped: a file with two columns both
 * called "name" still has two columns, and losing one silently would import
 * whichever the parser happened to keep.
 */
function normalizeColumns(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.slice(0, CSV_LIMITS.MAX_COLUMNS).map((name, index) => {
    const base =
      (name ?? '').trim().replace(/^\uFEFF/, '') || `column_${index + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  });
}

export function parseCsv(text: string): ParsedCsv {
  if (typeof text !== 'string') {
    throw new Error('Expected CSV text.');
  }

  // Excel prefixes a BOM. Left in place it becomes part of the first header
  // name, which then matches no column the user selected.
  const cleaned = text.replace(/^\uFEFF/, '');
  const delimiter = detectDelimiter(cleaned);

  // One extra so the header does not eat a row from the budget.
  const { records, truncated } = parseRecords(
    cleaned,
    delimiter,
    CSV_LIMITS.MAX_ROWS + 1,
  );

  if (records.length === 0) {
    return { columns: [], rows: [], delimiter, truncated: false };
  }

  const columns = normalizeColumns(records[0]);
  const rows = records.slice(1, CSV_LIMITS.MAX_ROWS + 1).map((record) => {
    const row: Record<string, string> = {};
    columns.forEach((column, index) => {
      row[column] = (record[index] ?? '').trim();
    });
    return row;
  });

  return {
    columns,
    rows,
    delimiter,
    truncated: truncated || records.length - 1 > CSV_LIMITS.MAX_ROWS,
  };
}

/**
 * Which CSV column feeds which field of a choice item.
 *
 * Column NAMES, not indices, so a mapping stays correct if the user re-exports
 * with the columns in a different order.
 */
export interface CsvMapping {
  value: string;
  label?: string;
  parentValue?: string;
  /** Extra columns to carry into `metadata`, as metadataKey → csvColumn. */
  metadata?: Record<string, string>;
}

export interface MappedItem {
  value: string;
  label?: string;
  parentValue?: string | null;
  metadata?: Record<string, unknown>;
  sortOrder?: number;
}

/**
 * Apply a mapping to parsed rows.
 *
 * Rows are NOT filtered here — `normalizeItems` in the service is the one place
 * that decides what is importable, and duplicating that judgement would let the
 * two disagree about how many rows were skipped and why.
 *
 * `sortOrder` follows file order, so a dictionary curated into a deliberate
 * sequence in a spreadsheet is offered in that sequence in the dropdown.
 */
export function applyMapping(
  rows: Array<Record<string, string>>,
  mapping: CsvMapping,
): MappedItem[] {
  const metadataPairs = Object.entries(mapping.metadata ?? {}).filter(
    ([key, column]) => key && column,
  );

  return rows.map((row, index) => {
    const metadata: Record<string, unknown> = {};
    for (const [key, column] of metadataPairs) {
      const cell = row[column];
      if (cell !== undefined && cell !== '') metadata[key] = cell;
    }

    return {
      value: row[mapping.value] ?? '',
      // An unmapped label falls back to the value, which `normalizeItems`
      // already does — passing `undefined` keeps that single source of truth.
      label: mapping.label ? row[mapping.label] : undefined,
      parentValue: mapping.parentValue
        ? (row[mapping.parentValue] ?? null)
        : null,
      metadata,
      sortOrder: index,
    };
  });
}
