/**
 * Development seed.
 *
 * Goal: every screen in the app has enough realistic data to be judged — lists
 * that page (the platform default is 12 rows), charts with a real 90-day shape,
 * every form status including trash, every invitation and submission status,
 * webhooks that have both succeeded and failed, and quota bars that are
 * partially full rather than empty.
 *
 * Design notes:
 *
 *  • IDEMPOTENT BY RESET. The previous seed mixed `upsert` with bare `create`,
 *    so a second run duplicated comments, analytics, and webhooks, then died on
 *    the unique constraint for the invitation token. This version truncates
 *    first, so `db:seed` is repeatable and the dataset is always exactly what
 *    this file describes. It refuses to run against production.
 *
 *  • DETERMINISTIC. A seeded PRNG replaces Math.random, so two runs produce the
 *    same numbers and you can compare screenshots between them.
 *
 *  • BULK INSERTS WITH EXPLICIT IDs. The database may be remote; a few thousand
 *    round-trips is minutes of waiting. Rows are generated in memory with
 *    pre-assigned UUIDs and written with `createMany`, which keeps the whole
 *    seed to a few dozen statements while still letting child rows reference
 *    their parents.
 *
 *  • ONE PASSWORD HASH. argon2 is intentionally slow (~100ms). Hashing once and
 *    reusing the string keeps the seed fast; every account shares the password
 *    below.
 *
 * ── Accounts (password for all: Password123!) ──────────────────────────────
 *   superadmin@formbuilder.test   platform SUPER_ADMIN (no org membership)
 *   admin@acme.test               Acme — ADMIN     (MFA enabled)
 *   editor@acme.test              Acme — EDITOR
 *   viewer@acme.test              Acme — VIEWER
 *   admin@northwind.test          Northwind — ADMIN
 *   admin@initech.test            Initech — ADMIN   (near-empty org)
 *   admin@globex.test             Globex — ADMIN    (SUSPENDED org)
 */

import { randomUUID } from 'crypto';
import {
  PrismaClient,
  SystemRole,
  OrgRole,
  FormStatus,
  InviteStatus,
  FileUploadStatus,
  StorageProvider,
  SubmissionStatus,
} from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
import 'dotenv/config';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env first.');
}

// Prisma 7 removed the Rust engine, so a driver adapter is mandatory —
// `new PrismaClient()` with no options now throws at construction.
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

const SEED_PASSWORD = 'Password123!';
const FORM_PASSWORD = 'secret123';

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic helpers
// ─────────────────────────────────────────────────────────────────────────────

/** mulberry32 — small, fast, seeded PRNG. Same seed, same dataset, every run. */
function makeRandom(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = makeRandom(20260807);

const int = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const pick = <T,>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];
const chance = (probability: number) => rand() < probability;

const NOW = new Date();
const daysAgo = (days: number, hour = 12) => {
  const date = new Date(NOW);
  date.setDate(date.getDate() - days);
  date.setHours(hour, int(0, 59), int(0, 59), 0);
  return date;
};
/** UTC midnight, matching the `@db.Date` column FormAnalytics uses. */
const dateOnly = (days: number) => {
  const date = new Date(NOW);
  date.setUTCDate(date.getUTCDate() - days);
  date.setUTCHours(0, 0, 0, 0);
  return date;
};

const FIRST_NAMES = [
  'Priya', 'Marcus', 'Yuki', 'Amara', 'Tomas', 'Lena', 'Idris', 'Sofia',
  'Kwame', 'Hana', 'Diego', 'Noor', 'Ellis', 'Ravi', 'Maja', 'Omar',
  'Freya', 'Chen', 'Zara', 'Anders',
];
const LAST_NAMES = [
  'Sharma', 'Okafor', 'Tanaka', 'Nowak', 'Silva', 'Bergman', 'Haddad', 'Rossi',
  'Mensah', 'Kim', 'Moreau', 'Farah', 'Doyle', 'Patel', 'Kovac', 'Aziz',
  'Lindqvist', 'Wei', 'Ahmed', 'Larsen',
];

// ─────────────────────────────────────────────────────────────────────────────
// Form definitions
// ─────────────────────────────────────────────────────────────────────────────

const THEME = {
  preset: 'slate',
  primaryColor: '#18181b',
  backgroundColor: '#ffffff',
  cardColor: '#ffffff',
  textColor: '#18181b',
  fontFamily: 'Inter',
  borderRadius: 'md',
  cardVariant: 'card',
};

const STANDARD_PAGES = [
  { pageNumber: 1, title: 'About you', description: 'So we know who we are hearing from.' },
  { pageNumber: 2, title: 'Your feedback', description: '' },
];

/** The everyday feedback form most seeded forms use. */
const STANDARD_QUESTIONS = [
  { id: 'q_name', type: 'SHORT_TEXT', label: 'Your name', pageNumber: 1, validation: { required: true, maxLength: 80 } },
  { id: 'q_email', type: 'EMAIL', label: 'Email address', pageNumber: 1, validation: { required: true } },
  {
    id: 'q_role', type: 'DROPDOWN', label: 'What best describes you?', pageNumber: 1,
    validation: { required: true },
    options: [
      { id: 'o_cust', label: 'Customer', value: 'customer' },
      { id: 'o_partner', label: 'Partner', value: 'partner' },
      { id: 'o_staff', label: 'Employee', value: 'employee' },
    ],
  },
  { id: 'q_rating', type: 'STAR_RATING', label: 'How would you rate us overall?', pageNumber: 2, validation: { required: true } },
  { id: 'q_nps', type: 'NPS', label: 'How likely are you to recommend us?', pageNumber: 2, validation: { required: true } },
  { id: 'q_comments', type: 'LONG_TEXT', label: 'Anything else you would like to tell us?', pageNumber: 2, validation: { required: false, maxLength: 2000 } },
];

/**
 * Exercises every question type the builder and runner support, so the field
 * palette, the preview, the response grid, and the detail dialog can all be
 * checked against real stored answers.
 */
