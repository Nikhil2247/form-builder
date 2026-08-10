/**
 * Platform-global choice lists.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Seeds the reference data every tenant shares, currently India's states/UTs
 * and districts. These rows have `organizationId = null`, which makes them
 * visible to every organization and editable by none.
 *
 * SEPARATE FROM seed.ts ON PURPOSE. `seed.ts` truncates and rebuilds a
 * development dataset and refuses to run against production. This is reference
 * data that production genuinely needs, so it must be safe to run there — it is
 * therefore idempotent by upsert rather than by reset, and touches nothing it
 * does not own.
 *
 *   bun prisma/seed-choice-lists.ts        (or: ts-node prisma/seed-choice-lists.ts)
 *
 * Re-running after the source file changes reconciles the lists: new items are
 * added, changed labels are updated, and items that have disappeared are
 * DEACTIVATED rather than deleted — a district that is merged away still has to
 * render in every historical answer that references it.
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env first.');
}

// Prisma 7 removed the Rust engine, so a driver adapter is mandatory —
// `new PrismaClient()` with no options throws at construction. Same setup as
// prisma/seed.ts and PrismaService.
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

const STATES_SLUG = 'in-states';
const DISTRICTS_SLUG = 'in-districts';

interface SourceFile {
  _meta: { source: string; extractedAt: string; districtCount: number };
  states: Array<{ code: string; name: string; districts: string[] }>;
}

/**
 * Mirrors the value scheme documented in the source file's `_meta`.
 *
 * A district's value must be stable across re-imports, because it is what lands
 * in the answer. Deriving it from the state code plus a slug of the name means
 * two states may both have a "Bilaspur" without colliding.
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function upsertGlobalList(input: {
  slug: string;
  name: string;
  description: string;
  parentListId?: string | null;
  metadataSchema: unknown;
}) {
  // `findFirst` + create/update rather than `upsert`: the unique index on a
  // global slug is partial (WHERE organization_id IS NULL), and Prisma cannot
  // target a partial index in an upsert's `where`.
  const existing = await prisma.choiceList.findFirst({
    where: { organizationId: null, slug: input.slug },
    select: { id: true },
  });

  if (existing) {
    await prisma.choiceList.update({
      where: { id: existing.id },
      data: {
        name: input.name,
        description: input.description,
        parentListId: input.parentListId ?? null,
        metadataSchema: input.metadataSchema as any,
        deletedAt: null,
      },
    });
    return existing.id;
  }

  const created = await prisma.choiceList.create({
    data: {
      organizationId: null,
      slug: input.slug,
      name: input.name,
      description: input.description,
      parentListId: input.parentListId ?? null,
      metadataSchema: input.metadataSchema as any,
    },
    select: { id: true },
  });
  return created.id;
}

interface DesiredItem {
  value: string;
  label: string;
  parentValue: string | null;
  metadata: Record<string, unknown>;
  sortOrder: number;
}

/**
 * Reconcile a list's items against what the source says they should be.
 *
 * Additions and updates are straightforward. Removals are NOT deletions: an
 * item that vanishes from the source is marked inactive, so it stops being
 * offered while every stored answer that references it still resolves to a
 * label. Deleting it would turn historical submissions into bare codes.
 */
