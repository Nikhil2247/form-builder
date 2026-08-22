import { applyMapping, CSV_LIMITS, parseCsv } from './csv';

/**
 * The dictionary importer's parser.
 *
 * These are the shapes of file people actually upload, not a general RFC 4180
 * conformance suite: a spreadsheet export with a BOM and CRLF line endings, a
 * semicolon-separated "CSV" from a European or Indian locale, and a district
 * name with a comma in it. Each one of these silently corrupts an import if the
 * parser gets it wrong — and a corrupted dictionary is not obviously broken, it
 * is a dropdown with subtly wrong options in it.
 */
describe('parseCsv', () => {
  it('reads a plain comma-separated file', () => {
    const result = parseCsv('code,name\nMH,Maharashtra\nKA,Karnataka\n');

    expect(result.columns).toEqual(['code', 'name']);
    expect(result.rows).toEqual([
      { code: 'MH', name: 'Maharashtra' },
      { code: 'KA', name: 'Karnataka' },
    ]);
  });

  it('strips the BOM Excel writes, so the first column name still matches a mapping', () => {
    // Left in place the BOM becomes part of `code`, the mapping names `code`,
    // and every row imports with an empty value.
    const result = parseCsv('﻿code,name\r\nMH,Maharashtra\r\n');

    expect(result.columns).toEqual(['code', 'name']);
    expect(result.rows[0]).toEqual({ code: 'MH', name: 'Maharashtra' });
  });

  it('keeps a comma inside a quoted field', () => {
    const result = parseCsv('code,name\nAP,"Kadapa, YSR"\n');

    expect(result.rows[0].name).toBe('Kadapa, YSR');
  });

  it('unescapes a doubled quote', () => {
    expect(parseCsv('code,name\nX,"He said ""hi"""\n').rows[0].name).toBe(
      'He said "hi"',
    );
  });

  it('keeps a newline inside a quoted field rather than splitting the record', () => {
    const result = parseCsv('code,name\nA,"line1\nline2"\nB,plain\n');

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].name).toBe('line1\nline2');
  });

  it('detects a semicolon-separated file', () => {
    const result = parseCsv('code;name;state\nD1;Pune;MH\n');

    expect(result.delimiter).toBe(';');
    expect(result.columns).toEqual(['code', 'name', 'state']);
    expect(result.rows[0]).toEqual({ code: 'D1', name: 'Pune', state: 'MH' });
  });

  it('detects a tab-separated file', () => {
    expect(parseCsv('code\tname\nT1\tTango\n').delimiter).toBe('\t');
  });

  it('reads a short row as empty cells rather than dropping the row', () => {
    const result = parseCsv('code,name,extra\nA,Alpha\n');

    expect(result.rows[0]).toEqual({ code: 'A', name: 'Alpha', extra: '' });
  });

  it('keeps both of two identically-named columns', () => {
    // Dropping one would import whichever the parser happened to keep, with no
    // indication that a column had gone missing.
    const result = parseCsv('name,name\n1,2\n');

    expect(result.columns).toEqual(['name', 'name_2']);
    expect(result.rows[0]).toEqual({ name: '1', name_2: '2' });
  });

  it('reads a final row with no trailing newline', () => {
    expect(parseCsv('code,name\nZ,Zed').rows).toEqual([
      { code: 'Z', name: 'Zed' },
    ]);
  });

  it('ignores blank lines', () => {
    expect(parseCsv('code,name\nA,Alpha\n\nB,Beta\n').rows).toHaveLength(2);
  });

  it('reports an empty file rather than inventing a header', () => {
    expect(parseCsv('').columns).toEqual([]);
    expect(parseCsv('').rows).toEqual([]);
  });

  it('flags truncation instead of silently importing a partial dictionary', () => {
    const rows = Array.from(
      { length: CSV_LIMITS.MAX_ROWS + 5 },
      (_, i) => `v${i},L${i}`,
    );
    const result = parseCsv(`v,l\n${rows.join('\n')}`);

    expect(result.rows).toHaveLength(CSV_LIMITS.MAX_ROWS);
    expect(result.truncated).toBe(true);
  });

  it('does not flag truncation at exactly the limit', () => {
    const rows = Array.from(
      { length: CSV_LIMITS.MAX_ROWS },
      (_, i) => `v${i},L${i}`,
    );
    const result = parseCsv(`v,l\n${rows.join('\n')}`);

    expect(result.rows).toHaveLength(CSV_LIMITS.MAX_ROWS);
    expect(result.truncated).toBe(false);
  });
});

describe('applyMapping', () => {
  const rows = [
    {
      district_code: 'MH-pune',
      district_name: 'Pune',
      state_code: 'MH',
      udise: '27250',
    },
    {
      district_code: 'MH-nashik',
      district_name: 'Nashik',
      state_code: 'MH',
      udise: '',
    },
  ];

  it('maps by column name and carries metadata', () => {
    const [first] = applyMapping(rows, {
      value: 'district_code',
      label: 'district_name',
      parentValue: 'state_code',
      metadata: { udise_code: 'udise' },
    });

    expect(first).toEqual({
      value: 'MH-pune',
      label: 'Pune',
      parentValue: 'MH',
      metadata: { udise_code: '27250' },
      sortOrder: 0,
    });
  });

  it('omits an empty metadata cell rather than storing an empty string', () => {
    const [, second] = applyMapping(rows, {
      value: 'district_code',
      metadata: { udise_code: 'udise' },
    });

    expect(second.metadata).toEqual({});
  });

  it('leaves an unmapped label undefined, so the service falls back to the value', () => {
    // Defaulting to the value here would duplicate a decision normalizeItems
    // already makes, and the two could then disagree.
    expect(
      applyMapping(rows, { value: 'district_code' })[0].label,
    ).toBeUndefined();
  });

  it('numbers sortOrder by file order, so a curated sequence survives the import', () => {
    expect(
      applyMapping(rows, { value: 'district_code' }).map((r) => r.sortOrder),
    ).toEqual([0, 1]);
  });

  it('yields an empty value for a column that is not in the file', () => {
    // normalizeItems drops these and counts them as skipped; the controller
    // rejects a mapping naming an unknown column before it ever gets here.
    expect(applyMapping(rows, { value: 'nope' })[0].value).toBe('');
  });
});
