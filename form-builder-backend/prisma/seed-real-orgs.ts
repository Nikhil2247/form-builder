/**
 * Real data seed for Vibha.
 *
 * Wipes every table (same tables the dev seed truncates) and replaces them
 * with exactly two real organizations and their real users — nothing else.
 * There is no "team" concept yet, so an organization is the container: each
 * PMU (Program Management Unit) is its own org, and every listed user is an
 * ADMIN of their org. One additional platform SUPER_ADMIN account is created
 * with no org membership.
 *
 * ── Accounts (shared temporary password below) ──────────────────────────────
 *   superadmin@vibha.org          platform SUPER_ADMIN (no org membership)
 *
 *   Punjab PMU (punjab-pmu)
 *     mridul.dhyani@vibha.org     ADMIN
 *     dipanshu@vibha.org          ADMIN
 *     nikhil@vibha.org            ADMIN
 *
 *   Nagaland PMU (nagaland-pmu)
 *     mhasheto.vero@vibha.org     ADMIN
 *     atanu.karmakar@vibha.org    ADMIN
 *
 * Every account shares TEMP_PASSWORD below — communicate it out of band and
 * have each person change it after first login.
 *
 * ── Feature flags ────────────────────────────────────────────────────────────
 *   All flags are seeded globally-OFF so future orgs start with a blank slate.
 *   Both PMU orgs receive an explicit org-level override enabling every flag
 *   that has been shipped (FORM_APPS, FORM_RULES, AI_ASSISTANT).
 *   Flags must stay in sync with FEATURE_KEYS in feature-flags.service.ts.
 *
 * Run with: bun prisma/seed-real-orgs.ts
 * There is no dry-run mode and no confirmation prompt — it truncates every
 * table in whatever database DATABASE_URL points at as soon as it runs.
 */

import { randomUUID } from 'crypto';
import { PrismaClient, SystemRole, OrgRole } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
import 'dotenv/config';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env first.');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

const TEMP_PASSWORD = 'Vibha@Pmu2026!';

// ─────────────────────────────────────────────────────────────────────────────
// Reset — same table list/order as prisma/seed.ts
// ─────────────────────────────────────────────────────────────────────────────

async function reset() {
  await prisma.webhookDelivery.deleteMany();
  await prisma.formWebhook.deleteMany();
  await prisma.formSubmissionFile.deleteMany();
  await prisma.formSubmission.deleteMany();
  await prisma.formApp.deleteMany();
  await prisma.subject.deleteMany();
  await prisma.subjectType.deleteMany();
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
  await prisma.organizationFeatureFlag.deleteMany();
  await prisma.featureFlag.deleteMany();
  await prisma.organization.deleteMany();
  await prisma.user.deleteMany();

  console.log('  cleared all tables');
}

// ─────────────────────────────────────────────────────────────────────────────
// Data
// ─────────────────────────────────────────────────────────────────────────────

interface RealUser {
  email: string;
  firstName: string;
  lastName: string;
  /** Role within the org this user belongs to. Unused for SUPER_ADMIN. */
  role?: OrgRole;
}

interface RealOrg {
  name: string;
  slug: string;
  users: RealUser[];
}

const SUPER_ADMIN: RealUser = {
  email: 'superadmin@vibha.org',
  firstName: 'Super',
  lastName: 'Admin',
};

