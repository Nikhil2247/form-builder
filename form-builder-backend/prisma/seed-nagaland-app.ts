/**
 * Nagaland "Monitoring Progress Reporting System" — buildability test.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This is not a demo fixture. It is an EXPERIMENT: can the reference form at
 * formsubmission-ssebrc.kesug.com be expressed as configuration on this
 * platform, today, with nothing hand-written?
 *
 * The honesty of the answer depends entirely on one decision: every form here
 * goes through the SAME `normalizeFormStructure` and `compileRules` the API
 * runs on save and publish. Nothing is written straight to JSONB. If a
 * construct cannot be expressed, this script FAILS rather than seeding
 * something the product would reject — a fixture that demonstrates behaviour
 * the API does not allow is worse than no fixture.
 *
 *   bun prisma/seed-nagaland-app.ts
 *
 * Idempotent: re-running updates the same rows. Requires `db:seed` (for an
 * organization and its members) and `db:seed:choices` (for in-states /
 * in-districts) to have been run first.
 *
 * ── What this proves, and what it does not ─────────────────────────────────
 * Read the verdict printed at the end. In short: Sections A and B of the
 * reference form are fully expressible — cascading selects, the auto-filled
 * UDISE code, the Yes/No/NA checklist, the cross-field numeric constraints and
 * the SDP conditionals all work as configuration. So is the SHAPE that holds
 * them together, now that steps and sessions exist: the repeat groups
 * ("+ Add School Visit"), the single "Submit All Reports" act, the duplicate
 * check across visits and the fixed reporting period are all configuration on
 * one app at one public URL.
 *
 * The seeded reports are written as that shape too — a submitted session per
 * respondent, whose entries point at the submissions they became. Seeding loose
 * submissions instead would leave every individual row looking correct while
 * the session tables sat empty, which is precisely the kind of gap a
 * buildability test exists to catch.
 *
 * ── About the reference data ───────────────────────────────────────────────
 * `ng-blocks` carries real Nagaland block names. `ng-schools` is DEMONSTRATION
 * DATA: one genuine row taken from the reference form's own screenshot
 * (GHS Botsa / 13070300802) and a handful of clearly-marked samples so the
 * cascade and the UDISE auto-fill have something to resolve against. Real
 * school data has to come from UDISE+; nothing here should be mistaken for it.
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';

import {
  compileRules,
  planLookupRequests,
  readPlan,
  resolveLookupBag,
  runFormRules,
  type FormRule,
} from '../src/common/rules';
import { normalizeFormStructure, normalizeTheme } from '../src/modules/forms/form-structure';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL is not set. Copy .env.example to .env first.');

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

// ─────────────────────────────────────────────────────────────────────────────
// Theme — the reference form's green government livery.
// ─────────────────────────────────────────────────────────────────────────────

const THEME = {
  preset: 'emerald',
  primaryColor: '#1b7a3e',
  backgroundColor: '#f4f7f4',
  cardColor: '#ffffff',
  textColor: '#16241b',
  fontFamily: 'Inter',
  borderRadius: 'md',
  cardVariant: 'card',
};

// ─────────────────────────────────────────────────────────────────────────────
// Reference data
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Nagaland community-development blocks, by district value.
 *
 * Keyed against `in-districts` values (`NL-kohima`), which is what makes the
 * District → Block cascade resolve. Not the complete LGD set — enough
 * districts to exercise the cascade honestly, including the two the reference
 * form's screenshots happened to show (Chiephobozou under Kohima, Chozuba
 * under Phek).
 */
const NAGALAND_BLOCKS: Record<string, string[]> = {
  'NL-kohima': ['Chiephobozou', 'Jakhama', 'Kohima Sadar', 'Sechü Zubza', 'Tseminyu'],
  'NL-phek': ['Chozuba', 'Chetheba', 'Phek Sadar', 'Pfutsero', 'Sekruzu'],
  'NL-dimapur': ['Dhansiripar', 'Kuhuboto', 'Medziphema', 'Niuland'],
  'NL-mokokchung': ['Chuchuyimlang', 'Kubolong', 'Mangkolemba', 'Ongpangkong'],
  'NL-tuensang': ['Chare', 'Longkhim', 'Noksen', 'Tuensang Sadar'],
  'NL-wokha': ['Baghty', 'Chukitong', 'Ralan', 'Wokha Sadar'],
  'NL-zunheboto': ['Akuluto', 'Aghunato', 'Satakha', 'Zunheboto Sadar'],
  'NL-mon': ['Aboi', 'Phomching', 'Tizit', 'Wakching'],
};

/**
 * Schools. DEMONSTRATION DATA — see the file header.
 *
 * Exactly one row is real: GHS Botsa, whose UDISE code is visible in the
 * reference form's own screenshot. The rest exist so the cascade has depth and
 * the `lookup()` auto-fill has something to resolve; their codes are
 * deliberately marked so nobody mistakes them for a UDISE+ extract.
 */
const DEMO_SCHOOLS: Array<{
  block: string;
  name: string;
  udise: string;
  category: string;
  real?: boolean;
}> = [
  { block: 'Chiephobozou', name: 'GHS Botsa', udise: '13070300802', category: 'Secondary', real: true },
  { block: 'Chiephobozou', name: 'GMS Tsiepama', udise: 'DEMO-13070300901', category: 'Middle' },
  { block: 'Chiephobozou', name: 'GPS Rüsoma', udise: 'DEMO-13070301004', category: 'Primary' },
  { block: 'Kohima Sadar', name: 'Government High School Kohima', udise: 'DEMO-13070100101', category: 'Secondary' },
  { block: 'Kohima Sadar', name: 'GMS Lerie', udise: 'DEMO-13070100205', category: 'Middle' },
  { block: 'Chozuba', name: 'GHS Chozuba', udise: 'DEMO-13080200301', category: 'Secondary' },
  { block: 'Chozuba', name: 'GMS Chozuba Town', udise: 'DEMO-13080200402', category: 'Middle' },
  { block: 'Phek Sadar', name: 'Government Higher Secondary School Phek', udise: 'DEMO-13080100101', category: 'Higher Secondary' },
  { block: 'Medziphema', name: 'GHS Medziphema', udise: 'DEMO-13010300501', category: 'Secondary' },
  { block: 'Mangkolemba', name: 'GHS Mangkolemba', udise: 'DEMO-13040200601', category: 'Secondary' },
  // Wokha, so that every seeded respondent's district has schools to visit. The
  // school-visits step has a minimum of one entry, and a respondent whose
  // district resolved to nothing would be seeded as a report the app itself
  // would reject — see the assertion at the end of the response loop.
  { block: 'Wokha Sadar', name: 'GHS Wokha', udise: 'DEMO-13050100101', category: 'Secondary' },
  { block: 'Wokha Sadar', name: 'GMS New Wokha', udise: 'DEMO-13050100207', category: 'Middle' },
  { block: 'Baghty', name: 'GPS Baghty', udise: 'DEMO-13050200304', category: 'Primary' },
];