async function syncItems(listId: string, desired: DesiredItem[]) {
  const existing = await prisma.choiceItem.findMany({
    where: { listId },
    select: { id: true, value: true, label: true, parentValue: true, sortOrder: true, isActive: true },
  });
  const byValue = new Map(existing.map((item) => [item.value, item]));

  const toCreate: DesiredItem[] = [];
  const toUpdate: Array<{ id: string; data: Partial<DesiredItem> & { isActive: boolean } }> = [];

  for (const want of desired) {
    const have = byValue.get(want.value);
    if (!have) {
      toCreate.push(want);
      continue;
    }
    byValue.delete(want.value);
    const changed =
      have.label !== want.label ||
      have.parentValue !== want.parentValue ||
      have.sortOrder !== want.sortOrder ||
      !have.isActive;
    if (changed) {
      toUpdate.push({
        id: have.id,
        data: {
          label: want.label,
          parentValue: want.parentValue,
          sortOrder: want.sortOrder,
          isActive: true,
        },
      });
    }
  }

  // Whatever is left in `byValue` is no longer in the source.
  const toRetire = [...byValue.values()].filter((item) => item.isActive).map((item) => item.id);

  if (toCreate.length > 0) {
    await prisma.choiceItem.createMany({
      data: toCreate.map((item) => ({
        listId,
        value: item.value,
        label: item.label,
        parentValue: item.parentValue,
        metadata: item.metadata as any,
        sortOrder: item.sortOrder,
      })),
      skipDuplicates: true,
    });
  }

  for (const update of toUpdate) {
    await prisma.choiceItem.update({ where: { id: update.id }, data: update.data as any });
  }

  if (toRetire.length > 0) {
    await prisma.choiceItem.updateMany({
      where: { id: { in: toRetire } },
      data: { isActive: false },
    });
  }

  const itemCount = await prisma.choiceItem.count({ where: { listId, isActive: true } });

  // `version` is what the public items endpoint caches on, so it moves when —
  // and only when — something actually changed. Bumping it unconditionally
  // would throw away every cached cascade response on a no-op re-run, which is
  // the normal case for a seeder that is meant to be safe to run repeatedly.
  const changed = toCreate.length + toUpdate.length + toRetire.length > 0;

  await prisma.choiceList.update({
    where: { id: listId },
    data: { itemCount, ...(changed ? { version: { increment: 1 } } : {}) },
  });

  return { created: toCreate.length, updated: toUpdate.length, retired: toRetire.length, itemCount };
}

async function main() {
  const path = join(__dirname, 'data', 'in-states-districts.json');
  const source = JSON.parse(readFileSync(path, 'utf8')) as SourceFile;

  console.log(`Source: ${source._meta.source}`);
  console.log(`Extracted: ${source._meta.extractedAt}`);

  // ── States ────────────────────────────────────────────────────────────────
  const statesListId = await upsertGlobalList({
    slug: STATES_SLUG,
    name: 'India — States and Union Territories',
    description: `36 states and UTs. Source: IGOD, extracted ${source._meta.extractedAt}.`,
    metadataSchema: [],
  });

  const stateItems: DesiredItem[] = source.states.map((state, index) => ({
    value: state.code,
    label: state.name,
    parentValue: null,
    metadata: {},
    sortOrder: index,
  }));

  const stateResult = await syncItems(statesListId, stateItems);
  console.log(`  ${STATES_SLUG}: ${JSON.stringify(stateResult)}`);

  // ── Districts ─────────────────────────────────────────────────────────────
  const districtsListId = await upsertGlobalList({
    slug: DISTRICTS_SLUG,
    name: 'India — Districts',
    description: `${source._meta.districtCount} districts, cascading from ${STATES_SLUG}. Source: IGOD, extracted ${source._meta.extractedAt}.`,
    parentListId: statesListId,
    metadataSchema: [
      { key: 'state_code', label: 'State code', type: 'text' },
      { key: 'state_name', label: 'State', type: 'text' },
    ],
  });

  const districtItems: DesiredItem[] = [];
  let order = 0;
  for (const state of source.states) {
    for (const district of state.districts) {
      districtItems.push({
        value: `${state.code}-${slugify(district)}`,
        label: district,
        parentValue: state.code,
        // Carried so a rule can auto-fill the state name from a district
        // without a second cascade step.
        metadata: { state_code: state.code, state_name: state.name },
        sortOrder: order++,
      });
    }
  }

  // Guard: a collision here would silently merge two districts into one option.
  const uniqueValues = new Set(districtItems.map((item) => item.value));
  if (uniqueValues.size !== districtItems.length) {
    throw new Error(
      `Value collision in district data: ${districtItems.length} rows, ${uniqueValues.size} distinct values.`,
    );
  }

  const districtResult = await syncItems(districtsListId, districtItems);
  console.log(`  ${DISTRICTS_SLUG}: ${JSON.stringify(districtResult)}`);

  console.log('Global choice lists are up to date.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