const KITCHEN_SINK_QUESTIONS = [
  { id: 'k_section_1', type: 'SECTION_HEADER', label: 'Contact details', placeholder: 'We only use these to follow up.', pageNumber: 1, validation: {} },
  { id: 'k_short', type: 'SHORT_TEXT', label: 'Full name', pageNumber: 1, validation: { required: true, minLength: 2, maxLength: 80 } },
  { id: 'k_long', type: 'LONG_TEXT', label: 'Describe your use case', pageNumber: 1, validation: { required: false, maxLength: 1000 } },
  { id: 'k_email', type: 'EMAIL', label: 'Work email', pageNumber: 1, validation: { required: true } },
  { id: 'k_phone', type: 'PHONE', label: 'Phone number', pageNumber: 1, validation: { required: false } },
  { id: 'k_url', type: 'URL', label: 'Company website', pageNumber: 1, validation: { required: false } },
  { id: 'k_number', type: 'NUMBER', label: 'Team size', pageNumber: 1, validation: { required: true, min: 1, max: 100000 } },
  { id: 'k_section_2', type: 'SECTION_HEADER', label: 'Your preferences', pageNumber: 2, validation: {} },
  {
    id: 'k_single', type: 'SINGLE_CHOICE', label: 'Preferred plan', pageNumber: 2,
    validation: { required: true },
    options: [
      { id: 'k_s1', label: 'Starter', value: 'starter' },
      { id: 'k_s2', label: 'Growth', value: 'growth' },
      { id: 'k_s3', label: 'Enterprise', value: 'enterprise' },
    ],
  },
  {
    id: 'k_multi', type: 'MULTI_CHOICE', label: 'Which features matter to you?', pageNumber: 2,
    validation: { required: false },
    options: [
      { id: 'k_m1', label: 'Conditional logic', value: 'logic' },
      { id: 'k_m2', label: 'Webhooks', value: 'webhooks' },
      { id: 'k_m3', label: 'File uploads', value: 'uploads' },
      { id: 'k_m4', label: 'Analytics', value: 'analytics' },
    ],
  },
  {
    id: 'k_dropdown', type: 'DROPDOWN', label: 'Where are you based?', pageNumber: 2,
    validation: { required: true },
    options: [
      { id: 'k_d1', label: 'Europe', value: 'eu' },
      { id: 'k_d2', label: 'North America', value: 'na' },
      { id: 'k_d3', label: 'Asia Pacific', value: 'apac' },
      { id: 'k_d4', label: 'Other', value: 'other' },
    ],
  },
  { id: 'k_stars', type: 'STAR_RATING', label: 'Rate your onboarding', pageNumber: 2, validation: { required: false } },
  { id: 'k_nps', type: 'NPS', label: 'How likely are you to recommend us?', pageNumber: 2, validation: { required: true } },
  { id: 'k_slider', type: 'SLIDER', label: 'Monthly budget (USD)', pageNumber: 2, validation: { required: false }, sliderMin: 0, sliderMax: 5000, sliderStep: 100 },
  { id: 'k_section_3', type: 'SECTION_HEADER', label: 'Finishing up', pageNumber: 3, validation: {} },
  { id: 'k_date', type: 'DATE', label: 'When would you like to start?', pageNumber: 3, validation: { required: false } },
  {
    id: 'k_matrix', type: 'MATRIX', label: 'Rate the following', pageNumber: 3,
    validation: { required: false },
    matrixRows: ['Ease of use', 'Performance', 'Support'],
    matrixColumns: ['Poor', 'Fair', 'Good', 'Excellent'],
  },
  { id: 'k_file', type: 'FILE_UPLOAD', label: 'Attach a requirements document', pageNumber: 3, validation: { required: false, allowedTypes: ['application/pdf', 'image/png'], maxSizeMb: 10 } },
  { id: 'k_signature', type: 'SIGNATURE', label: 'Sign to confirm', pageNumber: 3, validation: { required: false } },
];

const KITCHEN_SINK_PAGES = [
  { pageNumber: 1, title: 'Contact', description: 'Tell us how to reach you.' },
  { pageNumber: 2, title: 'Preferences', description: '' },
  { pageNumber: 3, title: 'Details', description: 'Almost done.' },
];

/** Conditional logic, so the Logic view has something real to render. */
const KITCHEN_SINK_LOGIC = [
  {
    id: 'logic_enterprise',
    triggerQuestionId: 'k_single',
    operator: 'EQUALS',
    value: 'enterprise',
    action: 'SHOW',
    targetQuestionId: 'k_number',
  },
  {
    id: 'logic_detractor',
    triggerQuestionId: 'k_nps',
    operator: 'LESS_THAN',
    value: '7',
    action: 'SHOW',
    targetQuestionId: 'k_long',
  },
];

/** Scored questions, so quiz grading and the score column have real values. */
const QUIZ_QUESTIONS = [
  {
    id: 'z_q1', type: 'SINGLE_CHOICE', label: 'Which HTTP status means "Created"?', pageNumber: 1,
    validation: { required: true }, points: 10,
    options: [
      { id: 'z_q1_a', label: '200', value: '200' },
      { id: 'z_q1_b', label: '201', value: '201', isCorrect: true },
      { id: 'z_q1_c', label: '204', value: '204' },
      { id: 'z_q1_d', label: '301', value: '301' },
    ],
  },
  {
    id: 'z_q2', type: 'SINGLE_CHOICE', label: 'Which is NOT a valid SQL join?', pageNumber: 1,
    validation: { required: true }, points: 10,
    options: [
      { id: 'z_q2_a', label: 'INNER', value: 'inner' },
      { id: 'z_q2_b', label: 'LEFT OUTER', value: 'left_outer' },
      { id: 'z_q2_c', label: 'SIDEWAYS', value: 'sideways', isCorrect: true },
      { id: 'z_q2_d', label: 'FULL OUTER', value: 'full_outer' },
    ],
  },
  {
    id: 'z_q3', type: 'MULTI_CHOICE', label: 'Which of these are NoSQL databases?', pageNumber: 1,
    validation: { required: true }, points: 20,
    options: [
      { id: 'z_q3_a', label: 'MongoDB', value: 'mongodb', isCorrect: true },
      { id: 'z_q3_b', label: 'PostgreSQL', value: 'postgres' },
      { id: 'z_q3_c', label: 'Redis', value: 'redis', isCorrect: true },
      { id: 'z_q3_d', label: 'MySQL', value: 'mysql' },
    ],
  },
  {
    id: 'z_q4', type: 'SHORT_TEXT', label: 'What does CORS stand for?', pageNumber: 1,
    validation: { required: true }, points: 10,
    correctAnswer: 'Cross-Origin Resource Sharing',
  },
];