const MONITORING_CHECKLIST = [
  'ECCE Curriculum Implementation (if applicable)',
  'Vidyapravesh Implementation in Class 1',
  'Availability of TLMs',
  'Use of TLMs in Classroom',
  'Use of ICT Materials',
  'Use of Library Books',
  'Competency-based Teaching & Assessment',
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function slugifyValue(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function options(labels: string[]) {
  return labels.map((label) => ({
    id: `opt_${slugifyValue(label)}`,
    label,
    value: slugifyValue(label),
  }));
}

/** Today, as the DATE control expects it. */
const TODAY = new Date().toISOString().slice(0, 10);

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic randomness
//
// A seeded PRNG rather than Math.random, so two runs produce identical
// responses. Screenshots stay comparable and a number that looks wrong can be
// reproduced instead of hunted.
// ─────────────────────────────────────────────────────────────────────────────

let rngState = 0x5eed1234;
function rnd(): number {
  rngState ^= rngState << 13;
  rngState ^= rngState >>> 17;
  rngState ^= rngState << 5;
  return ((rngState >>> 0) % 1_000_000) / 1_000_000;
}
const int = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));
const pick = <T,>(list: readonly T[]): T => list[int(0, list.length - 1)];
const chance = (p: number) => rnd() < p;
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const isoDaysAgo = (n: number) => daysAgo(n).toISOString().slice(0, 10);

const RESPONDENTS = [
  { name: 'Imlikumba Jamir', designation: 'ToT', district: 'NL-kohima', ebrc: 'Yes' },
  { name: 'Vikheho Swu', designation: 'BRP', district: 'NL-phek', ebrc: 'No' },
  { name: 'Akangla Longkumer', designation: 'CRP', district: 'NL-mokokchung', ebrc: 'No' },
  { name: 'Thejano Rio', designation: 'DIET Faculty', district: 'NL-kohima', ebrc: 'Yes' },
  { name: 'Nzanbeni Kikon', designation: 'SRG Member', district: 'NL-wokha', ebrc: 'No' },
];

const TRAINING_NAMES = [
  'FLN Capacity Building — Module 3',
  'Vidyapravesh Orientation for Class 1 Teachers',
  'ECCE Curriculum Rollout Workshop',
  'ICT in the Classroom — Refresher',
  'Competency-based Assessment Design',
  'Library Utilisation and Reading Corners',
];

const TRAINING_ORGANISERS = [
  'SCERT Nagaland',
  'Samagra Shiksha Nagaland',
  'DIET Kohima',
  'NIEPA (regional)',
  'District Mission Authority',
];

const VISIT_PURPOSES = [
  'Routine quarterly monitoring visit to review FLN implementation and classroom practice.',
  'Follow-up on the previous visit’s action points, particularly TLM usage in Classes 1–3.',
  'Verification of APAAR ID generation progress and Aadhaar validation status.',
  'Support visit requested by the head teacher regarding the School Development Plan.',
  'Joint inspection with the block resource team covering ECCE and library usage.',
];

const REMARKS = [
  'Head teacher cooperative. TLMs available but under-used in Classes 2 and 3; demonstrated two activities during the visit.',
  'ICT lab functional. Requested additional projector bulbs through the block office.',
  'Aadhaar validation pending for a small number of migrant students; school has been advised on the process.',
  'Library well organised and in active use. Reading corner set up in every primary classroom.',
  '',
];

async function upsertOrgChoiceList(input: {
  organizationId: string;
  slug: string;
  name: string;
  description: string;
  parentListId: string | null;
  metadataSchema: unknown;
}) {
  const existing = await prisma.choiceList.findFirst({
    where: { organizationId: input.organizationId, slug: input.slug },
    select: { id: true },
  });

  if (existing) {
    await prisma.choiceList.update({
      where: { id: existing.id },
      data: {
        name: input.name,
        description: input.description,
        parentListId: input.parentListId,
        metadataSchema: input.metadataSchema as any,
        deletedAt: null,
      },
    });
    return existing.id;
  }

  const created = await prisma.choiceList.create({
    data: {
      organizationId: input.organizationId,
      slug: input.slug,
      name: input.name,
      description: input.description,
      parentListId: input.parentListId,
      metadataSchema: input.metadataSchema as any,
    },
    select: { id: true },
  });
  return created.id;
}

async function replaceItems(
  listId: string,
  items: Array<{
    value: string;
    label: string;
    parentValue: string | null;
    metadata?: Record<string, unknown>;
  }>,
) {
  await prisma.choiceItem.deleteMany({ where: { listId } });
  await prisma.choiceItem.createMany({
    data: items.map((item, index) => ({
      listId,
      value: item.value,
      label: item.label,
      parentValue: item.parentValue,
      metadata: (item.metadata ?? {}) as any,
      sortOrder: index,
    })),
  });
  await prisma.choiceList.update({
    where: { id: listId },
    data: { itemCount: items.length, version: { increment: 1 } },
  });
}

/**
 * Create or update a form AND publish it, exactly as the API would.
 *
 * The structure goes through `normalizeFormStructure` and the rules through
 * `compileRules` — the same two functions `updateForm` and `publishForm` call.
 * A construct this platform cannot express therefore throws here, which is the
 * entire point of the exercise.
 */
