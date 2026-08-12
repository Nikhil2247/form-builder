import { BadRequestException, NotFoundException } from '@nestjs/common';

import { FormsService } from './forms.service';

/**
 * The streamed export must produce byte-for-byte what the in-memory version
 * produced. The risky part is chunk boundaries: rows are emitted a batch at a
 * time, and a CRLF placed at the wrong end of a chunk either doubles a line
 * break between batches or leaves a trailing blank row that Excel reads as an
 * empty submission.
 *
 * Batches are 1 000 rows, so anything smaller never crosses a boundary — these
 * fixtures deliberately run past it.
 */

const QUESTIONS = [
  { id: 'q1', label: 'Full name' },
  { id: 'q2', label: 'Rating' },
  { id: 'q3' }, // no label: header falls back to the id
];

function submission(n: number) {
  return {
    id: `sub-${String(n).padStart(5, '0')}`,
    submittedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, n % 60)),
    status: 'COMPLETED',
    country: 'IN',
    answers: { q1: `Person ${n}`, q2: n % 5, q3: { nested: n } },
  };
}

/**
 * Minimal PrismaService stand-in. `findMany` honours the keyset cursor the way
 * the real client does, so batching is genuinely exercised rather than mocked
 * into always returning the same page.
 */
function prismaWith(rows: ReturnType<typeof submission>[], form: unknown = {
  versions: [{ questionsJson: QUESTIONS }],
}) {
  return {
    reader: {
      form: { findFirst: jest.fn().mockResolvedValue(form) },
      formSubmission: {
        count: jest.fn().mockResolvedValue(rows.length),
        findMany: jest.fn(({ take, cursor, skip }: any) => {
          const start = cursor ? rows.findIndex((r) => r.id === cursor.id) + (skip ?? 0) : 0;
          return Promise.resolve(rows.slice(start, start + take));
        }),
      },
    },
  };
}

function service(prisma: unknown) {
  return new FormsService(prisma as any, {} as any, {} as any, {} as any);
}

async function collect(chunks: AsyncGenerator<string>) {
  let out = '';
  for await (const chunk of chunks) out += chunk;
  return out;
}

describe('exportSubmissions (streamed)', () => {
  it('emits a header row and one line per submission, CRLF separated', async () => {
    const rows = [submission(1), submission(2)];
    const csv = await collect(await service(prismaWith(rows)).exportSubmissions('org', 'form', 'csv'));

    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('"Submission ID","Submitted At","Status","Country","Full name","Rating","q3"');
    expect(lines[1]).toBe(
      '"sub-00001","2026-01-01T00:00:01.000Z","COMPLETED","IN","Person 1","1","{""nested"":1}"',
    );
  });

  it('does not double or drop a line break at a batch boundary', async () => {
    // 2 500 rows = three batches, so two boundaries are crossed.
    const rows = Array.from({ length: 2_500 }, (_, i) => submission(i));
    const csv = await collect(await service(prismaWith(rows)).exportSubmissions('org', 'form', 'csv'));

    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(2_501); // header + every row, no trailing blank
    expect(lines.some((l) => l === '')).toBe(false);
    expect(lines[1]).toContain('"sub-00000"');
    expect(lines[2_500]).toContain('"sub-02499"');
  });

  /**
   * The cap is checked once, up front, against a COUNT. Responses keep arriving
   * during a long export, so by the time the last batch is read the table can
   * hold more rows than that count saw — the generator carries its own limit so
   * a form under the cap at the start cannot stream past it at the end.
   */
  it('stops at EXPORT_MAX_ROWS even when rows arrive mid-export', async () => {
    const prisma = prismaWith(Array.from({ length: 2_500 }, (_, i) => submission(i)));
    prisma.reader.formSubmission.count.mockResolvedValue(1_000); // count seen before the flood
    process.env.EXPORT_MAX_ROWS = '1500';
    try {
      const csv = await collect(await service(prisma).exportSubmissions('org', 'form', 'csv'));
      expect(csv.split('\r\n')).toHaveLength(1_501); // header + exactly the cap
    } finally {
      delete process.env.EXPORT_MAX_ROWS;
    }
  });

  it('produces a parseable JSON array', async () => {
    const rows = Array.from({ length: 1_200 }, (_, i) => submission(i));
    const json = await collect(await service(prismaWith(rows)).exportSubmissions('org', 'form', 'json'));

    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(1_200);
    expect(parsed[0].id).toBe('sub-00000');
    expect(parsed[1_199].answers.q1).toBe('Person 1199');
  });

  it('is an empty JSON array when there is nothing to export', async () => {
    expect(await collect(await service(prismaWith([])).exportSubmissions('org', 'form', 'json'))).toBe('[]');
  });

  // Validation must happen before the generator is handed back: the controller
  // writes a 200 and a Content-Disposition the moment it starts iterating, so
  // an exception raised later would arrive as a corrupt download.
  it('throws for an unknown form before yielding anything', async () => {
    await expect(service(prismaWith([], null)).exportSubmissions('org', 'nope', 'csv')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws when the row count exceeds the cap', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => submission(i));
    const prisma = prismaWith(rows);
    prisma.reader.formSubmission.count.mockResolvedValue(999_999);
    await expect(service(prisma).exportSubmissions('org', 'form', 'csv')).rejects.toThrow(
      BadRequestException,
    );
  });
});