const QUIZ_MAX_SCORE = QUIZ_QUESTIONS.reduce((sum, q) => sum + (q.points ?? 0), 0);

// ─────────────────────────────────────────────────────────────────────────────
// Answer generation
// ─────────────────────────────────────────────────────────────────────────────

function standardAnswers(name: string, email: string) {
  return {
    q_name: name,
    q_email: email,
    q_role: pick(['customer', 'partner', 'employee']),
    q_rating: int(1, 5),
    q_nps: int(0, 10),
    q_comments: chance(0.55)
      ? pick([
          'The builder is quick once you know where things are.',
          'Would love a way to duplicate a whole page of questions.',
          'Support got back to me within the hour. No complaints.',
          'Exports are useful but I would like scheduled delivery.',
          'The conditional logic saved us building three separate forms.',
        ])
      : '',
  };
}

function kitchenSinkAnswers(name: string, email: string) {
  const answers: Record<string, unknown> = {
    k_short: name,
    k_email: email,
    k_number: int(1, 2500),
    k_single: pick(['starter', 'growth', 'enterprise']),
    k_dropdown: pick(['eu', 'na', 'apac', 'other']),
    k_nps: int(0, 10),
  };

  if (chance(0.7)) answers.k_long = 'We collect supplier onboarding data across four regions.';
  if (chance(0.6)) answers.k_phone = `+44 7700 ${int(100000, 999999)}`;
  if (chance(0.5)) answers.k_url = pick(['https://example.com', 'https://acme.test', 'https://northwind.test']);
  if (chance(0.65)) {
    // Multi-select stores an array of option values.
    answers.k_multi = ['logic', 'webhooks', 'uploads', 'analytics'].filter(() => chance(0.45));
  }
  if (chance(0.7)) answers.k_stars = int(1, 5);
  if (chance(0.55)) answers.k_slider = int(0, 50) * 100;
  if (chance(0.4)) answers.k_date = daysAgo(-int(7, 120)).toISOString().slice(0, 10);
  if (chance(0.45)) {
    // Matrix answers are stored as { rowLabel: columnValue }.
    answers.k_matrix = {
      'Ease of use': pick(['Poor', 'Fair', 'Good', 'Excellent']),
      Performance: pick(['Fair', 'Good', 'Excellent']),
      Support: pick(['Good', 'Excellent']),
    };
  }
  // A 1x1 transparent PNG — enough for the detail dialog to render an <img>.
  if (chance(0.25)) {
    answers.k_signature =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  }
  return answers;
}