async function publishForm(input: {
  organizationId: string;
  createdById: string;
  subjectTypeId: string | null;
  subjectRole: 'NONE' | 'REGISTERS' | 'ATTACHES';
  slug: string;
  title: string;
  description: string;
  pages: any[];
  questions: any[];
  rules: FormRule[];
  knownChoiceLists: string[];
}) {
  const structure = normalizeFormStructure({
    pages: input.pages,
    questions: input.questions,
    logic: [],
    rules: input.rules,
  });

  const compiled = compileRules(structure.rules as FormRule[], {
    knownKeys: structure.questions.map((q: any) => q.key),
    allowReferences: Boolean(input.subjectTypeId),
    knownChoiceLists: input.knownChoiceLists,
  });

  if (!compiled.ok) {
    throw new Error(
      `Rules for "${input.title}" do not compile:\n` +
        compiled.errors.map((e) => `  • ${e.ruleId ?? 'form'}: ${e.message}`).join('\n'),
    );
  }

  const theme = normalizeTheme(THEME);
  const existing = await prisma.form.findUnique({
    where: { slug: input.slug },
    select: { id: true, currentVersion: true },
  });

  const formId = existing?.id ?? randomUUID();
  const nextVersion = (existing?.currentVersion ?? 0) + 1;

  const payload = {
    organizationId: input.organizationId,
    createdById: input.createdById,
    slug: input.slug,
    title: input.title,
    description: input.description,
    status: 'PUBLISHED' as const,
    layoutMode: 'DOCUMENT',
    currentVersion: nextVersion,
    themeConfig: theme as any,
    pagesJson: structure.pages as any,
    questionsJson: structure.questions as any,
    logicJson: structure.logic as any,
    rulesJson: structure.rules as any,
    subjectTypeId: input.subjectTypeId,
    subjectRole: input.subjectRole,
    deletedAt: null,
  };

  if (existing) {
    await prisma.form.update({ where: { id: formId }, data: payload });
  } else {
    await prisma.form.create({ data: { id: formId, ...payload } });
  }

  const version = await prisma.formVersion.create({
    data: {
      formId,
      version: nextVersion,
      pagesJson: structure.pages as any,
      questionsJson: structure.questions as any,
      logicJson: structure.logic as any,
      themeJson: theme as any,
      rulesJson: structure.rules as any,
      compiledRules: compiled.plan as any,
    },
    select: { id: true },
  });

  return {
    id: formId,
    slug: input.slug,
    title: input.title,
    version: nextVersion,
    versionId: version.id,
    questions: structure.questions,
    // Round-tripped through `readPlan` rather than used directly, so the
    // responses below are generated against the exact shape the submit path
    // reads back out of the database.
    plan: readPlan(compiled.plan),
    questionCount: structure.questions.length,
    ruleCount: structure.rules.length,
    calculatedKeys: compiled.plan.calculatedKeys,
    lookups: compiled.plan.lookups ?? [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Responses
// ─────────────────────────────────────────────────────────────────────────────

interface PublishedForm {
  id: string;
  slug: string;
  title: string;
  version: number;
  versionId: string;
  questions: any[];
  plan: ReturnType<typeof readPlan>;
}

/**
 * Turn a set of raw answers into a submission the way the API would.
 *
 * The answers go through `runFormRules` before they are stored, with the same
 * lookup bag the submit path builds — so calculated fields hold their DERIVED
 * value, hidden questions are dropped, and the row is exactly what a real
 * respondent's would have been.
 *
 * Writing the answers straight to JSONB would have been three lines shorter and
 * would have produced fixture data that no submission could ever look like:
 * blank UDISE codes, blank coverage percentages, and answers to questions that
 * were never on screen.
 */
function buildAnswers(
  form: PublishedForm,
  raw: Record<string, unknown>,
  schoolMetadata: Map<string, Record<string, unknown>>,
) {
  const byKey = new Map<string, any>(form.questions.map((q) => [q.key, q]));

  const answersById: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const question = byKey.get(key);
    if (!question) throw new Error(`${form.slug}: no question with key "${key}"`);
    answersById[question.id] = value;
  }

  const answersByKey: Record<string, unknown> = { ...raw };
  const requests = planLookupRequests(form.plan.lookups, answersByKey as any);
  const lookups = resolveLookupBag(requests, schoolMetadata);

  const evaluated = runFormRules({
    questions: form.questions,
    plan: form.plan,
    answersById: answersById as any,
    lookups,
  });

  // Drop anything a rule hid, exactly as the validator does on ingest.
  const stored: Record<string, unknown> = {};
  for (const [id, value] of Object.entries(evaluated.answersById)) {
    if (evaluated.hiddenQuestionIds.has(id)) continue;
    if (value === null || value === undefined || value === '') continue;
    stored[id] = value;
  }

  if (evaluated.violations.length > 0) {
    throw new Error(
      `${form.slug}: generated response violates its own rules — ` +
        evaluated.violations.map((v) => v.message).join('; '),
    );
  }

  return stored;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  // ── Prerequisites ────────────────────────────────────────────────────────
  const org = await prisma.organization.findFirst({
    where: { isActive: true, deletedAt: null },
    select: { id: true, name: true, slug: true },
  });
  if (!org) throw new Error('No active organization. Run `bun run db:seed` first.');

  const member = await prisma.organizationMember.findFirst({
    where: { organizationId: org.id },
    select: { userId: true },
  });
  if (!member) throw new Error('The organization has no members. Run `bun run db:seed` first.');

  const districtsList = await prisma.choiceList.findFirst({
    where: { organizationId: null, slug: 'in-districts' },
    select: { id: true, itemCount: true },
  });
  if (!districtsList) {
    throw new Error('Global list `in-districts` is missing. Run `bun run db:seed:choices` first.');
  }

  console.log(`Organization: ${org.name} (${org.slug})`);
  console.log(`Districts available: ${districtsList.itemCount}\n`);

  // ── 1. Blocks and schools ────────────────────────────────────────────────
  const blocksListId = await upsertOrgChoiceList({
    organizationId: org.id,
    slug: 'ng-blocks',
    name: 'Nagaland — Blocks',
    description: 'Community-development blocks, cascading from in-districts.',
    parentListId: districtsList.id,
    metadataSchema: [{ key: 'district_value', label: 'District', type: 'text' }],
  });

  const blockItems = Object.entries(NAGALAND_BLOCKS).flatMap(([districtValue, blocks]) =>
    blocks.map((block) => ({
      value: `${districtValue}-${slugifyValue(block)}`,
      label: block,
      parentValue: districtValue,
      metadata: { district_value: districtValue },
    })),
  );
  await replaceItems(blocksListId, blockItems);
  console.log(`  ng-blocks: ${blockItems.length} blocks across ${Object.keys(NAGALAND_BLOCKS).length} districts`);

  const blockValueByName = new Map(blockItems.map((item) => [item.label, item.value]));

  const schoolsListId = await upsertOrgChoiceList({
    organizationId: org.id,
    slug: 'ng-schools',
    name: 'Nagaland — Schools (demo)',
    description:
      'DEMONSTRATION DATA. One real row (GHS Botsa); the rest are samples so the cascade and UDISE auto-fill resolve. Replace from UDISE+.',
    parentListId: blocksListId,
    metadataSchema: [
      { key: 'udise_code', label: 'UDISE Code', type: 'text' },
      { key: 'category', label: 'School category', type: 'text' },
    ],
  });

  const schoolItems = DEMO_SCHOOLS.map((school) => {
    const parentValue = blockValueByName.get(school.block);
    if (!parentValue) throw new Error(`Demo school references unknown block "${school.block}".`);
    return {
      value: `${parentValue}-${slugifyValue(school.name)}`,
      label: school.name,
      parentValue,
      metadata: {
        udise_code: school.udise,
        category: school.category,
        ...(school.real ? { source: 'reference-form-screenshot' } : { source: 'demo' }),
      },
    };
  });
  await replaceItems(schoolsListId, schoolItems);
  console.log(`  ng-schools: ${schoolItems.length} schools (1 real, ${schoolItems.length - 1} demo)\n`);

  const knownChoiceLists = ['in-states', 'in-districts', 'ng-blocks', 'ng-schools'];

  // ── 2. Subject type ──────────────────────────────────────────────────────
  //
  // `identityConfig` is what makes longitudinal reporting work. Without it every
  // session would mint a brand-new "Respondent" and one person's visits would
  // scatter across a fresh record each cycle instead of accumulating.
  const identityConfig = {
    displayName: ['respondent_name'],
    attributes: ['designation', 'district', 'block'],
    // No natural staff number in this form, so the session service derives a
    // stable synthetic id by hashing the displayName answers — same person,
    // same subject, every cycle.
  };

  const subjectType = await prisma.subjectType.upsert({
    where: { organizationId_slug: { organizationId: org.id, slug: 'respondent' } },
    update: { name: 'Respondent', icon: '🧑‍🏫', identityConfig: identityConfig as any },
    create: {
      organizationId: org.id,
      slug: 'respondent',
      name: 'Respondent',
      icon: '🧑‍🏫',
      identityConfig: identityConfig as any,
    },
    select: { id: true },
  });

  // ── 3. Section A — Respondent Details (REGISTERS) ────────────────────────
  const respondentForm = await publishForm({
    organizationId: org.id,
    createdById: member.userId,
    subjectTypeId: subjectType.id,
    subjectRole: 'REGISTERS',
    slug: 'ng-respondent-details',
    title: 'Section A — Respondent Details',
    description: 'Who is reporting. Completed once per reporting period.',
    pages: [{ pageNumber: 1, title: 'Respondent details', description: '' }],
    knownChoiceLists,
    questions: [
      {
        id: 'ra_name',
        key: 'respondent_name',
        type: 'SHORT_TEXT',
        label: 'Name of Respondent',
        validation: { required: true, maxLength: 120 },
      },
      {
        id: 'ra_designation',
        key: 'designation',
        type: 'DROPDOWN',
        label: 'Designation',
        validation: { required: true },
        options: options(['ToT', 'BRP', 'CRP', 'DIET Faculty', 'SRG Member', 'Other']),
      },
      // The reference form starts at District because the state is implied.
      // `in-districts` cascades from `in-states`, so the state has to be a real
      // question — defaulted to Nagaland, which now actually pre-fills.
      {
        id: 'ra_state',
        key: 'state',
        type: 'DROPDOWN',
        label: 'State',
        validation: { required: true },
        defaultValue: 'NL',
        optionsSource: { kind: 'CHOICE_LIST', listSlug: 'in-states', searchable: true },
      },
      {
        id: 'ra_district',
        key: 'district',
        type: 'DROPDOWN',
        label: 'District',
        validation: { required: true },
        optionsSource: {
          kind: 'CHOICE_LIST',
          listSlug: 'in-districts',
          parentQuestionKey: 'state',
          searchable: true,
        },
      },
      {
        id: 'ra_block',
        key: 'block',
        type: 'DROPDOWN',
        label: 'Block',
        validation: { required: true },
        optionsSource: {
          kind: 'CHOICE_LIST',
          listSlug: 'ng-blocks',
          parentQuestionKey: 'district',
        },
      },
      {
        id: 'ra_ebrc',
        key: 'is_ebrc_coordinator',
        type: 'SINGLE_CHOICE',
        label: 'Are you an EBRC Coordinator?',
        validation: { required: true },
        options: options(['Yes', 'No']),
      },
    ],
    rules: [],
  });

  // ── 4. Training programme (ATTACHES) ─────────────────────────────────────
  // Both "attended" and "conducted" have the identical five fields, so they are
  // one form with a role question rather than two near-duplicates.
  const trainingForm = await publishForm({
    organizationId: org.id,
    createdById: member.userId,
    subjectTypeId: subjectType.id,
    subjectRole: 'ATTACHES',
    slug: 'ng-training-programme',
    title: 'Training Programme',
    description: 'One entry per training. Submit once for each programme attended or conducted.',
    pages: [{ pageNumber: 1, title: 'Training programme', description: '' }],
    knownChoiceLists,
    questions: [
      {
        id: 'tr_role',
        key: 'participation',
        type: 'SINGLE_CHOICE',
        label: 'Your role in this training',
        validation: { required: true },
        options: options(['Attended by me', 'Conducted by me']),
      },
      {
        id: 'tr_name',
        key: 'training_name',
        type: 'SHORT_TEXT',
        label: 'Name of Training',
        validation: { required: true, maxLength: 200 },
      },
      {
        id: 'tr_organiser',
        key: 'organised_by',
        type: 'SHORT_TEXT',
        label: 'Organised By',
        validation: { maxLength: 200 },
      },
      {
        id: 'tr_venue',
        key: 'venue',
        type: 'SHORT_TEXT',
        label: 'Venue',
        placeholder: 'e.g. EBRC Hall, Kohima',
        validation: { maxLength: 200 },
      },
      { id: 'tr_from', key: 'from_date', type: 'DATE', label: 'From Date', validation: { required: true } },
      { id: 'tr_to', key: 'to_date', type: 'DATE', label: 'To Date', validation: { required: true } },
      {
        id: 'tr_days',
        key: 'duration_days',
        type: 'NUMBER',
        label: 'Duration (days)',
        description: 'Calculated from the dates above.',
        validation: {},
      },
    ],
    rules: [
      {
        id: 'tr_rule_days',
        kind: 'CALCULATE',
        target: 'duration_days',
        // Inclusive of both endpoints, which is how a training is counted.
        expr: {
          op: 'add',
          args: [{ op: 'daysBetween', args: [{ field: 'from_date' }, { field: 'to_date' }] }, { lit: 1 }],
        },
      },
      {
        id: 'tr_rule_order',
        kind: 'VALIDATE',
        target: 'to_date',
        message: 'The end date cannot be before the start date.',
        expr: { op: 'lt', args: [{ field: 'to_date' }, { field: 'from_date' }] },
      },
    ],
  });

  // ── 5. Section B — School Monitoring (ATTACHES) ──────────────────────────
  const monitoringForm = await publishForm({
    organizationId: org.id,
    createdById: member.userId,
    subjectTypeId: subjectType.id,
    subjectRole: 'ATTACHES',
    slug: 'ng-school-monitoring',
    title: 'Section B — School Monitoring Details',
    description: 'One entry per school visit. Submit once for each school you visited.',
    pages: [
      { pageNumber: 1, title: 'School and visit', description: '' },
      { pageNumber: 2, title: 'Monitoring checklist', description: '' },
      { pageNumber: 3, title: 'APAAR / Aadhaar and SDP', description: '' },
    ],
    knownChoiceLists,
    questions: [
      // ── Page 1 ──
      // The cascade is repeated here rather than read from Section A: a
      // question can only be filtered by another question on the SAME form.
      // Cross-step filtering is Phase B.
      {
        id: 'sm_state',
        key: 'state',
        type: 'DROPDOWN',
        label: 'State',
        pageNumber: 1,
        validation: { required: true },
        defaultValue: 'NL',
        optionsSource: { kind: 'CHOICE_LIST', listSlug: 'in-states', searchable: true },
      },
      {
        id: 'sm_district',
        key: 'district',
        type: 'DROPDOWN',
        label: 'District',
        pageNumber: 1,
        validation: { required: true },
        optionsSource: {
          kind: 'CHOICE_LIST',
          listSlug: 'in-districts',
          parentQuestionKey: 'state',
          searchable: true,
        },
      },
      {
        id: 'sm_block',
        key: 'block',
        type: 'DROPDOWN',
        label: 'Block',
        pageNumber: 1,
        validation: { required: true },
        optionsSource: {
          kind: 'CHOICE_LIST',
          listSlug: 'ng-blocks',
          parentQuestionKey: 'district',
        },
      },
      {
        id: 'sm_school',
        key: 'school_name',
        type: 'DROPDOWN',
        label: 'School Name',
        pageNumber: 1,
        validation: { required: true },
        optionsSource: {
          kind: 'CHOICE_LIST',
          listSlug: 'ng-schools',
          parentQuestionKey: 'block',
          searchable: true,
        },
      },
      {
        id: 'sm_udise',
        key: 'udise_code',
        type: 'SHORT_TEXT',
        label: 'UDISE Code',
        description: 'Filled in automatically from the school you select.',
        pageNumber: 1,
        validation: {},
      },
      {
        id: 'sm_date',
        key: 'date_of_visit',
        type: 'DATE',
        label: 'Date of Visit',
        pageNumber: 1,
        defaultValue: TODAY,
        validation: { required: true },
      },
      {
        id: 'sm_purpose',
        key: 'purpose_of_visit',
        type: 'LONG_TEXT',
        label: 'Purpose of Visit',
        pageNumber: 1,
        validation: { required: true, maxLength: 500 },
      },

      // ── Page 2 — the Yes/No/NA checklist, as one matrix ──
      {
        id: 'sm_checklist',
        key: 'monitoring_checklist',
        type: 'MATRIX',
        label: 'Monitoring Checklist',
        description: 'Mark each item Yes, No, or Not Applicable.',
        pageNumber: 2,
        validation: { required: true },
        matrixRows: MONITORING_CHECKLIST,
        matrixColumns: ['Yes', 'No', 'NA'],
      },

      // ── Page 3 — APAAR / Aadhaar ──
      {
        id: 'sm_header_apaar',
        key: 'apaar_header',
        type: 'SECTION_HEADER',
        label: '8. APAAR / Aadhaar Status',
        pageNumber: 3,
      },
      {
        id: 'sm_enrolment',
        key: 'total_enrollment',
        type: 'NUMBER',
        label: '8.1 Total Enrollment (School)',
        pageNumber: 3,
        defaultValue: 0,
        validation: { required: true, min: 0, max: 100000 },
      },
      {
        id: 'sm_aadhaar',
        key: 'students_with_aadhaar',
        type: 'NUMBER',
        label: '8.2 No. of Students Having Aadhaar',
        pageNumber: 3,
        defaultValue: 0,
        validation: { required: true, min: 0, max: 100000 },
      },
      {
        id: 'sm_aadhaar_validated',
        key: 'students_validated_aadhaar',
        type: 'NUMBER',
        label: '8.3 No. of Students Having Validated Aadhaar',
        pageNumber: 3,
        defaultValue: 0,
        validation: { required: true, min: 0, max: 100000 },
      },
      {
        id: 'sm_apaar',
        key: 'students_validated_apaar',
        type: 'NUMBER',
        label: '8.4 No. of Students Having Validated APAAR ID',
        pageNumber: 3,
        defaultValue: 0,
        validation: { required: true, min: 0, max: 100000 },
      },
      {
        id: 'sm_apaar_pct',
        key: 'apaar_coverage_percent',
        type: 'NUMBER',
        label: 'APAAR coverage (%)',
        description: 'Calculated from enrolment and validated APAAR IDs.',
        pageNumber: 3,
        validation: {},
      },

      // ── Page 3 — SDP ──
      {
        id: 'sm_header_sdp',
        key: 'sdp_header',
        type: 'SECTION_HEADER',
        label: '9. SDP Orientation Details',
        pageNumber: 3,
      },
      {
        id: 'sm_sdp_oriented',
        key: 'sdp_oriented',
        type: 'SINGLE_CHOICE',
        label: '9.1 Has the school been oriented about the SDP?',
        pageNumber: 3,
        validation: { required: true },
        options: options(['Yes', 'No']),
      },
      {
        id: 'sm_sdp_date',
        key: 'sdp_orientation_date',
        type: 'DATE',
        label: '9.2 Date of Latest Orientation',
        pageNumber: 3,
        validation: {},
      },
      {
        id: 'sm_sdp_mode',
        key: 'sdp_orientation_mode',
        type: 'DROPDOWN',
        label: '9.3 Mode of Orientation',
        pageNumber: 3,
        validation: {},
        options: options(['In person', 'Online', 'Hybrid']),
      },
      {
        id: 'sm_sdp_submitted',
        key: 'sdp_submitted_to_ebrc',
        type: 'DROPDOWN',
        label: 'SDP completed and submitted to EBRC?',
        pageNumber: 3,
        validation: {},
        options: options(['Yes', 'No', 'NA']),
      },
      {
        id: 'sm_remarks',
        key: 'remarks',
        type: 'LONG_TEXT',
        label: 'Remarks',
        pageNumber: 3,
        validation: { maxLength: 1000 },
      },
    ],
    rules: [
      // The auto-filled UDISE code — the headline capability.
      {
        id: 'sm_rule_udise',
        kind: 'CALCULATE',
        target: 'udise_code',
        expr: {
          op: 'lookup',
          args: [{ lit: 'ng-schools' }, { field: 'school_name' }, { lit: 'udise_code' }],
        },
      },
      {
        id: 'sm_rule_apaar_pct',
        kind: 'CALCULATE',
        target: 'apaar_coverage_percent',
        expr: {
          op: 'round',
          args: [
            {
              op: 'mul',
              args: [
                {
                  op: 'div',
                  args: [{ field: 'students_validated_apaar' }, { field: 'total_enrollment' }],
                },
                { lit: 100 },
              ],
            },
            { lit: 1 },
          ],
        },
      },

      // The cross-field numeric constraints implied by 8.1–8.4.
      {
        id: 'sm_rule_aadhaar_lte_enrolment',
        kind: 'VALIDATE',
        target: 'students_with_aadhaar',
        message: 'Students having Aadhaar cannot exceed total enrolment.',
        expr: { op: 'gt', args: [{ field: 'students_with_aadhaar' }, { field: 'total_enrollment' }] },
      },
      {
        id: 'sm_rule_validated_lte_aadhaar',
        kind: 'VALIDATE',
        target: 'students_validated_aadhaar',
        message: 'Validated Aadhaar cannot exceed the number of students having Aadhaar.',
        expr: {
          op: 'gt',
          args: [{ field: 'students_validated_aadhaar' }, { field: 'students_with_aadhaar' }],
        },
      },
      {
        id: 'sm_rule_apaar_lte_enrolment',
        kind: 'VALIDATE',
        target: 'students_validated_apaar',
        message: 'Validated APAAR IDs cannot exceed total enrolment.',
        expr: {
          op: 'gt',
          args: [{ field: 'students_validated_apaar' }, { field: 'total_enrollment' }],
        },
      },
      {
        id: 'sm_rule_visit_not_future',
        kind: 'VALIDATE',
        target: 'date_of_visit',
        message: 'The date of visit cannot be in the future.',
        expr: { op: 'gt', args: [{ field: 'date_of_visit' }, { op: 'today', args: [] }] },
      },

      // 9.2, 9.3 and the SDP question appear only when 9.1 is Yes — and become
      // required at the same moment.
      {
        id: 'sm_rule_show_date',
        kind: 'SHOW',
        target: 'sdp_orientation_date',
        expr: { op: 'eq', args: [{ field: 'sdp_oriented' }, { lit: 'Yes' }] },
      },
      {
        id: 'sm_rule_show_mode',
        kind: 'SHOW',
        target: 'sdp_orientation_mode',
        expr: { op: 'eq', args: [{ field: 'sdp_oriented' }, { lit: 'Yes' }] },
      },
      {
        id: 'sm_rule_show_submitted',
        kind: 'SHOW',
        target: 'sdp_submitted_to_ebrc',
        expr: { op: 'eq', args: [{ field: 'sdp_oriented' }, { lit: 'Yes' }] },
      },
      {
        id: 'sm_rule_require_date',
        kind: 'REQUIRE',
        target: 'sdp_orientation_date',
        expr: { op: 'eq', args: [{ field: 'sdp_oriented' }, { lit: 'Yes' }] },
      },
      {
        id: 'sm_rule_require_mode',
        kind: 'REQUIRE',
        target: 'sdp_orientation_mode',
        expr: { op: 'eq', args: [{ field: 'sdp_oriented' }, { lit: 'Yes' }] },
      },
    ],
  });

  // ── 6. The app ───────────────────────────────────────────────────────────
  //
  // Configured BEFORE the responses, because a response is no longer a loose
  // submission: it is a session against these steps, and a session cannot be
  // written before the steps it points at exist.
  const forms = [respondentForm, trainingForm, monitoringForm];

  const appSettings = {
    name: 'Monitoring Progress Reporting System',
    description:
      'Samagra Shiksha Nagaland — field monitoring. Complete your details once, then add each training and school visit before submitting the whole report.',
    icon: '📋',
    isPublished: true,
    // The public URL. NULL would mean "not reachable from the internet".
    publicSlug: 'ng-monitoring',
    themeConfig: normalizeTheme(THEME) as any,
    branding: {
      headerTitle: 'Monitoring Progress Reporting System',
      footerText: 'Samagra Shiksha Nagaland · Nagaland Education Mission Society',
    } as any,
    // Open to anyone with the link, matching the reference form. An internal
    // registry would leave this true.
    requireAuth: false,
    allowDrafts: true,
    config: { dashboardCards: DASHBOARD_CARDS(monitoringForm.id) } as any,
  };

  const app = await prisma.formApp.upsert({
    where: { organizationId_slug: { organizationId: org.id, slug: 'ng-monitoring' } },
    update: appSettings,
    create: {
      organizationId: org.id,
      subjectTypeId: subjectType.id,
      slug: 'ng-monitoring',
      ...appSettings,
    },
    select: { id: true, slug: true, publicSlug: true },
  });

  // ── Steps ────────────────────────────────────────────────────────────────
  // This is the shape the reference form has and a `formIds` list could not
  // express: one respondent block, two optional repeatable training blocks, and
  // school visits that must be distinct from one another.
  //
  // Sessions hang off the APP, not off the steps — only entries cascade from a
  // step. Deleting steps alone would therefore strip every entry and leave the
  // sessions behind as empty shells, which is exactly what an earlier run of
  // this seed produced. Both are cleared, in that order.
  await prisma.formAppSession.deleteMany({ where: { appId: app.id } });
  await prisma.formAppStep.deleteMany({ where: { appId: app.id } });
  await prisma.formAppStep.createMany({
    data: [
      {
        appId: app.id,
        formId: respondentForm.id,
        key: 'respondent_details',
        order: 0,
        title: 'Section A — Respondent Details',
        description: 'Your details. Completed once per report.',
        icon: '🧑‍🏫',
        mode: 'SINGLE',
        minEntries: 1,
        maxEntries: 1,
        isOptional: false,
        uniqueBy: [] as any,
      },
      {
        appId: app.id,
        formId: trainingForm.id,
        key: 'trainings',
        order: 1,
        title: 'Training Programmes',
        description: 'Add one entry for each training you attended or conducted.',
        icon: '🎓',
        mode: 'REPEATABLE',
        minEntries: 0,
        maxEntries: 20,
        isOptional: true,
        uniqueBy: [] as any,
      },
      {
        appId: app.id,
        formId: monitoringForm.id,
        key: 'school_visits',
        order: 2,
        title: 'Section B — School Visit',
        description: 'Add one entry for each school you visited. Each school may appear once.',
        icon: '🏫',
        mode: 'REPEATABLE',
        minEntries: 1,
        maxEntries: 30,
        isOptional: false,
        // "Duplicate schools not allowed", declaratively.
        uniqueBy: ['school_name'] as any,
      },
    ],
  });

  const stepsByKey = new Map(
    (
      await prisma.formAppStep.findMany({
        where: { appId: app.id },
        select: { id: true, key: true },
      })
    ).map((step) => [step.key, step.id]),
  );

  // ── Reporting period ─────────────────────────────────────────────────────
  // The reference form's "Feb – May 2026 · Fixed Reporting Period" badge.
  // Widened around today so the seeded app is actually open when you open it.
  await prisma.formAppPeriod.deleteMany({ where: { appId: app.id } });
  const periodStart = new Date();
  periodStart.setUTCMonth(periodStart.getUTCMonth() - 3, 1);
  periodStart.setUTCHours(0, 0, 0, 0);
  const periodEnd = new Date();
  periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 3, 1);
  periodEnd.setUTCHours(0, 0, 0, 0);

  const period = await prisma.formAppPeriod.create({
    data: {
      appId: app.id,
      label: `${periodStart.toLocaleString('en', { month: 'short' })} – ${periodEnd.toLocaleString('en', { month: 'short' })} ${periodEnd.getUTCFullYear()}`,
      startsAt: periodStart,
      endsAt: periodEnd,
      isActive: true,
    },
    select: { id: true, label: true },
  });

  // ── 7. Responses ─────────────────────────────────────────────────────────
  //
  // Each respondent's data is written the way the app produces it: ONE session,
  // holding one respondent entry, N training entries and N visit entries, each
  // pointing at the submission it became. Seeding loose submissions instead
  // would have left the session tables empty and the reports page showing
  // nothing, while every individual row looked fine — the exact failure this
  // seed exists to catch.
  //
  // Cleared and regenerated so a re-run does not stack duplicates on top of the
  // previous batch. Scoped to these three forms only — nothing else in the
  // database is touched.
  const seededFormIds = [respondentForm.id, trainingForm.id, monitoringForm.id];
  await prisma.formSubmission.deleteMany({ where: { formId: { in: seededFormIds } } });
  await prisma.subject.deleteMany({
    where: { subjectTypeId: subjectType.id, externalId: { startsWith: 'ng-demo-' } },
  });

  const schoolMetadata = new Map(
    schoolItems.map((item) => [`ng-schools::${item.value}`, item.metadata as Record<string, unknown>]),
  );
  const blocksByDistrict = new Map<string, typeof blockItems>();
  for (const block of blockItems) {
    blocksByDistrict.set(block.parentValue, [...(blocksByDistrict.get(block.parentValue) ?? []), block]);
  }
  const schoolsByBlock = new Map<string, typeof schoolItems>();
  for (const school of schoolItems) {
    schoolsByBlock.set(school.parentValue, [...(schoolsByBlock.get(school.parentValue) ?? []), school]);
  }

  let respondentCount = 0;
  let trainingCount = 0;
  let visitCount = 0;
  let sessionCount = 0;

  /** One staged entry, waiting for the session row that will own it. */
  type SeededEntry = {
    stepKey: string;
    index: number;
    answers: Record<string, unknown>;
    formVersionId: string;
    submissionId: string;
  };

  for (const [index, person] of RESPONDENTS.entries()) {
    const entries: SeededEntry[] = [];
    const districtBlocks = blocksByDistrict.get(person.district) ?? [];
    if (districtBlocks.length === 0) continue;
    const homeBlock = pick(districtBlocks);
    const registeredDaysAgo = 90 - index * 12;

    // ── Section A: registers the Respondent ──
    const respondentAnswers = buildAnswers(
      respondentForm,
      {
        respondent_name: person.name,
        designation: person.designation,
        state: 'NL',
        district: person.district,
        block: homeBlock.value,
        is_ebrc_coordinator: person.ebrc,
      },
      schoolMetadata,
    );

    const registration = await prisma.formSubmission.create({
      data: {
        formId: respondentForm.id,
        formVersionId: respondentForm.versionId,
        organizationId: org.id,
        answers: respondentAnswers as any,
        completionTimeMs: int(45_000, 180_000),
        submittedAt: daysAgo(registeredDaysAgo),
        status: 'SUBMITTED',
      },
      select: { id: true },
    });

    const subject = await prisma.subject.create({
      data: {
        organizationId: org.id,
        subjectTypeId: subjectType.id,
        displayName: person.name,
        externalId: `ng-demo-${index + 1}`,
        attributes: {
          designation: person.designation,
          district: person.district,
          block: homeBlock.label,
        } as any,
        registrationSubmissionId: registration.id,
        createdAt: daysAgo(registeredDaysAgo),
      },
      select: { id: true },
    });

    await prisma.formSubmission.update({
      where: { id: registration.id },
      data: { subjectId: subject.id },
    });
    respondentCount += 1;

    entries.push({
      stepKey: 'respondent_details',
      index: 0,
      answers: respondentAnswers,
      formVersionId: respondentForm.versionId,
      submissionId: registration.id,
    });

    // ── Trainings: what "+ Add Training" produces ──
    for (let n = 0; n < int(1, 3); n += 1) {
      const startDaysAgo = int(10, registeredDaysAgo - 5);
      const duration = int(1, 5);
      const answers = buildAnswers(
        trainingForm,
        {
          participation: chance(0.6) ? 'Attended by me' : 'Conducted by me',
          training_name: pick(TRAINING_NAMES),
          organised_by: pick(TRAINING_ORGANISERS),
          venue: `EBRC Hall, ${homeBlock.label}`,
          from_date: isoDaysAgo(startDaysAgo),
          to_date: isoDaysAgo(startDaysAgo - (duration - 1)),
        },
        schoolMetadata,
      );

      const training = await prisma.formSubmission.create({
        data: {
          formId: trainingForm.id,
          formVersionId: trainingForm.versionId,
          organizationId: org.id,
          subjectId: subject.id,
          answers: answers as any,
          completionTimeMs: int(60_000, 240_000),
          submittedAt: daysAgo(startDaysAgo - duration),
          status: 'SUBMITTED',
        },
        select: { id: true },
      });
      entries.push({
        stepKey: 'trainings',
        index: n,
        answers,
        formVersionId: trainingForm.versionId,
        submissionId: training.id,
      });
      trainingCount += 1;
    }

    // ── School visits: what "+ Add School Visit" produces ──
    // Distinct schools per respondent, which is the reference form's
    // "Duplicate schools not allowed" enforced by construction here.
    const candidateSchools = districtBlocks.flatMap((block) => schoolsByBlock.get(block.value) ?? []);
    const visited = new Set<string>();

    for (let n = 0; n < Math.min(int(2, 4), candidateSchools.length); n += 1) {
      const school = candidateSchools.find((s) => !visited.has(s.value));
      if (!school) break;
      visited.add(school.value);

      const block = blockItems.find((b) => b.value === school.parentValue)!;

      // Kept internally consistent so the VALIDATE rules pass — which is the
      // point: if the generator produced 8.2 > 8.1, buildAnswers would throw.
      const enrolment = int(80, 620);
      const withAadhaar = Math.round(enrolment * (0.7 + rnd() * 0.28));
      const validatedAadhaar = Math.round(withAadhaar * (0.6 + rnd() * 0.35));
      const validatedApaar = Math.round(enrolment * (0.4 + rnd() * 0.45));

      const oriented = chance(0.7) ? 'Yes' : 'No';
      const visitDaysAgo = int(2, registeredDaysAgo - 2);

      const answers = buildAnswers(
        monitoringForm,
        {
          state: 'NL',
          district: person.district,
          block: block.value,
          school_name: school.value,
          date_of_visit: isoDaysAgo(visitDaysAgo),
          purpose_of_visit: pick(VISIT_PURPOSES),
          monitoring_checklist: Object.fromEntries(
            MONITORING_CHECKLIST.map((item) => [
              item,
              chance(0.62) ? 'Yes' : chance(0.5) ? 'No' : 'NA',
            ]),
          ),
          total_enrollment: enrolment,
          students_with_aadhaar: withAadhaar,
          students_validated_aadhaar: validatedAadhaar,
          students_validated_apaar: Math.min(validatedApaar, enrolment),
          sdp_oriented: oriented,
          // Only meaningful when oriented — the SHOW rules drop them otherwise,
          // which is exactly what is being demonstrated.
          sdp_orientation_date: isoDaysAgo(visitDaysAgo + int(20, 120)),
          sdp_orientation_mode: pick(['In person', 'Online', 'Hybrid']),
          sdp_submitted_to_ebrc: pick(['Yes', 'No', 'NA']),
          remarks: pick(REMARKS),
        },
        schoolMetadata,
      );

      const visit = await prisma.formSubmission.create({
        data: {
          formId: monitoringForm.id,
          formVersionId: monitoringForm.versionId,
          organizationId: org.id,
          subjectId: subject.id,
          answers: answers as any,
          completionTimeMs: int(300_000, 900_000),
          submittedAt: daysAgo(visitDaysAgo),
          status: 'SUBMITTED',
        },
        select: { id: true },
      });
      entries.push({
        stepKey: 'school_visits',
        index: n,
        answers,
        formVersionId: monitoringForm.versionId,
        submissionId: visit.id,
      });
      visitCount += 1;
    }

    // ── The session that ties the report together ──
    //
    // Written last because every entry has to name the submission it became,
    // and stamped with the open period so "reports filed this cycle" is a query
    // rather than a date range someone has to remember.
    //
    // Checked against the steps' own minimums first. The whole premise of this
    // script is that it seeds nothing the product would reject, and a report
    // with zero school visits against a step that demands one is precisely
    // that — it would sit in the database looking fine and fail the moment
    // anyone tried to file the same thing through the app.
    for (const [stepKey, minimum] of [
      ['respondent_details', 1],
      ['school_visits', 1],
    ] as const) {
      const filled = entries.filter((entry) => entry.stepKey === stepKey).length;
      if (filled < minimum) {
        throw new Error(
          `${person.name}: step "${stepKey}" needs at least ${minimum} entry but the generator produced ${filled}. ` +
            `Most likely the district "${person.district}" has no schools in DEMO_SCHOOLS.`,
        );
      }
    }

    await prisma.formAppSession.create({
      data: {
        appId: app.id,
        organizationId: org.id,
        periodId: period.id,
        subjectId: subject.id,
        status: 'SUBMITTED',
        // No user account behind the seeded reports, so they carry the same
        // anonymous fingerprint an unauthenticated respondent would.
        fingerprint: `ng-demo-${index + 1}`,
        startedAt: daysAgo(registeredDaysAgo),
        submittedAt: daysAgo(registeredDaysAgo),
        completionTimeMs: int(600_000, 2_400_000),
        entries: {
          create: entries.map((entry) => ({
            stepId: stepsByKey.get(entry.stepKey)!,
            index: entry.index,
            answers: entry.answers as any,
            formVersionId: entry.formVersionId,
            submissionId: entry.submissionId,
          })),
        },
      },
    });
    sessionCount += 1;
  }

  console.log(
    `Responses: ${respondentCount} respondents · ${trainingCount} trainings · ${visitCount} school visits`,
  );
  console.log(`           filed as ${sessionCount} submitted sessions in "${period.label}"\n`);

  // ── Verdict ──────────────────────────────────────────────────────────────
  console.log('Forms published:');
  for (const form of forms) {
    console.log(
      `  ${form.title}\n` +
        `    /f/${form.slug}  ·  v${form.version}  ·  ${form.questionCount} questions  ·  ${form.ruleCount} rules` +
        (form.calculatedKeys.length ? `\n    auto-filled: ${form.calculatedKeys.join(', ')}` : '') +
        (form.lookups.length
          ? `\n    lookups: ${form.lookups.map((l) => `${l.list}.${l.column} via ${l.field}`).join(', ')}`
          : ''),
    );
  }
  console.log(`\nApp — public:   /a/${app.publicSlug}`);
  console.log(`    internal: /apps/${app.id}`);
  console.log('    3 steps · subject type Respondent · 1 open reporting period\n');

  console.log('─'.repeat(70));
  console.log('VERDICT — reference form vs. this platform');
  console.log('─'.repeat(70));
  console.log('Expressible as configuration, and now live:');
  for (const line of [
    'District / Block / School cascading selects (3 levels)',
    'UDISE code auto-filled from the school, read-only, announced',
    'APAAR coverage % derived from two answered numbers',
    '7-item Yes/No/NA monitoring checklist (as a matrix)',
    'Cross-field numeric constraints (8.2 ≤ 8.1, 8.3 ≤ 8.2, 8.4 ≤ 8.1)',
    'Visit date cannot be in the future',
    '9.2 / 9.3 / SDP shown AND required only when 9.1 = Yes',
    'Date of Visit defaulted to today; enrolment fields defaulted to 0',
    'Purpose max 500 chars, Remarks max 1000, with live counters',
    'Government green theme, applied to the public page',
    '"+ Add Training" / "+ Add School Visit" as repeatable steps',
    '"Submit All Reports" as one transaction — all entries land or none do',
    '"Duplicate schools not allowed", as step-level uniqueBy',
    'The fixed reporting period, as an app period',
    'One public URL for the whole programme, themed and branded',
  ]) {
    console.log(`  ✓ ${line}`);
  }

  console.log('\nStill not expressible — these need more than configuration:');
  for (const line of [
    'School filtered by the Block answered in Section A.',
    '   → parentQuestionKey is same-form only, so the cascade is repeated',
    '     inside the monitoring form. Cross-step filtering needs a stepKey.',
    'Nested sub-groups and automatic 8.1 / 9.2 numbering.',
    '   → Numbers are typed into the labels here.',
  ]) {
    console.log(`  ${line.startsWith(' ') ? '' : '✗ '}${line}`);
  }
  console.log('─'.repeat(70));
}

function DASHBOARD_CARDS(monitoringFormId: string) {
  return [
    { title: 'Respondents registered', source: 'subjects' },
    { title: 'School visits (30 days)', source: 'submissions', filter: { formId: monitoringFormId, createdWithinDays: 30 } },
    { title: 'School visits (all time)', source: 'submissions', filter: { formId: monitoringFormId } },
  ];
}

main()
  .catch((error) => {
    console.error('\nSEED FAILED — the platform could not express something:\n');
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