const ORGS: RealOrg[] = [
  {
    name: 'Punjab PMU',
    slug: 'punjab-pmu',
    users: [
      { email: 'mridul.dhyani@vibha.org', firstName: 'Mridul', lastName: 'Dhyani', role: OrgRole.ADMIN },
      { email: 'dipanshu@vibha.org', firstName: 'Dipanshu', lastName: '', role: OrgRole.ADMIN },
      { email: 'nikhil@vibha.org', firstName: 'Nikhil', lastName: 'Kumar', role: OrgRole.ADMIN },
    ],
  },
  {
    name: 'Nagaland PMU',
    slug: 'nagaland-pmu',
    users: [
      { email: 'mhasheto.vero@vibha.org', firstName: 'Mhasheto', lastName: 'Vero', role: OrgRole.ADMIN },
      { email: 'atanu.karmakar@vibha.org', firstName: 'Atanu', lastName: 'Karmakar', role: OrgRole.ADMIN },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Feature flags — keep in sync with FEATURE_KEYS in feature-flags.service.ts
// ─────────────────────────────────────────────────────────────────────────────

interface FlagDef {
  key: string;
  name: string;
  description: string;
  /** Global default. Set false so unknown orgs stay opted-out by default. */
  isEnabledGlobally: boolean;
}

/**
 * All flags the platform knows about.
 * Every org listed in ORGS gets an explicit override enabling each flag so
 * PMU staff can use every feature that has been shipped.
 */
const FEATURE_FLAGS: FlagDef[] = [
  {
    key: 'FORM_APPS',
    name: 'Form Apps',
    description:
      'Enables the Form App builder — a bundled data-entry surface that links'
      + ' a subject type (patient, household, school) to a sequence of forms,'
      + ' supporting registration, follow-up visits, and longitudinal records.',
    isEnabledGlobally: false,
  },
  {
    key: 'FORM_RULES',
    name: 'Form Rules & Conditional Logic',
    description:
      'Enables the visual rules / conditional-logic editor inside the form'
      + ' builder: skip-logic, show/hide, jump-to-page, and calculation fields.',
    isEnabledGlobally: false,
  },
  {
    key: 'AI_ASSISTANT',
    name: 'AI Assistant',
    description:
      'Enables the AI-powered assistant panel (org insights, help guide,'
      + ' idea suggestions). Requires a valid ANTHROPIC_API_KEY in env.',
    isEnabledGlobally: false,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Seed
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Seeding real Vibha orgs and users…');
  await reset();

  const passwordHash = await argon2.hash(TEMP_PASSWORD);

  // ── Super admin ────────────────────────────────────────────────────────────
  await prisma.user.create({
    data: {
      id: randomUUID(),
      email: SUPER_ADMIN.email,
      passwordHash,
      firstName: SUPER_ADMIN.firstName,
      lastName: SUPER_ADMIN.lastName,
      systemRole: SystemRole.SUPER_ADMIN,
      emailVerified: true,
    },
  });
  console.log(`  1 super admin (${SUPER_ADMIN.email})`);

  // ── Feature flags (global definitions) ────────────────────────────────────
  await prisma.featureFlag.createMany({
    data: FEATURE_FLAGS.map((f) => ({
      key: f.key,
      name: f.name,
      description: f.description,
      isEnabledGlobally: f.isEnabledGlobally,
    })),
    skipDuplicates: true,
  });
  console.log(`  ${FEATURE_FLAGS.length} feature flag(s) seeded (all globally OFF by default)`);

  // ── Orgs + their users ──────────────────────────────────────────────────────
  for (const org of ORGS) {
    const orgId = randomUUID();

    await prisma.organization.create({
      data: {
        id: orgId,
        name: org.name,
        slug: org.slug,
      },
    });

    const members: { userId: string; role: OrgRole }[] = [];
    for (const user of org.users) {
      const created = await prisma.user.create({
        data: {
          id: randomUUID(),
          email: user.email,
          passwordHash,
          firstName: user.firstName,
          lastName: user.lastName,
          systemRole: SystemRole.USER,
          emailVerified: true,
          lastActiveOrganizationId: orgId,
        },
      });
      members.push({ userId: created.id, role: user.role ?? OrgRole.ADMIN });
    }

    await prisma.organizationMember.createMany({
      data: members.map(({ userId, role }) => ({
        id: randomUUID(),
        organizationId: orgId,
        userId,
        role,
        invitedById: null,
      })),
    });

    // ── Per-org feature-flag overrides (enable everything for real PMU orgs) ──
    await prisma.organizationFeatureFlag.createMany({
      data: FEATURE_FLAGS.map((f) => ({
        organizationId: orgId,
        flagKey: f.key,
        isEnabled: true, // opt every shipped feature in for real orgs
      })),
      skipDuplicates: true,
    });

    const roleSummary = members
      .map(({ role }, index) => `${org.users[index].email.split('@')[0]}:${role}`)
      .join(', ');
    const flagSummary = FEATURE_FLAGS.map((f) => f.key).join(', ');
    console.log(`  ${org.name} (${org.slug}) — ${members.length} member(s) — ${roleSummary}`);
    console.log(`    └─ flags enabled: ${flagSummary}`);
  }

  console.log('\nDone. Every account\'s password is:', TEMP_PASSWORD);
  console.log('Share it out of band and have each person change it after first login.\n');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