/** Returns the answers plus the score they earn, mirroring the worker's grading. */
function quizAnswers() {
  const q1 = chance(0.7) ? '201' : pick(['200', '204', '301']);
  const q2 = chance(0.6) ? 'sideways' : pick(['inner', 'left_outer', 'full_outer']);
  const q3 = chance(0.45)
    ? ['mongodb', 'redis']
    : pick([['mongodb'], ['mongodb', 'postgres'], ['redis', 'mysql']]);
  const q4 = chance(0.5) ? 'Cross-Origin Resource Sharing' : 'Cross Origin Request System';

  let score = 0;
  if (q1 === '201') score += 10;
  if (q2 === 'sideways') score += 10;
  // Multi-choice is all-or-nothing: the exact correct set.
  if (q3.length === 2 && q3.includes('mongodb') && q3.includes('redis')) score += 20;
  if (q4.toLowerCase() === 'cross-origin resource sharing') score += 10;

  return { answers: { z_q1: q1, z_q2: q2, z_q3: q3, z_q4: q4 }, score };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reset
// ─────────────────────────────────────────────────────────────────────────────

async function reset() {
  if (process.env.NODE_ENV === 'production' || process.env.ALLOW_SEED === 'false') {
    throw new Error(
      'Refusing to seed: this truncates every table. Unset NODE_ENV=production to run it.',
    );
  }

  // Child-to-parent order. Most relations cascade, but deleting explicitly makes
  // the order obvious and survives a future relation losing its onDelete rule.
  await prisma.webhookDelivery.deleteMany();
  await prisma.formWebhook.deleteMany();
  await prisma.formSubmissionFile.deleteMany();
  await prisma.formSubmission.deleteMany();
  await prisma.formAnalytics.deleteMany();
  await prisma.formVersion.deleteMany();
  await prisma.formDraft.deleteMany();
  await prisma.formComment.deleteMany();
  await prisma.integrationConfig.deleteMany();
  await prisma.form.deleteMany();
  await prisma.formTemplate.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.organizationInvitation.deleteMany();
  await prisma.organizationMember.deleteMany();
  await prisma.apiKey.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.mfaRecoveryCode.deleteMany();
  await prisma.emailVerificationToken.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.organization.deleteMany();
  await prisma.user.deleteMany();

  console.log('  cleared all tables');
}

// ─────────────────────────────────────────────────────────────────────────────
// Seed
// ─────────────────────────────────────────────────────────────────────────────

interface SeedOrg {
  id: string;
  name: string;
  slug: string;
  adminId: string;
  memberIds: string[];
  suspended: boolean;
  formCount: number;
}

async function main() {
  console.log('Seeding…');
  await reset();

  const passwordHash = await argon2.hash(SEED_PASSWORD);
  const formPasswordHash = await argon2.hash(FORM_PASSWORD);

  // ── Users ────────────────────────────────────────────────────────────────
  const users: any[] = [];
  const addUser = (
    email: string,
    firstName: string,
    lastName: string,
    overrides: Record<string, unknown> = {},
  ) => {
    const user = {
      id: randomUUID(),
      email,
      passwordHash,
      firstName,
      lastName,
      systemRole: SystemRole.USER,
      emailVerified: true,
      createdAt: daysAgo(int(40, 400)),
      ...overrides,
    };
    users.push(user);
    return user;
  };

  const superAdmin = addUser('superadmin@formbuilder.test', 'Ada', 'Reyes', {
    systemRole: SystemRole.SUPER_ADMIN,
    createdAt: daysAgo(420),
  });

  const orgBlueprints = [
    { name: 'Acme Corp', slug: 'acme-corp', domain: 'acme', members: 16, forms: 22, suspended: false },
    { name: 'Northwind Traders', slug: 'northwind', domain: 'northwind', members: 7, forms: 9, suspended: false },
    // Deliberately near-empty, so every empty state can be seen with real data
    // elsewhere in the same deployment.
    { name: 'Initech', slug: 'initech', domain: 'initech', members: 2, forms: 1, suspended: false },
    { name: 'Globex', slug: 'globex', domain: 'globex', members: 4, forms: 3, suspended: true },
  ];

  const orgs: SeedOrg[] = [];

  for (const blueprint of orgBlueprints) {
    const admin = addUser(
      `admin@${blueprint.domain}.test`,
      FIRST_NAMES[orgs.length],
      LAST_NAMES[orgs.length],
      // The Acme admin has MFA on, so the security screen has both states to show.
      blueprint.domain === 'acme'
        ? { mfaEnabled: true, mfaSecret: 'v1.seeded.placeholder.not-a-real-secret' }
        : {},
    );

    const memberIds = [admin.id];

    if (blueprint.domain === 'acme') {
      memberIds.push(addUser('editor@acme.test', 'Marcus', 'Okafor').id);
      memberIds.push(addUser('viewer@acme.test', 'Yuki', 'Tanaka').id);
    }

    // Fill out the roster. Acme crosses the 12-row page boundary on purpose.
    while (memberIds.length < blueprint.members) {
      const index = memberIds.length;
      const first = FIRST_NAMES[(index * 3 + orgs.length) % FIRST_NAMES.length];
      const last = LAST_NAMES[(index * 5 + orgs.length) % LAST_NAMES.length];
      memberIds.push(
        addUser(
          `${first.toLowerCase()}.${last.toLowerCase()}@${blueprint.domain}.test`,
          first,
          last,
          // A couple of unverified accounts, so that column is not uniformly true.
          { emailVerified: !chance(0.15) },
        ).id,
      );
    }

    orgs.push({
      id: randomUUID(),
      name: blueprint.name,
      slug: blueprint.slug,
      adminId: admin.id,
      memberIds,
      suspended: blueprint.suspended,
      formCount: blueprint.forms,
    });
  }

  await prisma.user.createMany({ data: users });
  console.log(`  ${users.length} users`);

  // ── Organizations ────────────────────────────────────────────────────────
  await prisma.organization.createMany({
    data: orgs.map((org, index) => ({
      id: org.id,
      name: org.name,
      slug: org.slug,
      maxForms: [100, 50, 25, 50][index],
      maxSubmissionsMonth: [10000, 5000, 1000, 5000][index],
      maxMembers: [50, 25, 10, 25][index],
      storageQuotaBytes: BigInt(5 * 1024 ** 3),
      // Partial usage, so the quota bars on the billing page are neither empty
      // nor full — one org is deliberately over 75% to show the warning colour.
      // BigInt() rejects a non-integer, and GB * 1024^3 lands on a fraction for
      // any non-whole GB figure — round before converting.
      storageUsedBytes: BigInt(Math.round([1.6, 0.4, 0.01, 4.1][index] * 1024 ** 3)),
      isActive: !org.suspended,
      suspendedAt: org.suspended ? daysAgo(11) : null,
      suspendReason: org.suspended
        ? 'Payment failed three times. Suspended pending billing update.'
        : null,
      createdAt: daysAgo(400 - index * 60),
    })),
  });

  // ── Memberships ──────────────────────────────────────────────────────────
  // A user belongs to exactly one organization: OrganizationMember carries
  // @@unique([userId]). Multi-org membership is a separate piece of work.
  const memberships = orgs.flatMap((org) =>
    org.memberIds.map((userId, index) => ({
      id: randomUUID(),
      organizationId: org.id,
      userId,
      role:
        index === 0
          ? OrgRole.ADMIN
          : index === 1
            ? OrgRole.EDITOR
            : index <= 3
              ? OrgRole.EDITOR
              : chance(0.3)
                ? OrgRole.ADMIN
                : OrgRole.VIEWER,
      joinedAt: daysAgo(int(5, 380)),
      invitedById: index === 0 ? null : org.adminId,
    })),
  );
  await prisma.organizationMember.createMany({ data: memberships });
  console.log(`  ${memberships.length} memberships across ${orgs.length} organizations`);

  // ── Invitations — every status ───────────────────────────────────────────
  const invitations = orgs.flatMap((org) => {
    const statuses: InviteStatus[] = [
      InviteStatus.PENDING,
      InviteStatus.PENDING,
      InviteStatus.PENDING,
      InviteStatus.ACCEPTED,
      InviteStatus.EXPIRED,
      InviteStatus.REVOKED,
    ];
    // Only Acme gets the full spread; the rest get a couple.
    const count = org.slug === 'acme-corp' ? statuses.length : 2;

    return statuses.slice(0, count).map((status, index) => {
      const expired = status === InviteStatus.EXPIRED;
      return {
        id: randomUUID(),
        organizationId: org.id,
        email: `invitee${index + 1}@${org.slug}.test`,
        role: pick([OrgRole.VIEWER, OrgRole.EDITOR, OrgRole.ADMIN]),
        token: randomUUID().replace(/-/g, ''),
        status,
        invitedById: org.adminId,
        expiresAt: expired ? daysAgo(3) : daysAgo(-7),
        acceptedAt: status === InviteStatus.ACCEPTED ? daysAgo(int(1, 20)) : null,
        createdAt: daysAgo(int(1, 30)),
      };
    });
  });
  await prisma.organizationInvitation.createMany({ data: invitations });
  console.log(`  ${invitations.length} invitations`);

  // ── Templates — enough categories for the filter to be worth using ───────
  const templateCategories = ['Survey', 'Feedback', 'Registration', 'HR', 'Support', 'Marketing'];
  const templates = [
    ['Customer satisfaction survey', 'Survey', 'Measure CSAT with a rating and an open comment.'],
    ['Net promoter score', 'Survey', 'A single NPS question with an optional reason.'],
    ['Product feedback', 'Feedback', 'Collect structured feedback on a release.'],
    ['Bug report', 'Support', 'Steps to reproduce, severity, and an attachment.'],
    ['Support request', 'Support', 'Triage inbound requests by category and urgency.'],
    ['Event registration', 'Registration', 'Attendee details, dietary needs, and sessions.'],
    ['Workshop signup', 'Registration', 'Capacity-limited signup with a waitlist question.'],
    ['Job application', 'HR', 'Candidate details, CV upload, and availability.'],
    ['Employee onboarding', 'HR', 'Everything a new starter needs to provide on day one.'],
    ['Exit interview', 'HR', 'Structured questions for departing team members.'],
    ['Newsletter signup', 'Marketing', 'Email plus topic preferences.'],
    ['Lead qualification', 'Marketing', 'Budget, authority, need, and timeline.'],
    ['Contact us', 'Feedback', 'A simple name, email, and message form.'],
    ['Course evaluation', 'Survey', 'Matrix ratings across teaching and materials.'],
  ].map(([name, category, description], index) => ({
    id: randomUUID(),
    name,
    description,
    category,
    formData: {
      pages: STANDARD_PAGES,
      questions: STANDARD_QUESTIONS,
      logic: [],
      theme: THEME,
    },
    isPublic: true,
    // A spread of usage counts so the "most used" ordering is visible.
    usageCount: [312, 268, 190, 154, 141, 128, 96, 84, 71, 55, 44, 31, 22, 9][index],
    createdAt: daysAgo(int(60, 300)),
  }));
  await prisma.formTemplate.createMany({ data: templates });
  console.log(`  ${templates.length} templates across ${templateCategories.length} categories`);

  // ── Forms ────────────────────────────────────────────────────────────────
  interface SeedForm {
    id: string;
    orgId: string;
    slug: string;
    title: string;
    status: FormStatus;
    isQuizMode: boolean;
    deleted: boolean;
    versionId: string | null;
    questions: any[];
    createdById: string;
    submissionTarget: number;
  }

  const forms: SeedForm[] = [];
  const formRows: any[] = [];
  const versionRows: any[] = [];

  const buildForm = (
    org: SeedOrg,
    options: {
      title: string;
      slug: string;
      status: FormStatus;
      questions?: any[];
      pages?: any[];
      logic?: any[];
      isQuizMode?: boolean;
      deleted?: boolean;
      passwordProtected?: boolean;
      requireAuth?: boolean;
      expiresAt?: Date | null;
      maxSubmissions?: number | null;
      submissionTarget?: number;
      description?: string;
      createdDaysAgo?: number;
    },
  ) => {
    const id = randomUUID();
    const questions = options.questions ?? STANDARD_QUESTIONS;
    const createdAt = daysAgo(options.createdDaysAgo ?? int(30, 200));
    // Published forms get an immutable version — without one the public page
    // 404s and the ingest worker has no schema to bind answers to.
    const published = options.status === FormStatus.PUBLISHED || options.status === FormStatus.CLOSED;
    const versionId = published ? randomUUID() : null;
    const creatorId = pick(org.memberIds.slice(0, 3));

    formRows.push({
      id,
      organizationId: org.id,
      createdById: creatorId,
      slug: options.slug,
      title: options.title,
      description: options.description ?? null,
      status: options.status,
      layoutMode: 'DOCUMENT',
      isQuizMode: options.isQuizMode ?? false,
      isPasswordProtected: options.passwordProtected ?? false,
      passwordHash: options.passwordProtected ? formPasswordHash : null,
      requireAuth: options.requireAuth ?? false,
      allowMultiple: true,
      maxSubmissions: options.maxSubmissions ?? null,
      expiresAt: options.expiresAt ?? null,
      currentVersion: published ? 1 : 1,
      themeConfig: THEME,
      pagesJson: options.pages ?? STANDARD_PAGES,
      questionsJson: questions,
      logicJson: options.logic ?? [],
      notifyEmails: chance(0.3) ? [`admin@${org.slug}.test`] : null,
      deletedAt: options.deleted ? daysAgo(int(1, 25)) : null,
      createdAt,
      updatedAt: daysAgo(int(0, 20)),
    });

    if (versionId) {
      versionRows.push({
        id: versionId,
        formId: id,
        version: 1,
        pagesJson: options.pages ?? STANDARD_PAGES,
        questionsJson: questions,
        logicJson: options.logic ?? [],
        themeJson: THEME,
        publishedAt: createdAt,
      });
    }

    forms.push({
      id,
      orgId: org.id,
      slug: options.slug,
      title: options.title,
      status: options.status,
      isQuizMode: options.isQuizMode ?? false,
      deleted: options.deleted ?? false,
      versionId,
      questions,
      createdById: creatorId,
      submissionTarget: options.submissionTarget ?? 0,
    });
  };

  const acme = orgs[0];

  // Flagship forms — the ones worth opening. Each exercises a different feature.
  buildForm(acme, {
    title: 'Product feedback 2026',
    slug: 'product-feedback-2026',
    description: 'How our customers are finding the new release.',
    status: FormStatus.PUBLISHED,
    questions: KITCHEN_SINK_QUESTIONS,
    pages: KITCHEN_SINK_PAGES,
    logic: KITCHEN_SINK_LOGIC,
    // Comfortably past the 12-row page size, so pagination is exercised.
    submissionTarget: 94,
    createdDaysAgo: 120,
  });

  buildForm(acme, {
    title: 'Engineering knowledge check',
    slug: 'engineering-knowledge-check',
    description: 'Scored assessment for new engineering hires.',
    status: FormStatus.PUBLISHED,
    questions: QUIZ_QUESTIONS,
    pages: [{ pageNumber: 1, title: 'Questions', description: '' }],
    isQuizMode: true,
    submissionTarget: 41,
    createdDaysAgo: 75,
  });

  buildForm(acme, {
    title: 'Customer satisfaction survey',
    slug: 'customer-satisfaction-survey',
    description: 'Quarterly CSAT run.',
    status: FormStatus.PUBLISHED,
    submissionTarget: 57,
    createdDaysAgo: 150,
  });

  buildForm(acme, {
    title: 'Internal security review',
    slug: 'internal-security-review',
    description: 'Password protected — use "secret123" to open the public page.',
    status: FormStatus.PUBLISHED,
    passwordProtected: true,
    submissionTarget: 14,
    createdDaysAgo: 45,
  });

  buildForm(acme, {
    title: 'Employee pulse (staff only)',
    slug: 'employee-pulse',
    description: 'Requires the respondent to be signed in.',
    status: FormStatus.PUBLISHED,
    requireAuth: true,
    submissionTarget: 22,
    createdDaysAgo: 60,
  });

  buildForm(acme, {
    title: 'Summer conference registration',
    slug: 'summer-conference-registration',
    description: 'Closed after reaching its cap.',
    status: FormStatus.CLOSED,
    maxSubmissions: 30,
    submissionTarget: 30,
    createdDaysAgo: 220,
  });

  buildForm(acme, {
    title: 'Beta programme applications',
    slug: 'beta-programme-applications',
    description: 'Expired last week — the public page should refuse new responses.',
    status: FormStatus.PUBLISHED,
    expiresAt: daysAgo(6),
    submissionTarget: 18,
    createdDaysAgo: 90,
  });

  buildForm(acme, {
    title: 'Website redesign brief',
    slug: 'website-redesign-brief',
    description: 'Still being written.',
    status: FormStatus.DRAFT,
    createdDaysAgo: 12,
  });

  buildForm(acme, {
    title: 'Supplier onboarding (2025)',
    slug: 'supplier-onboarding-2025',
    description: 'Archived at the end of last year.',
    status: FormStatus.ARCHIVED,
    submissionTarget: 0,
    createdDaysAgo: 330,
  });

  // Trash, so the trash page is not empty.
  buildForm(acme, {
    title: 'Old contact form',
    slug: 'old-contact-form',
    status: FormStatus.DRAFT,
    deleted: true,
    createdDaysAgo: 200,
  });
  buildForm(acme, {
    title: 'Duplicate of CSAT survey',
    slug: 'duplicate-csat-survey',
    status: FormStatus.DRAFT,
    deleted: true,
    createdDaysAgo: 88,
  });

  // Filler, so the forms list itself pages.
  const FILLER_TITLES = [
    'Onboarding checklist', 'Feature request intake', 'Partner application',
    'Training feedback', 'Incident report', 'Expense claim', 'Office move survey',
    'Accessibility audit', 'Vendor questionnaire', 'Hackathon signup',
    'Volunteer registration',
  ];
  let fillerIndex = 0;
  while (forms.filter((f) => f.orgId === acme.id).length < acme.formCount) {
    const title = `${FILLER_TITLES[fillerIndex % FILLER_TITLES.length]}${
      fillerIndex >= FILLER_TITLES.length ? ` ${Math.floor(fillerIndex / FILLER_TITLES.length) + 1}` : ''
    }`;
    const status = chance(0.7) ? FormStatus.PUBLISHED : FormStatus.DRAFT;
    buildForm(acme, {
      title,
      slug: `acme-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      status,
      submissionTarget: status === FormStatus.PUBLISHED ? int(0, 25) : 0,
    });
    fillerIndex += 1;
  }

  // Other organizations.
  for (const org of orgs.slice(1)) {
    for (let index = 0; index < org.formCount; index += 1) {
      const status =
        index === 0 ? FormStatus.PUBLISHED : chance(0.65) ? FormStatus.PUBLISHED : FormStatus.DRAFT;
      buildForm(org, {
        title: `${pick(FILLER_TITLES)} ${index + 1}`,
        slug: `${org.slug}-form-${index + 1}`,
        description: chance(0.6) ? 'Collected through the public link.' : undefined,
        status,
        submissionTarget: status === FormStatus.PUBLISHED ? int(3, 40) : 0,
      });
    }
  }

  await prisma.form.createMany({ data: formRows });
  await prisma.formVersion.createMany({ data: versionRows });
  console.log(`  ${formRows.length} forms (${versionRows.length} published versions)`);

  // ── Submissions ──────────────────────────────────────────────────────────
  const submissionRows: any[] = [];
  /** Per form, per UTC day: [count, summedCompletionMs] — feeds the analytics rows. */
  const dailyTotals = new Map<string, Map<string, { count: number; totalMs: number }>>();

  for (const form of forms) {
    if (!form.versionId || form.submissionTarget === 0) continue;
    dailyTotals.set(form.id, new Map());

    for (let index = 0; index < form.submissionTarget; index += 1) {
      const first = pick(FIRST_NAMES);
      const last = pick(LAST_NAMES);
      const name = `${first} ${last}`;
      const email = `${first.toLowerCase()}.${last.toLowerCase()}${index}@example.test`;

      // Weighted toward recent days, so the chart trends rather than sitting flat.
      const dayOffset = Math.floor(Math.pow(rand(), 1.7) * 89);
      const submittedAt = daysAgo(dayOffset, int(8, 21));
      const completionTimeMs = int(35_000, 420_000);

      // A realistic mix, so the status filter and badge colours are exercised.
      const status = chance(0.94)
        ? SubmissionStatus.SUBMITTED
        : chance(0.6)
          ? SubmissionStatus.FLAGGED_SPAM
          : SubmissionStatus.REJECTED;

      let answers: Record<string, unknown>;
      let quizScore: number | null = null;
      let maxQuizScore: number | null = null;
      let isPassed: boolean | null = null;

      if (form.isQuizMode) {
        const result = quizAnswers();
        answers = result.answers;
        quizScore = result.score;
        maxQuizScore = QUIZ_MAX_SCORE;
        isPassed = result.score >= QUIZ_MAX_SCORE * 0.6;
      } else if (form.questions === KITCHEN_SINK_QUESTIONS) {
        answers = kitchenSinkAnswers(name, email);
      } else {
        answers = standardAnswers(name, email);
      }

      const id = randomUUID();
      submissionRows.push({
        id,
        formId: form.id,
        formVersionId: form.versionId,
        // Roughly a fifth are signed-in members rather than anonymous.
        respondentId: chance(0.2) ? pick(orgs[0].memberIds) : null,
        country: pick(['GB', 'US', 'DE', 'IN', 'JP', 'BR', 'FR', 'AU']),
        completionTimeMs,
        quizScore,
        maxQuizScore,
        isPassed,
        answers,
        status,
        submittedAt,
        processedAt: new Date(submittedAt.getTime() + int(200, 4000)),
      });

      // Only successful submissions count toward analytics, matching the worker.
      if (status === SubmissionStatus.SUBMITTED) {
        const key = dateOnly(dayOffset).toISOString();
        const byDay = dailyTotals.get(form.id)!;
        const entry = byDay.get(key) ?? { count: 0, totalMs: 0 };
        entry.count += 1;
        entry.totalMs += completionTimeMs;
        byDay.set(key, entry);
      }
    }
  }

  // Chunked: a single createMany with thousands of rows can exceed the
  // parameter limit on the wire.
  for (let i = 0; i < submissionRows.length; i += 500) {
    await prisma.formSubmission.createMany({ data: submissionRows.slice(i, i + 500) });
  }
  console.log(`  ${submissionRows.length} submissions`);

  // ── Analytics — 90 daily rows per published form ─────────────────────────
  const analyticsRows: any[] = [];

  for (const form of forms) {
    if (!form.versionId) continue;
    const byDay = dailyTotals.get(form.id) ?? new Map();

    for (let dayOffset = 0; dayOffset < 90; dayOffset += 1) {
      const date = dateOnly(dayOffset);
      const entry = byDay.get(date.toISOString());
      const submissions = entry?.count ?? 0;

      // Views and starts must exceed submissions or the completion rate exceeds
      // 100%. Funnel: views → starts (~55%) → submissions.
      const starts = submissions > 0 ? submissions + int(0, Math.ceil(submissions * 0.8)) : int(0, 3);
      const views = starts > 0 ? starts + int(1, Math.ceil(starts * 1.4) + 2) : int(0, 6);

      // Skip days with no activity at all — the API returns sparse rows and the
      // chart fills the gaps, so seeding zeroes everywhere would hide that path.
      if (submissions === 0 && starts === 0 && views === 0) continue;

      analyticsRows.push({
        id: randomUUID(),
        formId: form.id,
        date,
        views,
        starts,
        submissions,
        sumCompletionMs: BigInt(entry?.totalMs ?? 0),
        // Derived, exactly as the worker maintains it.
        avgCompletionMs: submissions > 0 ? Math.round((entry?.totalMs ?? 0) / submissions) : 0,
      });
    }
  }

  for (let i = 0; i < analyticsRows.length; i += 500) {
    await prisma.formAnalytics.createMany({ data: analyticsRows.slice(i, i + 500) });
  }
  console.log(`  ${analyticsRows.length} daily analytics rows`);

  // ── Uploaded files — one per status ──────────────────────────────────────
  const kitchenSinkForm = forms.find((f) => f.slug === 'product-feedback-2026')!;
  const kitchenSinkSubmissions = submissionRows.filter((s) => s.formId === kitchenSinkForm.id);

  const fileRows = kitchenSinkSubmissions.slice(0, 24).map((submission, index) => {
    const status =
      index % 8 === 0
        ? FileUploadStatus.PENDING_UPLOAD
        : index % 11 === 0
          ? FileUploadStatus.QUARANTINED
          : FileUploadStatus.VERIFIED;

    const name = pick(['requirements.pdf', 'diagram.png', 'brief.pdf', 'screenshot.png']);
    return {
      id: randomUUID(),
      submissionId: submission.id,
      questionId: 'k_file',
      provider: StorageProvider.MINIO,
      bucket: 'form-uploads',
      objectKey: `${kitchenSinkForm.orgId}/${kitchenSinkForm.id}/${submission.id}/${randomUUID()}/${name}`,
      originalName: name,
      mimeType: name.endsWith('.pdf') ? 'application/pdf' : 'image/png',
      sizeBytes: BigInt(int(48_000, 4_800_000)),
      status,
      issuedAt: submission.submittedAt,
      verifiedAt: status === FileUploadStatus.VERIFIED ? submission.processedAt : null,
      quarantineReason:
        status === FileUploadStatus.QUARANTINED
          ? 'Declared image/png but the object begins with an HTML doctype.'
          : null,
    };
  });
  await prisma.formSubmissionFile.createMany({ data: fileRows });
  console.log(`  ${fileRows.length} uploaded files`);

  // ── Webhooks and deliveries ──────────────────────────────────────────────
  const webhookRows: any[] = [];
  const deliveryRows: any[] = [];

  for (const form of forms.filter((f) => f.versionId && f.submissionTarget > 8).slice(0, 6)) {
    const healthy = {
      id: randomUUID(),
      formId: form.id,
      url: 'https://hooks.example.test/forms/inbound',
      secret: 'v1.seeded.placeholder.rotate-me',
      name: 'Data warehouse sync',
      isActive: true,
      createdAt: daysAgo(int(30, 120)),
    };
    webhookRows.push(healthy);

    // One deactivated hook, so the "Deactivated" state is visible in the UI —
    // delivery turns this off after repeated failures or a blocked address.
    if (form.slug === 'product-feedback-2026') {
      webhookRows.push({
        id: randomUUID(),
        formId: form.id,
        url: 'https://legacy.example.test/webhook',
        secret: 'v1.seeded.placeholder.rotate-me',
        name: 'Legacy CRM (disabled)',
        isActive: false,
        createdAt: daysAgo(160),
      });
    }

    for (const submission of submissionRows.filter((s) => s.formId === form.id).slice(0, 20)) {
      const success = chance(0.85);
      deliveryRows.push({
        id: randomUUID(),
        webhookId: healthy.id,
        submissionId: submission.id,
        statusCode: success ? 200 : pick([500, 502, 504, null]),
        responseBody: success ? '{"ok":true}' : 'Upstream timed out after 10000ms',
        attempt: success ? 1 : int(2, 4),
        success,
        deliveredAt: new Date(submission.submittedAt.getTime() + int(500, 9000)),
      });
    }
  }

  await prisma.formWebhook.createMany({ data: webhookRows });
  await prisma.webhookDelivery.createMany({ data: deliveryRows });
  console.log(`  ${webhookRows.length} webhooks, ${deliveryRows.length} deliveries`);

  // ── Drafts, comments, integrations, API keys ─────────────────────────────
  await prisma.formDraft.createMany({
    data: forms
      .filter((f) => f.status === FormStatus.PUBLISHED)
      .slice(0, 8)
      .map((form, index) => ({
        id: randomUUID(),
        formId: form.id,
        fingerprint: `seed-fingerprint-${index}`,
        answers: { q_name: 'Partially filled', q_email: '' },
        lastFieldId: 'q_email',
        progress: int(15, 85),
      })),
  });

  await prisma.formComment.createMany({
    data: forms.slice(0, 12).flatMap((form) =>
      Array.from({ length: int(1, 3) }, () => ({
        id: randomUUID(),
        formId: form.id,
        userId: pick(orgs[0].memberIds),
        content: pick([
          'Can we make the email field optional for internal use?',
          'Approved — publishing this on Monday.',
          'The NPS question should come after the rating, not before.',
          'Added the logic rule we discussed in standup.',
        ]),
        resolved: chance(0.4),
        createdAt: daysAgo(int(1, 40)),
      })),
    ),
  });

  await prisma.integrationConfig.createMany({
    data: orgs.slice(0, 2).map((org) => ({
      id: randomUUID(),
      organizationId: org.id,
      formId: null,
      provider: pick(['airtable', 'notion', 'slack']),
      credentials: { note: 'seeded placeholder — not a real credential' },
      syncRules: { mapping: { q_name: 'Name', q_email: 'Email' } },
      isActive: true,
    })),
  });

  await prisma.apiKey.createMany({
    data: orgs.slice(0, 3).map((org, index) => ({
      id: randomUUID(),
      userId: org.adminId,
      organizationId: org.id,
      name: pick(['CI export job', 'Zapier integration', 'Reporting script']),
      keyHash: randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, ''),
      scopes: 'forms:read,submissions:read',
      lastUsedAt: index === 0 ? daysAgo(2) : null,
      createdAt: daysAgo(int(20, 200)),
    })),
  });

  // ── MFA recovery codes for the Acme admin ────────────────────────────────
  await prisma.mfaRecoveryCode.createMany({
    data: Array.from({ length: 10 }, (_, index) => ({
      id: randomUUID(),
      userId: acme.adminId,
      codeHash: `seeded-placeholder-hash-${index}`,
      // Two already spent, so the "codes remaining" count is not a round number.
      usedAt: index < 2 ? daysAgo(int(5, 40)) : null,
    })),
  });

  // ── Notifications ────────────────────────────────────────────────────────
  await prisma.notification.createMany({
    data: orgs.flatMap((org) =>
      Array.from({ length: 6 }, (_, index) => ({
        id: randomUUID(),
        userId: org.adminId,
        type: pick(['submission', 'member', 'system', 'webhook']),
        title: pick([
          'New response received',
          'A team member accepted their invitation',
          'Webhook delivery failed',
          'Monthly submission quota is 80% used',
        ]),
        body: 'Seeded notification for testing the notifications surface.',
        isRead: index > 2,
        createdAt: daysAgo(int(0, 30)),
      })),
    ),
  });

  // ── Audit log — varied, plentiful, and paginated ─────────────────────────
  const AUDIT_ACTIONS: Array<[string, string]> = [
    ['form.created', 'form'],
    ['form.updated', 'form'],
    ['form.published', 'form'],
    ['form.deleted', 'form'],
    ['form.restored', 'form'],
    ['submission.exported', 'submission'],
    ['submission.deleted', 'submission'],
    ['member.invited', 'member'],
    ['member.role_changed', 'member'],
    ['member.removed', 'member'],
    ['webhook.created', 'webhook'],
    ['webhook.secret_rotated', 'webhook'],
    ['org.updated', 'organization'],
    ['auth.login_failed', 'auth'],
    ['auth.mfa_enabled', 'auth'],
  ];

  const auditRows = orgs.flatMap((org) => {
    // Acme gets a deep history so the audit page pages properly.
    const count = org.slug === 'acme-corp' ? 220 : 30;
    return Array.from({ length: count }, () => {
      const [action, resource] = pick(AUDIT_ACTIONS);
      return {
        id: randomUUID(),
        organizationId: org.id,
        // Some entries have no actor — background jobs and the system itself.
        userId: chance(0.9) ? pick(org.memberIds) : null,
        action,
        resource,
        resourceId: randomUUID(),
        metadata: { source: pick(['web', 'api', 'worker']), note: `Seeded ${action} entry` },
        ipAddress: `${int(1, 223)}.${int(0, 255)}.${int(0, 255)}.${int(1, 254)}`,
        createdAt: daysAgo(int(0, 180), int(0, 23)),
      };
    });
  });

  for (let i = 0; i < auditRows.length; i += 500) {
    await prisma.auditLog.createMany({ data: auditRows.slice(i, i + 500) });
  }
  console.log(`  ${auditRows.length} audit log entries`);

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log('\nDone.\n');
  console.log(`  Password for every account: ${SEED_PASSWORD}`);
  console.log(`  Password for the protected form: ${FORM_PASSWORD}\n`);
  console.log('  superadmin@formbuilder.test   platform admin (no organization)');
  console.log('  admin@acme.test               Acme — Admin, MFA enabled');
  console.log('  editor@acme.test              Acme — Editor');
  console.log('  viewer@acme.test              Acme — Viewer (read-only)');
  console.log('  admin@northwind.test          Northwind — Admin');
  console.log('  admin@initech.test            Initech — Admin (near-empty org)');
  console.log('  admin@globex.test             Globex — Admin (SUSPENDED org)\n');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
