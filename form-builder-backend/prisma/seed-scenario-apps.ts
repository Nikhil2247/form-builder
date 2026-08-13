/**
 * Five form apps, five unrelated scenarios.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   bun prisma/seed-scenario-apps.ts            seed
 *   bun prisma/seed-scenario-apps.ts --check    validate only, no database
 *
 * `seed-nagaland-app.ts` rebuilds ONE real government form to answer "can the
 * platform express this?". This script answers a different question: does the
 * app model hold up across scenarios that have nothing to do with each other?
 * A shape that only ever fits monitoring reports is not a product.
 *
 * So each of the five is deliberately configured AGAINST the others:
 *
 *   antenatal care     private, resumable, longitudinal — visits accumulate on
 *                      one mother across a quarter, and a later form reads the
 *                      registration's height and booking weight
 *   kharif survey      field data entry — cascading crop lists with per-crop
 *                      economics looked up out of the list itself, and a plot
 *                      checked against the farm's own registered acreage
 *   campus hiring      public intake, quiz scoring, and a gated internal step;
 *                      three forms with three different access settings
 *   cold chain audit   internal-only (no public URL), NOT resumable, and the
 *                      only one with a history of closed reporting periods
 *   grievances         anonymous, single sitting, no period at all — a ticket
 *                      arrives when it arrives
 *
 * Between them they exercise: SINGLE and REPEATABLE steps, `uniqueBy`,
 * `showWhen` gating on both an answered and a CALCULATED value, transitive
 * calculations, cross-form `ref`s, choice-list `lookup`s, two- and three-level
 * cascades, conditional SHOW/REQUIRE, cross-field VALIDATE, quiz mode, password
 * protection, submission caps, expiry, and notification recipients.
 *
 * ── The rule that makes this honest ────────────────────────────────────────
 * Every form goes through the SAME `normalizeFormStructure` and `compileRules`
 * the API runs on save and publish, and every seeded answer goes through
 * `runFormRules` before it is stored. Nothing is written straight to JSONB.
 * A form the product would reject fails here instead of being seeded, and a
 * response that violates its own form's rules is an error, not a row.
 *
 * That is what `--check` is for: it runs the whole validation pass — structure,
 * rules, and every sample response — with no database at all. Use it after
 * editing a scenario; a broken rule is a stack trace in a second rather than a
 * failed migration.
 *
 * Idempotent: re-running upserts the same apps, forms, steps and periods, and
 * regenerates the sessions. Scoped strictly to what it creates — no other form,
 * app or organization in the database is read or touched.
 *
 * Requires `db:seed` (an organization with members) and `db:seed:choices`
 * (in-states / in-districts) to have run first.
 */

import 'dotenv/config';
import { randomUUID } from 'node:crypto';

import {
  compileRules,
  lookupKey,
  planLookupRequests,
  readPlan,
  refKey,
  resolveLookupBag,
  runFormRules,
  type ExprNode,
  type FormRule,
  type RuleValue,
} from '../src/common/rules';
import { normalizeFormStructure, normalizeTheme } from '../src/modules/forms/form-structure';
// The real helpers, not a copy. Seeded submissions have to carry exactly the
// occurrence keys and dates the submit path would have written, or the demo
// data disagrees with the code that reads it.
import {
  occurredAtFor,
  occurrenceKeyFor,
} from '../src/modules/form-apps/step-scope';

const CHECK_ONLY = process.argv.includes('--check');

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options whose stored VALUE is the label.
 *
 * Rules compare against stored values, so `eq(status, 'Closed')` only works if
 * picking "Closed" stores the string `Closed`. Slugifying the value instead
 * would make every rule in this file read `'closed'` while the export column
 * read `Closed` — the two drift apart the moment anybody renames an option and
 * updates only the one they can see.
 */
function choices(labels: string[]) {
  return labels.map((label) => ({
    id: `opt_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`,
    label,
    value: label,
  }));
}

const YES_NO = () => choices(['Yes', 'No']);

const DAY_MS = 86_400_000;
const at = (days: number) => new Date(Date.now() + days * DAY_MS);
const iso = (days: number) => at(days).toISOString().slice(0, 10);
const TODAY = iso(0);

/** Start of the month `n` months from now, UTC. */
function monthStart(offset: number): Date {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + offset);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

const MONTH_LABEL = (d: Date) =>
  `${d.toLocaleString('en', { month: 'long', timeZone: 'UTC' })} ${d.getUTCFullYear()}`;

// ─────────────────────────────────────────────────────────────────────────────
// Scenario shapes
// ─────────────────────────────────────────────────────────────────────────────

interface ScenarioChoiceList {
  slug: string;
  name: string;
  description: string;
  /** Slug of the list this one cascades from, if any. */
  parentSlug?: string;
  metadataSchema: Array<{ key: string; label: string; type: string }>;
  items: Array<{
    value: string;
    label: string;
    parentValue?: string;
    metadata?: Record<string, unknown>;
  }>;
}

/**
 * Form-level settings — every one of these is a real column on `Form` that the
 * builder can set. Spread across the five scenarios rather than piled onto one,
 * so each appears in a context where it is the natural choice.
 */
interface FormSettings {
  layoutMode?: 'DOCUMENT' | 'CONVERSATIONAL' | 'GRID' | 'PORTAL';
  isQuizMode?: boolean;
  requireAuth?: boolean;
  allowMultiple?: boolean;
  maxSubmissions?: number;
  /** Days from now. Negative closes the form. */
  expiresInDays?: number;
  notifyEmails?: string[];
  /** Plaintext; argon2-hashed on the way in, exactly as `createForm` does. */
  password?: string;
}

interface ScenarioForm {
  slug: string;
  title: string;
  description: string;
  role: 'REGISTERS' | 'ATTACHES';
  settings?: FormSettings;
  pages: Array<{ pageNumber: number; title: string; description?: string }>;
  questions: any[];
  /**
   * `ref.form` is written as `@other-form-slug` and resolved to that form's id
   * once it is published. An author picks a form in the UI and the id goes in;
   * here the id does not exist until the run reaches it.
   */
  rules: FormRule[];
}

interface ScenarioStep {
  key: string;
  formSlug: string;
  title: string;
  description: string;
  icon: string;
  mode: 'SINGLE' | 'REPEATABLE';
  /**
   * Where the entry count is measured. Omitted means SESSION — one sitting —
   * which is the platform default and what every scenario written before
   * longitudinal recording assumed.
   */
  scope?: 'SESSION' | 'SUBJECT' | 'SUBJECT_PERIOD';
  minEntries: number;
  maxEntries: number | null;
  isOptional: boolean;
  uniqueBy: string[];
  /** Question key holding the real-world date of an entry. */
  occurredAtKey?: string;
  /**
   * When the step becomes due, relative to an anchor. Advisory only — an
   * overdue step is still fillable, and one not yet due can be filled early.
   */
  schedule?: {
    /** `REGISTRATION`, or the key of the step whose latest entry anchors it. */
    anchor?: string;
    offsets: Array<{ days?: number; weeks?: number; months?: number }>;
    graceDays?: number;
  };
  /** ExprNode over EARLIER steps, addressed `stepKey.questionKey`. */
  showWhen?: ExprNode;
}

interface ScenarioSession {
  fingerprint: string;
  /** How long ago the session was filed. */
  daysAgo: number;
  entries: Array<{ stepKey: string; answers: Record<string, RuleValue> }>;
}

interface Scenario {
  key: string;
  headline: string;
  subjectType: {
    slug: string;
    name: string;
    icon: string;
    identityConfig: Record<string, unknown>;
  };
  app: {
    slug: string;
    /** NULL means the app has no public URL and is reachable only from inside. */
    publicSlug: string | null;
    name: string;
    description: string;
    icon: string;
    theme: Record<string, unknown>;
    branding: Record<string, unknown>;
    requireAuth: boolean;
    allowDrafts: boolean;
    isPublished: boolean;
    /**
     * How every step's fields are arranged. `INHERIT` defers to each step
     * form's own `layoutMode`, which is the only setting under which a
     * question's HALF/FULL width is honoured inside an app.
     */
    layoutMode?: 'DOCUMENT' | 'GRID' | 'INHERIT';
    /**
     * How the app's reporting windows come into being. Omitted means FIXED
     * when the scenario lists periods and NONE when it does not, which is what
     * every scenario written before recurring cycles assumed.
     */
    periodMode?: 'NONE' | 'FIXED' | 'RECURRING';
    /** Read only under RECURRING. Cadence, anchor, grace and backfill. */
    periodConfig?: {
      cadence: 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
      anchor?: string;
      graceDays?: number;
      backfillPeriods?: number;
    };
    dashboardCards: (formId: (slug: string) => string) => unknown[];
  };
  choiceLists: ScenarioChoiceList[];
  /** Every list slug a rule or an options source in this scenario may name. */
  knownChoiceLists: string[];
  forms: ScenarioForm[];
  steps: ScenarioStep[];
  periods: Array<{ label: string; startsAt: Date; endsAt: Date; isActive: boolean }>;
  sessions: ScenarioSession[];
}

// ═════════════════════════════════════════════════════════════════════════════
// SCENARIO 1 — Antenatal care programme
//
// Longitudinal clinical follow-up. The point of interest is that a visit form
// reads the REGISTRATION submission for height and booking weight, so BMI and
// weight gain are derived rather than re-asked — the mother is measured once.
// ═════════════════════════════════════════════════════════════════════════════

const ANTENATAL: Scenario = {
  key: 'antenatal',
  headline: 'Antenatal care — private, resumable, longitudinal',
  subjectType: {
    slug: 'expectant-mother',
    name: 'Expectant Mother',
    icon: '🤰',
    identityConfig: {
      displayName: ['mother_name'],
      attributes: ['age', 'district', 'phone', 'expected_delivery_date'],
      externalId: 'mcp_number',
    },
  },
  app: {
    slug: 'anc-programme',
    publicSlug: 'anc-programme',
    name: 'Antenatal Care Programme',
    description:
      'Register an expectant mother once, then record each antenatal visit. High-risk referrals open automatically when a visit flags one.',
    icon: '🤰',
    theme: {
      preset: 'emerald',
      primaryColor: '#0f766e',
      backgroundColor: '#f0fdf4',
      cardColor: '#ffffff',
      textColor: '#0f2e28',
      fontFamily: 'Inter',
      borderRadius: 'lg',
      cardVariant: 'elevated',
      // Appearance: registration, then visits, then referrals — a sequence a
      // health worker walks through once per mother, so it is paged rather
      // than scrolled and the progress bar says how much is left.
      appShell: 'wizard',
      appMasthead: 'gradient',
      appStepStyle: 'timeline',
      appDensity: 'comfortable',
      appTexture: 'none',
    },
    branding: {
      headerTitle: 'Antenatal Care Programme',
      footerText: 'District Health Society · Maternal and Child Health',
    },
    // Clinical records about an identified person. Closed by default and left
    // closed; the public slug exists so staff have a stable URL, not so the
    // link can be handed out.
    requireAuth: true,
    // A visit is recorded at the bedside and interrupted constantly.
    allowDrafts: true,
    isPublished: true,
    dashboardCards: (formId) => [
      { title: 'Mothers registered', source: 'subjects' },
      { title: 'Registered this month', source: 'subjects', filter: { createdWithinDays: 30 } },
      {
        title: 'Visits this month',
        source: 'submissions',
        filter: { formId: formId('anc-visit'), createdWithinDays: 30 },
      },
      {
        title: 'Referrals (all time)',
        source: 'submissions',
        filter: { formId: formId('anc-high-risk-referral') },
      },
    ],
  },
  choiceLists: [],
  knownChoiceLists: ['in-states', 'in-districts'],
  forms: [
    {
      slug: 'anc-registration',
      title: 'ANC Registration',
      description:
        'Completed once, when the mother books. Age and expected delivery date are derived; a guardian contact appears only for a minor.',
      role: 'REGISTERS',
      settings: { requireAuth: true, allowMultiple: true },
      pages: [
        { pageNumber: 1, title: 'Mother', description: 'Identity and clinical baseline.' },
        { pageNumber: 2, title: 'Location and contact' },
      ],
      questions: [
        {
          id: 'anc_r_name',
          key: 'mother_name',
          type: 'SHORT_TEXT',
          label: "Mother's full name",
          pageNumber: 1,
          validation: { required: true, maxLength: 120 },
        },
        {
          id: 'anc_r_mcp',
          key: 'mcp_number',
          type: 'SHORT_TEXT',
          label: 'MCP card number',
          description: 'Format MCP-000000. This is the record key, so it cannot repeat.',
          placeholder: 'MCP-104512',
          pageNumber: 1,
          validation: { required: true, pattern: '^MCP-[0-9]{6}$' },
        },
        {
          id: 'anc_r_dob',
          key: 'date_of_birth',
          type: 'DATE',
          label: 'Date of birth',
          pageNumber: 1,
          validation: { required: true },
        },
        {
          id: 'anc_r_age',
          key: 'age',
          type: 'NUMBER',
          label: 'Age (years)',
          description: 'Calculated from the date of birth.',
          pageNumber: 1,
          validation: {},
        },
        {
          id: 'anc_r_height',
          key: 'height_cm',
          type: 'NUMBER',
          label: 'Height (cm)',
          description: 'Measured once at booking; later visits derive BMI from it.',
          pageNumber: 1,
          validation: { required: true, min: 120, max: 210 },
        },
        {
          id: 'anc_r_weight',
          key: 'booking_weight_kg',
          type: 'NUMBER',
          label: 'Weight at booking (kg)',
          pageNumber: 1,
          validation: { required: true, min: 30, max: 200 },
        },
        {
          id: 'anc_r_lmp',
          key: 'last_menstrual_period',
          type: 'DATE',
          label: 'First day of last menstrual period',
          pageNumber: 1,
          validation: { required: true },
        },
        {
          id: 'anc_r_edd',
          key: 'expected_delivery_date',
          type: 'DATE',
          label: 'Expected delivery date',
          description: 'Calculated as 280 days from the last menstrual period.',
          pageNumber: 1,
          validation: {},
        },
        {
          id: 'anc_r_state',
          key: 'state',
          type: 'DROPDOWN',
          label: 'State',
          pageNumber: 2,
          validation: { required: true },
          optionsSource: { kind: 'CHOICE_LIST', listSlug: 'in-states', searchable: true },
        },
        {
          id: 'anc_r_district',
          key: 'district',
          type: 'DROPDOWN',
          label: 'District',
          pageNumber: 2,
          validation: { required: true },
          optionsSource: {
            kind: 'CHOICE_LIST',
            listSlug: 'in-districts',
            parentQuestionKey: 'state',
            searchable: true,
          },
        },
        {
          id: 'anc_r_village',
          key: 'village',
          type: 'SHORT_TEXT',
          label: 'Village or ward',
          pageNumber: 2,
          validation: { required: true, maxLength: 120 },
        },
        {
          id: 'anc_r_phone',
          key: 'phone',
          type: 'PHONE',
          label: 'Contact number',
          pageNumber: 2,
          validation: { required: true, pattern: '^[6-9][0-9]{9}$' },
        },
        {
          id: 'anc_r_guardian',
          key: 'guardian_phone',
          type: 'PHONE',
          label: "Guardian's contact number",
          description: 'Asked only when the mother is under 18.',
          pageNumber: 2,
          validation: { pattern: '^[6-9][0-9]{9}$' },
        },
        {
          id: 'anc_r_consent',
          key: 'consent_signature',
          type: 'SIGNATURE',
          label: 'Consent to record and share clinical data',
          pageNumber: 2,
          validation: { required: true },
        },
      ],
      rules: [
        {
          id: 'anc_r_calc_age',
          kind: 'CALCULATE',
          target: 'age',
          expr: { op: 'yearsBetween', args: [{ field: 'date_of_birth' }, { op: 'today', args: [] }] },
        },
        {
          id: 'anc_r_calc_edd',
          kind: 'CALCULATE',
          target: 'expected_delivery_date',
          expr: { op: 'addDays', args: [{ field: 'last_menstrual_period' }, { lit: 280 }] },
        },
        {
          id: 'anc_r_val_age',
          kind: 'VALIDATE',
          target: 'date_of_birth',
          message: 'That date of birth gives an age outside 12–55. Check the year.',
          expr: { op: 'not', args: [{ op: 'between', args: [{ field: 'age' }, { lit: 12 }, { lit: 55 }] }] },
        },
        {
          id: 'anc_r_val_lmp',
          kind: 'VALIDATE',
          target: 'last_menstrual_period',
          message: 'The last menstrual period cannot be in the future.',
          expr: { op: 'gt', args: [{ field: 'last_menstrual_period' }, { op: 'today', args: [] }] },
        },
        // A minor's guardian contact is asked for AND made mandatory. Two rules,
        // not one: SHOW alone would leave it skippable, and REQUIRE alone would
        // demand a field nobody could see.
        {
          id: 'anc_r_show_guardian',
          kind: 'SHOW',
          target: 'guardian_phone',
          expr: { op: 'lt', args: [{ field: 'age' }, { lit: 18 }] },
        },
        {
          id: 'anc_r_require_guardian',
          kind: 'REQUIRE',
          target: 'guardian_phone',
          expr: { op: 'lt', args: [{ field: 'age' }, { lit: 18 }] },
        },
      ],
    },
    {
      slug: 'anc-visit',
      title: 'ANC Visit',
      description:
        'One entry per antenatal visit. BMI and weight gain read the registration; the risk flag is derived from blood pressure and haemoglobin.',
      role: 'ATTACHES',
      settings: { requireAuth: true },
      pages: [{ pageNumber: 1, title: 'Visit' }],
      questions: [
        {
          id: 'anc_v_number',
          key: 'visit_number',
          type: 'NUMBER',
          label: 'Visit number',
          description: 'Each visit number may be recorded once per mother.',
          validation: { required: true, min: 1, max: 12 },
        },
        {
          id: 'anc_v_date',
          key: 'visit_date',
          type: 'DATE',
          label: 'Date of visit',
          defaultValue: TODAY,
          validation: { required: true },
        },
        {
          id: 'anc_v_weight',
          key: 'weight_kg',
          type: 'NUMBER',
          label: 'Weight (kg)',
          validation: { required: true, min: 30, max: 200 },
        },
        {
          id: 'anc_v_gain',
          key: 'weight_gain_kg',
          type: 'NUMBER',
          label: 'Weight gain since booking (kg)',
          description: 'Calculated against the weight recorded at registration.',
          validation: {},
        },
        {
          id: 'anc_v_bmi',
          key: 'bmi',
          type: 'NUMBER',
          label: 'BMI',
          description: "Calculated from this visit's weight and the height on the registration.",
          validation: {},
        },
        {
          id: 'anc_v_sys',
          key: 'systolic',
          type: 'NUMBER',
          label: 'Blood pressure — systolic (mmHg)',
          validation: { required: true, min: 60, max: 260 },
        },
        {
          id: 'anc_v_dia',
          key: 'diastolic',
          type: 'NUMBER',
          label: 'Blood pressure — diastolic (mmHg)',
          validation: { required: true, min: 40, max: 180 },
        },
        {
          id: 'anc_v_hb',
          key: 'haemoglobin',
          type: 'NUMBER',
          label: 'Haemoglobin (g/dL)',
          validation: { required: true, min: 2, max: 20 },
        },
        {
          id: 'anc_v_danger',
          key: 'danger_signs',
          type: 'MULTI_CHOICE',
          label: 'Danger signs reported',
          options: choices([
            'None',
            'Bleeding',
            'Severe headache',
            'Blurred vision',
            'Reduced fetal movement',
            'Swelling of face or hands',
          ]),
          validation: { required: true },
        },
        {
          id: 'anc_v_risk',
          key: 'risk_flag',
          type: 'SINGLE_CHOICE',
          label: 'High risk',
          description:
            'Derived: raised blood pressure, haemoglobin under 9, or any danger sign other than "None".',
          options: YES_NO(),
          validation: {},
        },
        {
          id: 'anc_v_referral',
          key: 'referred_to',
          type: 'SHORT_TEXT',
          label: 'Referred to',
          description: 'Appears when the visit is flagged high risk.',
          validation: { maxLength: 160 },
        },
        {
          id: 'anc_v_notes',
          key: 'notes',
          type: 'LONG_TEXT',
          label: 'Clinical notes',
          validation: { maxLength: 1000 },
        },
      ],
      rules: [
        {
          id: 'anc_v_calc_gain',
          kind: 'CALCULATE',
          target: 'weight_gain_kg',
          expr: {
            op: 'round',
            args: [
              {
                op: 'sub',
                args: [
                  { field: 'weight_kg' },
                  {
                    ref: {
                      form: '@anc-registration',
                      question: 'booking_weight_kg',
                      when: 'REGISTRATION',
                    },
                  },
                ],
              },
              { lit: 1 },
            ],
          },
        },
        // Height is on the registration, weight is on this visit. Neither form
        // asks for both, and BMI is still available on every visit.
        {
          id: 'anc_v_calc_bmi',
          kind: 'CALCULATE',
          target: 'bmi',
          expr: {
            op: 'round',
            args: [
              {
                op: 'div',
                args: [
                  { field: 'weight_kg' },
                  {
                    op: 'mul',
                    args: [
                      {
                        op: 'div',
                        args: [
                          { ref: { form: '@anc-registration', question: 'height_cm', when: 'REGISTRATION' } },
                          { lit: 100 },
                        ],
                      },
                      {
                        op: 'div',
                        args: [
                          { ref: { form: '@anc-registration', question: 'height_cm', when: 'REGISTRATION' } },
                          { lit: 100 },
                        ],
                      },
                    ],
                  },
                ],
              },
              { lit: 1 },
            ],
          },
        },
        {
          id: 'anc_v_calc_risk',
          kind: 'CALCULATE',
          target: 'risk_flag',
          expr: {
            op: 'if',
            args: [
              {
                op: 'or',
                args: [
                  { op: 'gte', args: [{ field: 'systolic' }, { lit: 140 }] },
                  { op: 'gte', args: [{ field: 'diastolic' }, { lit: 90 }] },
                  { op: 'lt', args: [{ field: 'haemoglobin' }, { lit: 9 }] },
                  {
                    op: 'not',
                    args: [{ op: 'includes', args: [{ field: 'danger_signs' }, { lit: 'None' }] }],
                  },
                ],
              },
              { lit: 'Yes' },
              { lit: 'No' },
            ],
          },
        },
        {
          id: 'anc_v_val_bp',
          kind: 'VALIDATE',
          target: 'diastolic',
          message: 'Diastolic pressure must be lower than systolic. Check the two readings.',
          expr: { op: 'gte', args: [{ field: 'diastolic' }, { field: 'systolic' }] },
        },
        {
          id: 'anc_v_val_date',
          kind: 'VALIDATE',
          target: 'visit_date',
          message: 'A visit cannot be recorded for a future date.',
          expr: { op: 'gt', args: [{ field: 'visit_date' }, { op: 'today', args: [] }] },
        },
        {
          id: 'anc_v_show_referral',
          kind: 'SHOW',
          target: 'referred_to',
          expr: { op: 'eq', args: [{ field: 'risk_flag' }, { lit: 'Yes' }] },
        },
        {
          id: 'anc_v_require_referral',
          kind: 'REQUIRE',
          target: 'referred_to',
          expr: { op: 'eq', args: [{ field: 'risk_flag' }, { lit: 'Yes' }] },
        },
      ],
    },
    {
      slug: 'anc-high-risk-referral',
      title: 'High-Risk Referral',
      description: 'Filed when a visit flags a high risk. Tracks where the mother was sent and what happened.',
      role: 'ATTACHES',
      settings: { requireAuth: true, notifyEmails: ['maternal-health@acme.test'] },
      pages: [{ pageNumber: 1, title: 'Referral' }],
      questions: [
        {
          id: 'anc_hr_date',
          key: 'referral_date',
          type: 'DATE',
          label: 'Date of referral',
          validation: { required: true },
        },
        {
          id: 'anc_hr_facility',
          key: 'facility',
          type: 'SHORT_TEXT',
          label: 'Referred to facility',
          validation: { required: true, maxLength: 160 },
        },
        {
          id: 'anc_hr_reason',
          key: 'reasons',
          type: 'MULTI_CHOICE',
          label: 'Reason for referral',
          options: choices([
            'Raised blood pressure',
            'Severe anaemia',
            'Bleeding',
            'Reduced fetal movement',
            'Other',
          ]),
          validation: { required: true },
        },
        {
          id: 'anc_hr_outcome',
          key: 'outcome',
          type: 'SINGLE_CHOICE',
          label: 'Outcome',
          options: choices(['Admitted', 'Treated and discharged', 'Referred further', 'Did not reach facility']),
          validation: { required: true },
        },
        {
          id: 'anc_hr_followup',
          key: 'follow_up_date',
          type: 'DATE',
          label: 'Follow-up date',
          description: 'Required when the mother was treated and sent home.',
          validation: {},
        },
      ],
      rules: [
        {
          id: 'anc_hr_show_followup',
          kind: 'SHOW',
          target: 'follow_up_date',
          expr: { op: 'neq', args: [{ field: 'outcome' }, { lit: 'Did not reach facility' }] },
        },
        {
          id: 'anc_hr_require_followup',
          kind: 'REQUIRE',
          target: 'follow_up_date',
          expr: { op: 'eq', args: [{ field: 'outcome' }, { lit: 'Treated and discharged' }] },
        },
        {
          id: 'anc_hr_val_followup',
          kind: 'VALIDATE',
          target: 'follow_up_date',
          message: 'The follow-up date must be after the referral.',
          expr: {
            op: 'and',
            args: [
              { op: 'isFilled', args: [{ field: 'follow_up_date' }] },
              { op: 'lte', args: [{ field: 'follow_up_date' }, { field: 'referral_date' }] },
            ],
          },
        },
      ],
    },
  ],
  steps: [
    {
      key: 'registration',
      formSlug: 'anc-registration',
      title: 'Registration',
      description: 'Filled once, when the mother books.',
      icon: '📝',
      mode: 'SINGLE',
      minEntries: 1,
      maxEntries: 1,
      isOptional: false,
      uniqueBy: [],
    },
    {
      key: 'visits',
      formSlug: 'anc-visit',
      title: 'Antenatal visits',
      description: 'Add one entry per visit. A visit number may not repeat.',
      icon: '🩺',
      mode: 'REPEATABLE',
      minEntries: 1,
      maxEntries: 12,
      isOptional: false,
      uniqueBy: ['visit_number'],
    },
    {
      key: 'referrals',
      formSlug: 'anc-high-risk-referral',
      title: 'High-risk referrals',
      description: 'Opens automatically when the first visit is flagged high risk.',
      icon: '🚑',
      mode: 'REPEATABLE',
      minEntries: 0,
      maxEntries: 4,
      isOptional: true,
      uniqueBy: [],
      // Gated on a CALCULATED value, not an answered one — nobody ticks a "this
      // is high risk" box; the blood pressure and haemoglobin decide, and the
      // step follows.
      showWhen: { op: 'eq', args: [{ field: 'visits.risk_flag' }, { lit: 'Yes' }] },
    },
  ],
  periods: [
    {
      label: `Quarter from ${MONTH_LABEL(monthStart(-1))}`,
      startsAt: monthStart(-1),
      endsAt: monthStart(2),
      isActive: true,
    },
  ],
  sessions: [
    {
      fingerprint: 'anc-demo-1',
      daysAgo: 26,
      entries: [
        {
          stepKey: 'registration',
          answers: {
            mother_name: 'Sunita Devi',
            mcp_number: 'MCP-104512',
            date_of_birth: '1998-04-17',
            height_cm: 156,
            booking_weight_kg: 51,
            last_menstrual_period: iso(-160),
            state: 'BR',
            district: 'BR-patna',
            village: 'Bakhtiarpur',
            phone: '9876543210',
            consent_signature: 'data:image/png;base64,SEEDED-SIGNATURE',
          },
        },
        {
          stepKey: 'visits',
          answers: {
            visit_number: 1,
            visit_date: iso(-90),
            weight_kg: 53,
            systolic: 118,
            diastolic: 76,
            haemoglobin: 11.4,
            danger_signs: ['None'],
            notes: 'Booking visit. IFA tablets issued, TT-1 given.',
          },
        },
        {
          stepKey: 'visits',
          answers: {
            visit_number: 2,
            visit_date: iso(-58),
            weight_kg: 56,
            systolic: 124,
            diastolic: 80,
            haemoglobin: 10.9,
            danger_signs: ['None'],
            notes: 'Progressing normally. Counselled on diet and rest.',
          },
        },
      ],
    },
    {
      // Flags high risk on the first visit, which is what opens the referral
      // step — the two sessions differ in SHAPE, not just in values.
      fingerprint: 'anc-demo-2',
      daysAgo: 12,
      entries: [
        {
          stepKey: 'registration',
          answers: {
            mother_name: 'Meena Kumari',
            mcp_number: 'MCP-104880',
            date_of_birth: '2008-11-02',
            height_cm: 149,
            booking_weight_kg: 42,
            last_menstrual_period: iso(-120),
            state: 'BR',
            district: 'BR-gaya',
            village: 'Tekari',
            phone: '9812345678',
            guardian_phone: '9822334455',
            consent_signature: 'data:image/png;base64,SEEDED-SIGNATURE',
          },
        },
        {
          stepKey: 'visits',
          answers: {
            visit_number: 1,
            visit_date: iso(-40),
            weight_kg: 43,
            systolic: 148,
            diastolic: 94,
            haemoglobin: 8.2,
            danger_signs: ['Severe headache', 'Swelling of face or hands'],
            referred_to: 'District Hospital, Gaya',
            notes: 'Raised BP with severe anaemia. Referred same day.',
          },
        },
        {
          stepKey: 'referrals',
          answers: {
            referral_date: iso(-40),
            facility: 'District Hospital, Gaya',
            reasons: ['Raised blood pressure', 'Severe anaemia'],
            outcome: 'Treated and discharged',
            follow_up_date: iso(-26),
          },
        },
      ],
    },
  ],
};

// ═════════════════════════════════════════════════════════════════════════════
// SCENARIO 2 — Kharif crop and plot survey
//
// The interesting part is the economics: nobody types a yield or a support
// price. Both are columns on the `crops` choice list, read with `lookup()`, and
// the plot's value falls out of them. Changing the MSP is a data edit, not a
// form edit.
// ═════════════════════════════════════════════════════════════════════════════

const CROPS: Array<{ value: string; label: string; yield: number; msp: number; season: string }> = [
  { value: 'paddy', label: 'Paddy', yield: 22, msp: 2300, season: 'Kharif' },
  { value: 'maize', label: 'Maize', yield: 25, msp: 2225, season: 'Kharif' },
  { value: 'cotton', label: 'Cotton', yield: 8, msp: 7121, season: 'Kharif' },
  { value: 'soybean', label: 'Soybean', yield: 11, msp: 4892, season: 'Kharif' },
  { value: 'groundnut', label: 'Groundnut', yield: 14, msp: 6783, season: 'Kharif' },
  { value: 'bajra', label: 'Bajra', yield: 12, msp: 2625, season: 'Kharif' },
];

const CROP_VARIETIES: Record<string, string[]> = {
  paddy: ['MTU-1010', 'Swarna Sub-1', 'Pusa Basmati 1509'],
  maize: ['DHM-117', 'Bio-9681', 'PMH-1'],
  cotton: ['Bt Cotton RCH-2', 'Suraj', 'Bunny Bt'],
  soybean: ['JS-9560', 'NRC-86', 'RVS 2001-4'],
  groundnut: ['GJG-9', 'TAG-24', 'Kadiri-6'],
  bajra: ['HHB-67 Improved', 'Pusa Composite 383', 'GHB-558'],
};

const KHARIF: Scenario = {
  key: 'kharif',
  headline: 'Kharif crop survey — cascading lists with economics in the data',
  subjectType: {
    slug: 'farm',
    name: 'Farm',
    icon: '🌾',
    identityConfig: {
      displayName: ['farmer_name'],
      attributes: ['village', 'district', 'total_area_acre', 'ownership'],
      externalId: 'farm_code',
    },
  },
  app: {
    slug: 'kharif-survey',
    publicSlug: 'kharif-survey',
    name: 'Kharif Crop & Plot Survey',
    description:
      'Register the farm once, then record every plot sown this season. Expected yield and value are derived from the crop list.',
    icon: '🌾',
    theme: {
      preset: 'sunset',
      primaryColor: '#b45309',
      backgroundColor: '#fffbeb',
      cardColor: '#ffffff',
      textColor: '#2d1b06',
      fontFamily: 'Plus Jakarta Sans',
      borderRadius: 'md',
      cardVariant: 'card',
      // Appearance: an enumerator working through 25 plots wants density and a
      // way to fold finished sections away, not a front door.
      appMasthead: 'bar',
      appStepStyle: 'accordion',
      appDensity: 'compact',
      appTexture: 'dots',
      // Up to 25 plots, each with nine fields. This is a work surface, not a
      // document, so it takes the whole screen.
      appWidth: 'full',
    },
    branding: {
      headerTitle: 'Kharif Crop & Plot Survey',
      footerText: 'Department of Agriculture · Season 2026',
    },
    requireAuth: true,
    // Enumerators walk between plots and lose signal constantly.
    allowDrafts: true,
    isPublished: true,
    // The one app that defers to its forms. Farm registration and the plot
    // record are authored as two-column with paired fields; the pest report
    // is stacked because it is mostly a matrix. Forcing either arrangement on
    // all three would throw one of them away.
    layoutMode: 'INHERIT',
    dashboardCards: (formId) => [
      { title: 'Farms registered', source: 'subjects' },
      {
        title: 'Plots recorded (season)',
        source: 'submissions',
        filter: { formId: formId('plot-crop-record') },
      },
      {
        title: 'Pest reports (30 days)',
        source: 'submissions',
        filter: { formId: formId('pest-disease-report'), createdWithinDays: 30 },
      },
    ],
  },
  choiceLists: [
    {
      slug: 'crops',
      name: 'Crops — Kharif',
      description:
        'Season crops with the two numbers the survey needs. `lookup()` reads these columns, so updating a support price is a data change rather than a form change.',
      metadataSchema: [
        { key: 'yield_per_acre', label: 'Typical yield (quintal/acre)', type: 'number' },
        { key: 'msp_per_quintal', label: 'Minimum support price (₹/quintal)', type: 'number' },
        { key: 'season', label: 'Season', type: 'text' },
      ],
      items: CROPS.map((crop) => ({
        value: crop.value,
        label: crop.label,
        metadata: {
          yield_per_acre: crop.yield,
          msp_per_quintal: crop.msp,
          season: crop.season,
        },
      })),
    },
    {
      slug: 'crop-varieties',
      name: 'Crop varieties',
      description: 'Cascades from `crops` — picking a crop narrows the varieties on offer.',
      parentSlug: 'crops',
      metadataSchema: [{ key: 'crop', label: 'Crop', type: 'text' }],
      items: Object.entries(CROP_VARIETIES).flatMap(([crop, varieties]) =>
        varieties.map((variety) => ({
          value: `${crop}-${variety.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
          label: variety,
          parentValue: crop,
          metadata: { crop },
        })),
      ),
    },
  ],
  knownChoiceLists: ['in-states', 'in-districts', 'crops', 'crop-varieties'],
  forms: [
    {
      slug: 'farm-registration',
      title: 'Farm Registration',
      description: 'The farm and its holding. Filled once; every plot record is checked against the acreage declared here.',
      role: 'REGISTERS',
      // Two-column, with the widths below. Only meaningful because the app is
      // INHERIT — under DOCUMENT or GRID the app imposes its own arrangement
      // and every `width` here is ignored.
      settings: { requireAuth: true, layoutMode: 'GRID' },
      pages: [{ pageNumber: 1, title: 'Farmer and holding' }],
      questions: [
        // Short, related fields paired across the row. `width` is only read
        // inside a grid, so a form set to DOCUMENT would ignore all of it.
        {
          id: 'krf_farmer',
          key: 'farmer_name',
          type: 'SHORT_TEXT',
          label: 'Farmer name',
          width: 'HALF',
          validation: { required: true, maxLength: 120 },
        },
        {
          id: 'krf_code',
          key: 'farm_code',
          type: 'SHORT_TEXT',
          label: 'Farm code',
          placeholder: 'FARM-2026-0001',
          width: 'HALF',
          validation: { required: true, pattern: '^FARM-[0-9]{4}-[0-9]{4}$' },
        },
        {
          id: 'krf_state',
          key: 'state',
          type: 'DROPDOWN',
          label: 'State',
          width: 'HALF',
          validation: { required: true },
          optionsSource: { kind: 'CHOICE_LIST', listSlug: 'in-states', searchable: true },
        },
        {
          id: 'krf_district',
          key: 'district',
          type: 'DROPDOWN',
          label: 'District',
          width: 'HALF',
          validation: { required: true },
          optionsSource: {
            kind: 'CHOICE_LIST',
            listSlug: 'in-districts',
            parentQuestionKey: 'state',
            searchable: true,
          },
        },
        {
          id: 'krf_village',
          key: 'village',
          type: 'SHORT_TEXT',
          label: 'Village',
          width: 'HALF',
          validation: { required: true, maxLength: 120 },
        },
        {
          id: 'krf_area',
          key: 'total_area_acre',
          type: 'NUMBER',
          label: 'Total holding (acres)',
          width: 'HALF',
          validation: { required: true, min: 1, max: 500 },
        },
        {
          id: 'krf_ownership',
          key: 'ownership',
          type: 'SINGLE_CHOICE',
          label: 'Ownership',
          width: 'HALF',
          options: choices(['Owned', 'Leased', 'Shared cropping']),
          validation: { required: true },
        },
        {
          id: 'krf_lease',
          key: 'lease_years_remaining',
          type: 'NUMBER',
          label: 'Years remaining on the lease',
          description: 'Asked only for a leased holding.',
          width: 'HALF',
          validation: { min: 0, max: 99 },
        },
        {
          id: 'krf_irrigation',
          key: 'irrigation_source',
          type: 'SINGLE_CHOICE',
          label: 'Main irrigation source',
          width: 'HALF',
          options: choices(['Canal', 'Borewell', 'Tank', 'Rainfed']),
          validation: { required: true },
        },
        {
          id: 'krf_pest',
          key: 'has_pest_issue',
          type: 'SINGLE_CHOICE',
          label: 'Any pest or disease problem this season?',
          description: 'Answering Yes opens the pest reporting step later in the app.',
          width: 'HALF',
          options: YES_NO(),
          validation: { required: true },
        },
        {
          id: 'krf_photo',
          key: 'farm_photo',
          type: 'FILE_UPLOAD',
          label: 'Photograph of the holding',
          // Explicitly the whole row: a drop zone squeezed into one column is
          // a smaller target than the thing being dropped on it.
          width: 'FULL',
          validation: { maxSizeMb: 5, allowedTypes: ['image/jpeg', 'image/png'] },
        },
      ],
      rules: [
        {
          id: 'krf_show_lease',
          kind: 'SHOW',
          target: 'lease_years_remaining',
          expr: { op: 'eq', args: [{ field: 'ownership' }, { lit: 'Leased' }] },
        },
        {
          id: 'krf_require_lease',
          kind: 'REQUIRE',
          target: 'lease_years_remaining',
          expr: { op: 'eq', args: [{ field: 'ownership' }, { lit: 'Leased' }] },
        },
        {
          id: 'krf_val_rainfed',
          kind: 'VALIDATE',
          target: 'irrigation_source',
          message:
            'A holding over 50 acres recorded as fully rainfed is unusual. Confirm the irrigation source.',
          expr: {
            op: 'and',
            args: [
              { op: 'eq', args: [{ field: 'irrigation_source' }, { lit: 'Rainfed' }] },
              { op: 'gt', args: [{ field: 'total_area_acre' }, { lit: 50 }] },
            ],
          },
        },
      ],
    },
    {
      slug: 'plot-crop-record',
      title: 'Plot & Crop Record',
      description:
        'One entry per plot. Yield, support price and expected value are all derived — the enumerator types an area and picks a crop.',
      role: 'ATTACHES',
      // Nine short fields, repeated up to 25 times. Stacked, that is a very
      // long scroll for what is really four pairs and a date.
      settings: { requireAuth: true, layoutMode: 'GRID' },
      pages: [{ pageNumber: 1, title: 'Plot' }],
      questions: [
        {
          id: 'kpc_code',
          key: 'plot_code',
          type: 'SHORT_TEXT',
          label: 'Plot code',
          description: 'Unique within the farm.',
          width: 'HALF',
          validation: { required: true, maxLength: 40 },
        },
        {
          id: 'kpc_area',
          key: 'plot_area_acre',
          type: 'NUMBER',
          label: 'Plot area (acres)',
          width: 'HALF',
          validation: { required: true, min: 1, max: 500 },
        },
        {
          id: 'kpc_crop',
          key: 'crop',
          type: 'DROPDOWN',
          label: 'Crop sown',
          width: 'HALF',
          validation: { required: true },
          optionsSource: { kind: 'CHOICE_LIST', listSlug: 'crops', searchable: true },
        },
        {
          id: 'kpc_variety',
          key: 'variety',
          type: 'DROPDOWN',
          label: 'Variety',
          width: 'HALF',
          validation: {},
          optionsSource: {
            kind: 'CHOICE_LIST',
            listSlug: 'crop-varieties',
            parentQuestionKey: 'crop',
          },
        },
        {
          id: 'kpc_sowing',
          key: 'sowing_date',
          type: 'DATE',
          label: 'Date of sowing',
          width: 'HALF',
          validation: { required: true },
        },
        {
          id: 'kpc_msp',
          key: 'msp_per_quintal',
          type: 'NUMBER',
          label: 'Support price (₹/quintal)',
          description: 'Read from the crop list.',
          width: 'HALF',
          validation: {},
        },
        // The three derived figures sit together as a pair and a total, which
        // only reads as a group because they are laid out as one.
        {
          id: 'kpc_yield',
          key: 'expected_yield_quintal',
          type: 'NUMBER',
          label: 'Expected yield (quintal)',
          description: 'Plot area × the typical yield for this crop.',
          width: 'HALF',
          validation: {},
        },
        {
          id: 'kpc_value',
          key: 'expected_value_inr',
          type: 'NUMBER',
          label: 'Expected value (₹)',
          description: 'Expected yield × support price. Depends on two other calculated fields.',
          width: 'HALF',
          validation: {},
        },
        {
          id: 'kpc_harvest',
          key: 'expected_harvest_date',
          type: 'DATE',
          label: 'Expected harvest',
          description: '120 days from sowing.',
          width: 'FULL',
          validation: {},
        },
      ],
      rules: [
        {
          id: 'kpc_calc_msp',
          kind: 'CALCULATE',
          target: 'msp_per_quintal',
          expr: {
            op: 'lookup',
            args: [{ lit: 'crops' }, { field: 'crop' }, { lit: 'msp_per_quintal' }],
          },
        },
        {
          id: 'kpc_calc_yield',
          kind: 'CALCULATE',
          target: 'expected_yield_quintal',
          expr: {
            op: 'round',
            args: [
              {
                op: 'mul',
                args: [
                  { field: 'plot_area_acre' },
                  { op: 'lookup', args: [{ lit: 'crops' }, { field: 'crop' }, { lit: 'yield_per_acre' }] },
                ],
              },
              { lit: 2 },
            ],
          },
        },
        // Depends on the two calculations above. The compiler sorts these into
        // dependency order at publish, so the declaration order here is
        // irrelevant — which is the whole point of compiling rather than
        // interpreting top to bottom.
        {
          id: 'kpc_calc_value',
          kind: 'CALCULATE',
          target: 'expected_value_inr',
          expr: {
            op: 'round',
            args: [
              { op: 'mul', args: [{ field: 'expected_yield_quintal' }, { field: 'msp_per_quintal' }] },
              { lit: 0 },
            ],
          },
        },
        {
          id: 'kpc_calc_harvest',
          kind: 'CALCULATE',
          target: 'expected_harvest_date',
          expr: { op: 'addDays', args: [{ field: 'sowing_date' }, { lit: 120 }] },
        },
        // Reads the farm's own registration. A plot larger than the holding it
        // sits on is a data-entry slip that only the registration can catch.
        {
          id: 'kpc_val_area',
          kind: 'VALIDATE',
          target: 'plot_area_acre',
          message: 'This plot is larger than the total holding recorded for the farm.',
          expr: {
            op: 'gt',
            args: [
              { field: 'plot_area_acre' },
              { ref: { form: '@farm-registration', question: 'total_area_acre', when: 'REGISTRATION' } },
            ],
          },
        },
        {
          id: 'kpc_require_variety',
          kind: 'REQUIRE',
          target: 'variety',
          expr: { op: 'isFilled', args: [{ field: 'crop' }] },
        },
      ],
    },
    {
      slug: 'pest-disease-report',
      title: 'Pest & Disease Report',
      description: 'Filed against a farm that reported a problem. Severity is a matrix so one visit covers every symptom.',
      role: 'ATTACHES',
      settings: { requireAuth: true, notifyEmails: ['plant-protection@acme.test'] },
      pages: [{ pageNumber: 1, title: 'Observation' }],
      questions: [
        {
          id: 'kpd_date',
          key: 'observed_on',
          type: 'DATE',
          label: 'Observed on',
          defaultValue: TODAY,
          validation: { required: true },
        },
        {
          id: 'kpd_matrix',
          key: 'severity',
          type: 'MATRIX',
          label: 'Severity by symptom',
          description: 'Rate each symptom seen on the plot.',
          matrixRows: ['Leaf damage', 'Stem borer', 'Fungal spots', 'Root rot', 'Wilting'],
          matrixColumns: ['None', 'Low', 'Moderate', 'Severe'],
          validation: { required: true },
        },
        {
          id: 'kpd_area',
          key: 'affected_area_acre',
          type: 'NUMBER',
          label: 'Affected area (acres)',
          validation: { required: true, min: 0, max: 500 },
        },
        {
          id: 'kpd_action',
          key: 'action_taken',
          type: 'MULTI_CHOICE',
          label: 'Action taken',
          options: choices([
            'None yet',
            'Biological control',
            'Chemical spray',
            'Removed affected plants',
            'Advisory sought',
          ]),
          validation: { required: true },
        },
        {
          id: 'kpd_advisory',
          key: 'advisory_needed',
          type: 'SINGLE_CHOICE',
          label: 'Does the farmer want an extension officer to call?',
          options: YES_NO(),
          validation: { required: true },
        },
        {
          id: 'kpd_contact',
          key: 'advisory_contact',
          type: 'PHONE',
          label: 'Number to call',
          validation: { pattern: '^[6-9][0-9]{9}$' },
        },
      ],
      rules: [
        {
          id: 'kpd_show_contact',
          kind: 'SHOW',
          target: 'advisory_contact',
          expr: { op: 'eq', args: [{ field: 'advisory_needed' }, { lit: 'Yes' }] },
        },
        {
          id: 'kpd_require_contact',
          kind: 'REQUIRE',
          target: 'advisory_contact',
          expr: { op: 'eq', args: [{ field: 'advisory_needed' }, { lit: 'Yes' }] },
        },
        {
          id: 'kpd_val_date',
          kind: 'VALIDATE',
          target: 'observed_on',
          message: 'An observation cannot be dated in the future.',
          expr: { op: 'gt', args: [{ field: 'observed_on' }, { op: 'today', args: [] }] },
        },
      ],
    },
  ],
  steps: [
    {
      key: 'farm',
      formSlug: 'farm-registration',
      title: 'Farm registration',
      description: 'The holding, filled once.',
      icon: '🏡',
      mode: 'SINGLE',
      minEntries: 1,
      maxEntries: 1,
      isOptional: false,
      uniqueBy: [],
    },
    {
      key: 'plots',
      formSlug: 'plot-crop-record',
      title: 'Plots sown',
      description: 'One entry per plot. Plot codes may not repeat within a farm.',
      icon: '🌱',
      mode: 'REPEATABLE',
      minEntries: 1,
      maxEntries: 25,
      isOptional: false,
      uniqueBy: ['plot_code'],
    },
    {
      key: 'pest_reports',
      formSlug: 'pest-disease-report',
      title: 'Pest & disease reports',
      description: 'Shown only to farms that reported a pest problem at registration.',
      icon: '🐛',
      mode: 'REPEATABLE',
      minEntries: 0,
      maxEntries: 8,
      isOptional: true,
      uniqueBy: [],
      showWhen: { op: 'eq', args: [{ field: 'farm.has_pest_issue' }, { lit: 'Yes' }] },
    },
  ],
  periods: [
    {
      label: 'Kharif 2026',
      startsAt: monthStart(-2),
      endsAt: monthStart(3),
      isActive: true,
    },
  ],
  sessions: [
    {
      fingerprint: 'kharif-demo-1',
      daysAgo: 20,
      entries: [
        {
          stepKey: 'farm',
          answers: {
            farmer_name: 'Ramesh Patil',
            farm_code: 'FARM-2026-0001',
            state: 'MH',
            district: 'MH-nashik',
            village: 'Dindori',
            total_area_acre: 12,
            ownership: 'Owned',
            irrigation_source: 'Borewell',
            has_pest_issue: 'No',
          },
        },
        {
          stepKey: 'plots',
          answers: {
            plot_code: 'P-01',
            plot_area_acre: 7,
            crop: 'soybean',
            variety: 'soybean-js-9560',
            sowing_date: iso(-52),
          },
        },
        {
          stepKey: 'plots',
          answers: {
            plot_code: 'P-02',
            plot_area_acre: 5,
            crop: 'maize',
            variety: 'maize-dhm-117',
            sowing_date: iso(-48),
          },
        },
      ],
    },
    {
      fingerprint: 'kharif-demo-2',
      daysAgo: 9,
      entries: [
        {
          stepKey: 'farm',
          answers: {
            farmer_name: 'Lakshmi Reddy',
            farm_code: 'FARM-2026-0002',
            state: 'TG',
            district: 'TG-warangal',
            village: 'Geesugonda',
            total_area_acre: 9,
            ownership: 'Leased',
            lease_years_remaining: 4,
            irrigation_source: 'Canal',
            has_pest_issue: 'Yes',
          },
        },
        {
          stepKey: 'plots',
          answers: {
            plot_code: 'P-01',
            plot_area_acre: 6,
            crop: 'cotton',
            variety: 'cotton-bt-cotton-rch-2',
            sowing_date: iso(-55),
          },
        },
        {
          stepKey: 'pest_reports',
          answers: {
            observed_on: iso(-11),
            severity: {
              'Leaf damage': 'Moderate',
              'Stem borer': 'Low',
              'Fungal spots': 'None',
              'Root rot': 'None',
              Wilting: 'Low',
            } as unknown as RuleValue,
            affected_area_acre: 2,
            action_taken: ['Chemical spray', 'Advisory sought'],
            advisory_needed: 'Yes',
            advisory_contact: '9701234567',
          },
        },
      ],
    },
  ],
};

// ═════════════════════════════════════════════════════════════════════════════
// SCENARIO 3 — Campus hiring drive
//
// Three forms, three different access postures on purpose: the application is
// open to the world and capped, the aptitude check is a quiz, and the interview
// feedback is password-protected and staff-only. All three live in one app.
// ═════════════════════════════════════════════════════════════════════════════

const CAMPUS: Scenario = {
  key: 'campus',
  headline: 'Campus hiring — public intake, quiz scoring, gated internal step',
  subjectType: {
    slug: 'candidate',
    name: 'Candidate',
    icon: '🎓',
    identityConfig: {
      displayName: ['full_name'],
      attributes: ['degree', 'cgpa', 'graduation_year', 'is_eligible'],
      externalId: 'application_no',
    },
  },
  app: {
    slug: 'campus-hiring-2026',
    publicSlug: 'campus-hiring-2026',
    name: 'Campus Hiring Drive 2026',
    description:
      'Apply, take the aptitude check, and — if eligible — sit the interview rounds. One link for the whole drive.',
    icon: '🎓',
    theme: {
      preset: 'indigo',
      primaryColor: '#4338ca',
      backgroundColor: '#f5f5ff',
      cardColor: '#ffffff',
      textColor: '#1b1b3a',
      fontFamily: 'Outfit',
      borderRadius: 'lg',
      cardVariant: 'glass',
      // Appearance: apply → aptitude → interview is a sequence a candidate
      // does once, and paging it keeps a long application from looking like a
      // wall of questions on first open.
      appShell: 'wizard',
      // A public front door for strangers — generous spacing, plain
      // headings, brand colour up top. `appTexture` is set but WILL NOT RENDER
      // while cards are glass: a pattern showing through a translucent card
      // makes the text on it unreadable, so it is suppressed at render and
      // comes back if the author picks solid cards.
      appMasthead: 'gradient',
      appStepStyle: 'plain',
      appDensity: 'spacious',
      appTexture: 'mesh',
    },
    branding: {
      headerTitle: 'Campus Hiring Drive 2026',
      footerText: 'Talent Acquisition · Applications close in 45 days',
    },
    // Candidates are strangers; the app has to be open or nobody can apply.
    requireAuth: false,
    allowDrafts: true,
    isPublished: true,
    dashboardCards: (formId) => [
      { title: 'Applications', source: 'subjects' },
      { title: 'Applied this week', source: 'subjects', filter: { createdWithinDays: 7 } },
      {
        title: 'Aptitude checks taken',
        source: 'submissions',
        filter: { formId: formId('aptitude-check') },
      },
      {
        title: 'Interviews recorded',
        source: 'submissions',
        filter: { formId: formId('interview-feedback') },
      },
    ],
  },
  choiceLists: [],
  knownChoiceLists: [],
  forms: [
    {
      slug: 'campus-application',
      title: 'Application',
      description:
        'Open to any candidate. Eligibility is computed from CGPA, graduation year and backlogs — nobody self-declares it.',
      role: 'REGISTERS',
      settings: {
        // One person, one application. `allowMultiple: false` is what makes the
        // duplicate check meaningful.
        allowMultiple: false,
        requireAuth: false,
        maxSubmissions: 500,
        expiresInDays: 45,
        notifyEmails: ['campus-hiring@acme.test', 'talent-ops@acme.test'],
        // Fewer fields on screen at a time; a public applicant is not a clerk.
        layoutMode: 'CONVERSATIONAL',
      },
      pages: [
        { pageNumber: 1, title: 'About you' },
        { pageNumber: 2, title: 'Academics' },
        { pageNumber: 3, title: 'Attachments' },
      ],
      questions: [
        {
          id: 'cam_name',
          key: 'full_name',
          type: 'SHORT_TEXT',
          label: 'Full name',
          pageNumber: 1,
          validation: { required: true, maxLength: 120 },
        },
        {
          id: 'cam_appno',
          key: 'application_no',
          type: 'SHORT_TEXT',
          label: 'Application number',
          placeholder: 'APP-2026-0001',
          pageNumber: 1,
          validation: { required: true, pattern: '^APP-[0-9]{4}-[0-9]{4}$' },
        },
        {
          id: 'cam_email',
          key: 'email',
          type: 'EMAIL',
          label: 'Email',
          pageNumber: 1,
          validation: { required: true },
        },
        {
          id: 'cam_phone',
          key: 'phone',
          type: 'PHONE',
          label: 'Mobile number',
          pageNumber: 1,
          validation: { required: true, pattern: '^[6-9][0-9]{9}$' },
        },
        {
          id: 'cam_degree',
          key: 'degree',
          type: 'DROPDOWN',
          label: 'Degree',
          pageNumber: 2,
          options: choices(['B.Tech CSE', 'B.Tech ECE', 'B.Tech IT', 'MCA', 'M.Tech', 'B.Sc Statistics']),
          validation: { required: true },
        },
        {
          id: 'cam_year',
          key: 'graduation_year',
          type: 'NUMBER',
          label: 'Year of graduation',
          pageNumber: 2,
          validation: { required: true, min: 2020, max: 2030 },
        },
        {
          id: 'cam_cgpa',
          key: 'cgpa',
          type: 'NUMBER',
          label: 'CGPA (out of 10)',
          pageNumber: 2,
          validation: { required: true, min: 0, max: 10 },
        },
        {
          id: 'cam_backlogs',
          key: 'has_backlogs',
          type: 'SINGLE_CHOICE',
          label: 'Any active backlogs?',
          pageNumber: 2,
          options: YES_NO(),
          validation: { required: true },
        },
        {
          id: 'cam_bcount',
          key: 'backlog_count',
          type: 'NUMBER',
          label: 'How many?',
          pageNumber: 2,
          validation: { min: 0, max: 30 },
        },
        {
          id: 'cam_eligible',
          key: 'is_eligible',
          type: 'SINGLE_CHOICE',
          label: 'Eligible for interview',
          description:
            'Derived: CGPA 6.5 or above, graduating 2025 or later, and at most one backlog.',
          pageNumber: 2,
          options: YES_NO(),
          validation: {},
        },
        {
          id: 'cam_resume',
          key: 'resume',
          type: 'FILE_UPLOAD',
          label: 'Résumé (PDF)',
          pageNumber: 3,
          validation: { required: true, maxSizeMb: 2, allowedTypes: ['application/pdf'] },
        },
        {
          id: 'cam_portfolio',
          key: 'portfolio_url',
          type: 'URL',
          label: 'Portfolio or GitHub',
          pageNumber: 3,
          validation: {},
        },
      ],
      rules: [
        {
          id: 'cam_show_bcount',
          kind: 'SHOW',
          target: 'backlog_count',
          expr: { op: 'eq', args: [{ field: 'has_backlogs' }, { lit: 'Yes' }] },
        },
        {
          id: 'cam_require_bcount',
          kind: 'REQUIRE',
          target: 'backlog_count',
          expr: { op: 'eq', args: [{ field: 'has_backlogs' }, { lit: 'Yes' }] },
        },
        {
          id: 'cam_calc_eligible',
          kind: 'CALCULATE',
          target: 'is_eligible',
          expr: {
            op: 'if',
            args: [
              {
                op: 'and',
                args: [
                  { op: 'gte', args: [{ field: 'cgpa' }, { lit: 6.5 }] },
                  { op: 'gte', args: [{ field: 'graduation_year' }, { lit: 2025 }] },
                  {
                    op: 'or',
                    args: [
                      { op: 'eq', args: [{ field: 'has_backlogs' }, { lit: 'No' }] },
                      { op: 'lte', args: [{ field: 'backlog_count' }, { lit: 1 }] },
                    ],
                  },
                ],
              },
              { lit: 'Yes' },
              { lit: 'No' },
            ],
          },
        },
        {
          id: 'cam_val_cgpa',
          kind: 'VALIDATE',
          target: 'cgpa',
          message: 'CGPA must be between 0 and 10. Convert a percentage before entering it.',
          expr: { op: 'not', args: [{ op: 'between', args: [{ field: 'cgpa' }, { lit: 0 }, { lit: 10 }] }] },
        },
      ],
    },
    {
      slug: 'aptitude-check',
      title: 'Aptitude Check',
      description: 'Six scored questions. The worker grades the submission against the correct answers stored on the version.',
      role: 'ATTACHES',
      settings: {
        // Scored, so it is graded automatically and may be taken once.
        isQuizMode: true,
        allowMultiple: false,
        requireAuth: false,
      },
      pages: [{ pageNumber: 1, title: 'Aptitude' }],
      questions: [
        {
          id: 'apt_track',
          key: 'preferred_track',
          type: 'SINGLE_CHOICE',
          label: 'Preferred track',
          options: choices(['Backend', 'Frontend', 'Data', 'Quality engineering']),
          validation: { required: true },
        },
        {
          id: 'apt_q1',
          key: 'complexity_of_binary_search',
          type: 'SINGLE_CHOICE',
          label: 'What is the average time complexity of binary search on a sorted array?',
          options: choices(['O(1)', 'O(log n)', 'O(n)', 'O(n log n)']),
          validation: { required: true },
          points: 10,
          correctAnswer: 'O(log n)',
          explanation: 'Each comparison halves the remaining range.',
        },
        {
          id: 'apt_q2',
          key: 'sql_join_returning_all_left_rows',
          type: 'SINGLE_CHOICE',
          label: 'Which join returns every row from the left table regardless of a match?',
          options: choices(['INNER JOIN', 'LEFT JOIN', 'CROSS JOIN', 'SELF JOIN']),
          validation: { required: true },
          points: 10,
          correctAnswer: 'LEFT JOIN',
          explanation: 'Unmatched right-hand columns come back as NULL.',
        },
        {
          id: 'apt_q3',
          key: 'http_status_for_unauthenticated',
          type: 'SINGLE_CHOICE',
          label: 'A request arrives with no credentials. Which status is correct?',
          options: choices(['400', '401', '403', '404']),
          validation: { required: true },
          points: 10,
          correctAnswer: '401',
          explanation: '401 means unauthenticated; 403 means authenticated but not permitted.',
        },
        {
          id: 'apt_q4',
          key: 'acid_durability',
          type: 'SINGLE_CHOICE',
          label: 'Which ACID property guarantees a committed transaction survives a crash?',
          options: choices(['Atomicity', 'Consistency', 'Isolation', 'Durability']),
          validation: { required: true },
          points: 10,
          correctAnswer: 'Durability',
        },
        {
          id: 'apt_q5',
          key: 'index_tradeoff',
          type: 'SINGLE_CHOICE',
          label: 'What does adding a database index most directly cost?',
          options: choices([
            'Read latency on the indexed column',
            'Write throughput and storage',
            'Connection pool size',
            'Transaction isolation level',
          ]),
          validation: { required: true },
          points: 10,
          correctAnswer: 'Write throughput and storage',
        },
        {
          id: 'apt_q6',
          key: 'idempotent_methods',
          type: 'MULTI_CHOICE',
          label: 'Which HTTP methods are idempotent? Select all that apply.',
          options: choices(['GET', 'POST', 'PUT', 'DELETE']),
          validation: { required: true },
          points: 20,
          correctAnswer: ['GET', 'PUT', 'DELETE'],
          explanation: 'Repeating any of the three leaves the server in the same state.',
        },
        {
          id: 'apt_conf',
          key: 'confidence',
          type: 'SLIDER',
          label: 'How confident are you in these answers?',
          sliderMin: 0,
          sliderMax: 10,
          sliderStep: 1,
          defaultValue: 5,
          validation: { required: true },
        },
        {
          id: 'apt_band',
          key: 'confidence_band',
          type: 'SINGLE_CHOICE',
          label: 'Confidence band',
          description: 'Derived from the slider — used only to compare stated confidence with the score.',
          options: choices(['Low', 'Medium', 'High']),
          validation: {},
        },
      ],
      rules: [
        // Nested `if` — the operator set has no switch, and does not need one.
        {
          id: 'apt_calc_band',
          kind: 'CALCULATE',
          target: 'confidence_band',
          expr: {
            op: 'if',
            args: [
              { op: 'gte', args: [{ field: 'confidence' }, { lit: 8 }] },
              { lit: 'High' },
              {
                op: 'if',
                args: [
                  { op: 'gte', args: [{ field: 'confidence' }, { lit: 5 }] },
                  { lit: 'Medium' },
                  { lit: 'Low' },
                ],
              },
            ],
          },
        },
      ],
    },
    {
      slug: 'interview-feedback',
      title: 'Interview Feedback',
      description: 'Filled by the panel, not the candidate. Signed in, password-protected, and never publicly linked.',
      role: 'ATTACHES',
      settings: {
        requireAuth: true,
        // Belt and braces: the form sits inside a public app, so the password is
        // what stops a candidate who guesses the URL from opening the panel's
        // scoring sheet.
        password: 'panel-2026',
        notifyEmails: ['hiring-panel@acme.test'],
      },
      pages: [{ pageNumber: 1, title: 'Panel assessment' }],
      questions: [
        {
          id: 'ivf_panel',
          key: 'panel_member',
          type: 'SHORT_TEXT',
          label: 'Panel member',
          validation: { required: true, maxLength: 120 },
        },
        {
          id: 'ivf_round',
          key: 'round',
          type: 'SINGLE_CHOICE',
          label: 'Round',
          options: choices(['Technical 1', 'Technical 2', 'System design', 'HR']),
          validation: { required: true },
        },
        {
          id: 'ivf_date',
          key: 'interview_date',
          type: 'DATE',
          label: 'Date',
          defaultValue: TODAY,
          validation: { required: true },
        },
        {
          id: 'ivf_matrix',
          key: 'competencies',
          type: 'MATRIX',
          label: 'Competency ratings',
          description: '1 is poor, 5 is excellent.',
          matrixRows: ['Problem solving', 'Coding', 'System thinking', 'Communication', 'Ownership'],
          matrixColumns: ['1', '2', '3', '4', '5'],
          validation: { required: true },
        },
        {
          id: 'ivf_score',
          key: 'overall_score',
          type: 'SLIDER',
          label: 'Overall score',
          sliderMin: 0,
          sliderMax: 10,
          sliderStep: 1,
          defaultValue: 5,
          validation: { required: true },
        },
        {
          id: 'ivf_rec',
          key: 'recommendation',
          type: 'SINGLE_CHOICE',
          label: 'Recommendation',
          options: choices(['Strong hire', 'Hire', 'Hold', 'No hire']),
          validation: { required: true },
        },
        {
          id: 'ivf_reason',
          key: 'rejection_reason',
          type: 'LONG_TEXT',
          label: 'Reason',
          description: 'Required for a no-hire, so the decision is on the record.',
          validation: { maxLength: 1000 },
        },
        {
          id: 'ivf_sign',
          key: 'panel_signature',
          type: 'SIGNATURE',
          label: 'Panel member signature',
          validation: { required: true },
        },
      ],
      rules: [
        {
          id: 'ivf_show_reason',
          kind: 'SHOW',
          target: 'rejection_reason',
          expr: { op: 'eq', args: [{ field: 'recommendation' }, { lit: 'No hire' }] },
        },
        {
          id: 'ivf_require_reason',
          kind: 'REQUIRE',
          target: 'rejection_reason',
          expr: { op: 'eq', args: [{ field: 'recommendation' }, { lit: 'No hire' }] },
        },
        // Catches the panel member who ticks the top box on autopilot.
        {
          id: 'ivf_val_strong',
          kind: 'VALIDATE',
          target: 'overall_score',
          message: 'A strong-hire recommendation needs an overall score of at least 7.',
          expr: {
            op: 'and',
            args: [
              { op: 'eq', args: [{ field: 'recommendation' }, { lit: 'Strong hire' }] },
              { op: 'lt', args: [{ field: 'overall_score' }, { lit: 7 }] },
            ],
          },
        },
        {
          id: 'ivf_val_nohire',
          kind: 'VALIDATE',
          target: 'overall_score',
          message: 'A no-hire recommendation with a score above 7 needs a second look.',
          expr: {
            op: 'and',
            args: [
              { op: 'eq', args: [{ field: 'recommendation' }, { lit: 'No hire' }] },
              { op: 'gt', args: [{ field: 'overall_score' }, { lit: 7 }] },
            ],
          },
        },
      ],
    },
  ],
  steps: [
    {
      key: 'application',
      formSlug: 'campus-application',
      title: 'Application',
      description: 'Your details and academics.',
      icon: '📄',
      mode: 'SINGLE',
      minEntries: 1,
      maxEntries: 1,
      isOptional: false,
      uniqueBy: [],
    },
    {
      key: 'aptitude',
      formSlug: 'aptitude-check',
      title: 'Aptitude check',
      description: 'Six questions, scored automatically.',
      icon: '🧠',
      mode: 'SINGLE',
      minEntries: 1,
      maxEntries: 1,
      isOptional: false,
      uniqueBy: [],
    },
    {
      key: 'interviews',
      formSlug: 'interview-feedback',
      title: 'Interview rounds',
      description: 'Panel-only. Appears once the application computes as eligible.',
      icon: '🗣️',
      mode: 'REPEATABLE',
      minEntries: 0,
      maxEntries: 3,
      isOptional: true,
      uniqueBy: [],
      showWhen: { op: 'eq', args: [{ field: 'application.is_eligible' }, { lit: 'Yes' }] },
    },
  ],
  periods: [
    {
      label: 'Drive 2026 — Phase 1',
      startsAt: at(-30),
      endsAt: at(45),
      isActive: true,
    },
  ],
  sessions: [
    {
      fingerprint: 'campus-demo-1',
      daysAgo: 14,
      entries: [
        {
          stepKey: 'application',
          answers: {
            full_name: 'Ananya Sharma',
            application_no: 'APP-2026-0001',
            email: 'ananya.sharma@example.edu',
            phone: '9900112233',
            degree: 'B.Tech CSE',
            graduation_year: 2026,
            cgpa: 8.7,
            has_backlogs: 'No',
            resume: 'seeded-file-ananya-resume',
            portfolio_url: 'https://github.com/example-ananya',
          },
        },
        {
          stepKey: 'aptitude',
          answers: {
            preferred_track: 'Backend',
            complexity_of_binary_search: 'O(log n)',
            sql_join_returning_all_left_rows: 'LEFT JOIN',
            http_status_for_unauthenticated: '401',
            acid_durability: 'Durability',
            index_tradeoff: 'Write throughput and storage',
            idempotent_methods: ['GET', 'PUT', 'DELETE'],
            confidence: 8,
          },
        },
        {
          stepKey: 'interviews',
          answers: {
            panel_member: 'R. Iyer',
            round: 'Technical 1',
            interview_date: iso(-10),
            competencies: {
              'Problem solving': '5',
              Coding: '4',
              'System thinking': '4',
              Communication: '5',
              Ownership: '4',
            } as unknown as RuleValue,
            overall_score: 9,
            recommendation: 'Strong hire',
            panel_signature: 'data:image/png;base64,SEEDED-SIGNATURE',
          },
        },
      ],
    },
    {
      // Not eligible, so the interview step never opens. The session is
      // complete anyway — that is what `isOptional` on a gated step means.
      fingerprint: 'campus-demo-2',
      daysAgo: 6,
      entries: [
        {
          stepKey: 'application',
          answers: {
            full_name: 'Vikram Nair',
            application_no: 'APP-2026-0002',
            email: 'vikram.nair@example.edu',
            phone: '9812345670',
            degree: 'MCA',
            graduation_year: 2026,
            cgpa: 5.9,
            has_backlogs: 'Yes',
            backlog_count: 3,
            resume: 'seeded-file-vikram-resume',
          },
        },
        {
          stepKey: 'aptitude',
          answers: {
            preferred_track: 'Quality engineering',
            complexity_of_binary_search: 'O(n)',
            sql_join_returning_all_left_rows: 'LEFT JOIN',
            http_status_for_unauthenticated: '403',
            acid_durability: 'Durability',
            index_tradeoff: 'Read latency on the indexed column',
            idempotent_methods: ['GET'],
            confidence: 4,
          },
        },
      ],
    },
  ],
};

// ═════════════════════════════════════════════════════════════════════════════
// SCENARIO 4 — Cold chain facility audit
//
// The only app here with NO public URL and with drafts switched off: an audit
// that can be paused is an audit that can be filled in from memory afterwards.
// Also the only one carrying closed periods, so the reporting-history view has
// something to show.
// ═════════════════════════════════════════════════════════════════════════════

const COLD_CHAIN: Scenario = {
  key: 'cold-chain',
  headline: 'Cold chain audit — internal only, one sitting, with period history',
  subjectType: {
    slug: 'cold-chain-facility',
    name: 'Cold Chain Facility',
    icon: '🧊',
    identityConfig: {
      displayName: ['facility_name'],
      attributes: ['district', 'facility_type', 'capacity_litres'],
      externalId: 'facility_code',
    },
  },
  app: {
    slug: 'cold-chain-audit',
    // No public URL at all. Published, reachable from the dashboard, and not
    // addressable from the internet — the state an internal register should be
    // in, and one a `publicSlug` on every app could not express.
    publicSlug: null,
    name: 'Cold Chain Facility Audit',
    description:
      'Monthly compliance audit of vaccine cold chain points. Corrective actions open automatically after a temperature excursion.',
    icon: '🧊',
    theme: {
      preset: 'slate',
      primaryColor: '#0369a1',
      backgroundColor: '#f8fafc',
      cardColor: '#ffffff',
      textColor: '#0f172a',
      fontFamily: 'Roboto',
      borderRadius: 'sm',
      cardVariant: 'minimal',
      // Appearance: an internal audit tool. Tight, squared off, ruled like the
      // paper form it replaces, with the header reduced to a label.
      appMasthead: 'bar',
      appStepStyle: 'bordered',
      appDensity: 'compact',
      appTexture: 'grid',
      // A six-row compliance matrix needs the room, and an auditor at a desk
      // has a screen to give it.
      appWidth: 'full',
    },
    branding: {
      headerTitle: 'Cold Chain Facility Audit',
      footerText: 'State Vaccine Store · Internal use only',
    },
    requireAuth: true,
    // An auditor standing in front of the equipment finishes the audit there.
    // Saving a draft and completing it at a desk is how readings get invented.
    allowDrafts: false,
    isPublished: true,
    dashboardCards: (formId) => [
      { title: 'Facilities on register', source: 'subjects' },
      {
        title: 'Audits this month',
        source: 'submissions',
        filter: { formId: formId('monthly-cold-chain-audit'), createdWithinDays: 30 },
      },
      {
        title: 'Corrective actions open',
        source: 'submissions',
        filter: { formId: formId('corrective-action-plan') },
      },
    ],
  },
  choiceLists: [],
  knownChoiceLists: ['in-states', 'in-districts'],
  forms: [
    {
      slug: 'facility-profile',
      title: 'Facility Profile',
      description: 'The equipment on register. Filled once; equipment age is derived from the installation date.',
      role: 'REGISTERS',
      settings: { requireAuth: true },
      pages: [{ pageNumber: 1, title: 'Facility' }],
      questions: [
        {
          id: 'ccf_code',
          key: 'facility_code',
          type: 'SHORT_TEXT',
          label: 'Facility code',
          placeholder: 'CC-0001',
          validation: { required: true, pattern: '^CC-[0-9]{4}$' },
        },
        {
          id: 'ccf_name',
          key: 'facility_name',
          type: 'SHORT_TEXT',
          label: 'Facility name',
          validation: { required: true, maxLength: 160 },
        },
        {
          id: 'ccf_type',
          key: 'facility_type',
          type: 'SINGLE_CHOICE',
          label: 'Equipment type',
          options: choices(['Walk-in cooler', 'Walk-in freezer', 'ILR', 'Deep freezer', 'Cold room']),
          validation: { required: true },
        },
        {
          id: 'ccf_state',
          key: 'state',
          type: 'DROPDOWN',
          label: 'State',
          validation: { required: true },
          optionsSource: { kind: 'CHOICE_LIST', listSlug: 'in-states', searchable: true },
        },
        {
          id: 'ccf_district',
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
          id: 'ccf_capacity',
          key: 'capacity_litres',
          type: 'NUMBER',
          label: 'Net storage capacity (litres)',
          validation: { required: true, min: 1, max: 100000 },
        },
        {
          id: 'ccf_installed',
          key: 'installed_on',
          type: 'DATE',
          label: 'Installed on',
          validation: { required: true },
        },
        {
          id: 'ccf_age',
          key: 'equipment_age_years',
          type: 'NUMBER',
          label: 'Equipment age (years)',
          description: 'Calculated from the installation date.',
          validation: {},
        },
      ],
      rules: [
        {
          id: 'ccf_calc_age',
          kind: 'CALCULATE',
          target: 'equipment_age_years',
          expr: { op: 'yearsBetween', args: [{ field: 'installed_on' }, { op: 'today', args: [] }] },
        },
        {
          id: 'ccf_val_installed',
          kind: 'VALIDATE',
          target: 'installed_on',
          message: 'Equipment cannot be recorded as installed in the future.',
          expr: { op: 'gt', args: [{ field: 'installed_on' }, { op: 'today', args: [] }] },
        },
      ],
    },
    {
      slug: 'monthly-cold-chain-audit',
      title: 'Monthly Audit',
      description:
        'One audit per month per facility. The excursion flag, the compliance score and the RAG band are all derived from the readings.',
      role: 'ATTACHES',
      settings: { requireAuth: true, notifyEmails: ['cold-chain@acme.test'] },
      pages: [
        { pageNumber: 1, title: 'Readings' },
        { pageNumber: 2, title: 'Compliance' },
      ],
      questions: [
        {
          id: 'cca_date',
          key: 'audit_date',
          type: 'DATE',
          label: 'Audit date',
          description: 'One audit per date — the step rejects a repeat.',
          defaultValue: TODAY,
          pageNumber: 1,
          validation: { required: true },
        },
        {
          id: 'cca_min',
          key: 'min_temp_c',
          type: 'NUMBER',
          label: 'Minimum temperature since last audit (°C)',
          pageNumber: 1,
          validation: { required: true, min: -30, max: 30 },
        },
        {
          id: 'cca_max',
          key: 'max_temp_c',
          type: 'NUMBER',
          label: 'Maximum temperature since last audit (°C)',
          pageNumber: 1,
          validation: { required: true, min: -30, max: 30 },
        },
        {
          id: 'cca_excursion',
          key: 'temperature_excursion',
          type: 'SINGLE_CHOICE',
          label: 'Temperature excursion',
          description: 'Derived: anything outside the 2–8 °C band.',
          pageNumber: 1,
          options: YES_NO(),
          validation: {},
        },
        {
          id: 'cca_action',
          key: 'immediate_action',
          type: 'LONG_TEXT',
          label: 'Immediate action taken',
          description: 'Appears when the readings show an excursion.',
          pageNumber: 1,
          validation: { maxLength: 1000 },
        },
        {
          id: 'cca_checklist',
          key: 'compliance_checklist',
          type: 'MATRIX',
          label: 'Compliance checklist',
          pageNumber: 2,
          matrixRows: [
            'Temperature logged twice daily',
            'Thermometer calibrated within 12 months',
            'Vaccines arranged with adequate air flow',
            'No expired stock present',
            'Contingency plan displayed',
            'Voltage stabiliser working',
          ],
          matrixColumns: ['Yes', 'No', 'NA'],
          validation: { required: true },
        },
        {
          id: 'cca_power',
          key: 'power_backup_hours',
          type: 'NUMBER',
          label: 'Power backup available (hours)',
          pageNumber: 2,
          validation: { required: true, min: 0, max: 24 },
        },
        {
          id: 'cca_logbook',
          key: 'logbook_maintained',
          type: 'SINGLE_CHOICE',
          label: 'Temperature logbook maintained?',
          pageNumber: 2,
          options: YES_NO(),
          validation: { required: true },
        },
        {
          id: 'cca_alarm',
          key: 'alarm_functional',
          type: 'SINGLE_CHOICE',
          label: 'Alarm functional?',
          pageNumber: 2,
          options: YES_NO(),
          validation: { required: true },
        },
        {
          id: 'cca_score',
          key: 'compliance_score',
          type: 'NUMBER',
          label: 'Compliance score (out of 100)',
          description: 'Weighted from the four answers above.',
          pageNumber: 2,
          validation: {},
        },
        {
          id: 'cca_band',
          key: 'compliance_band',
          type: 'SINGLE_CHOICE',
          label: 'RAG band',
          description: 'Derived from the score — a calculation reading another calculation.',
          pageNumber: 2,
          options: choices(['Green', 'Amber', 'Red']),
          validation: {},
        },
        {
          id: 'cca_remarks',
          key: 'remarks',
          type: 'LONG_TEXT',
          label: 'Auditor remarks',
          pageNumber: 2,
          validation: { maxLength: 1000 },
        },
      ],
      rules: [
        {
          id: 'cca_calc_excursion',
          kind: 'CALCULATE',
          target: 'temperature_excursion',
          expr: {
            op: 'if',
            args: [
              {
                op: 'or',
                args: [
                  { op: 'lt', args: [{ field: 'min_temp_c' }, { lit: 2 }] },
                  { op: 'gt', args: [{ field: 'max_temp_c' }, { lit: 8 }] },
                ],
              },
              { lit: 'Yes' },
              { lit: 'No' },
            ],
          },
        },
        {
          id: 'cca_calc_score',
          kind: 'CALCULATE',
          target: 'compliance_score',
          expr: {
            op: 'add',
            args: [
              {
                op: 'if',
                args: [
                  { op: 'eq', args: [{ field: 'temperature_excursion' }, { lit: 'No' }] },
                  { lit: 40 },
                  { lit: 0 },
                ],
              },
              {
                op: 'if',
                args: [
                  { op: 'eq', args: [{ field: 'logbook_maintained' }, { lit: 'Yes' }] },
                  { lit: 30 },
                  { lit: 0 },
                ],
              },
              {
                op: 'if',
                args: [{ op: 'gte', args: [{ field: 'power_backup_hours' }, { lit: 8 }] }, { lit: 20 }, { lit: 0 }],
              },
              {
                op: 'if',
                args: [
                  { op: 'eq', args: [{ field: 'alarm_functional' }, { lit: 'Yes' }] },
                  { lit: 10 },
                  { lit: 0 },
                ],
              },
            ],
          },
        },
        {
          id: 'cca_calc_band',
          kind: 'CALCULATE',
          target: 'compliance_band',
          expr: {
            op: 'if',
            args: [
              { op: 'gte', args: [{ field: 'compliance_score' }, { lit: 80 }] },
              { lit: 'Green' },
              {
                op: 'if',
                args: [
                  { op: 'gte', args: [{ field: 'compliance_score' }, { lit: 50 }] },
                  { lit: 'Amber' },
                  { lit: 'Red' },
                ],
              },
            ],
          },
        },
        {
          id: 'cca_val_range',
          kind: 'VALIDATE',
          target: 'max_temp_c',
          message: 'The maximum temperature cannot be below the minimum.',
          expr: { op: 'lt', args: [{ field: 'max_temp_c' }, { field: 'min_temp_c' }] },
        },
        {
          id: 'cca_val_future',
          kind: 'VALIDATE',
          target: 'audit_date',
          message: 'An audit cannot be dated in the future.',
          expr: { op: 'gt', args: [{ field: 'audit_date' }, { op: 'today', args: [] }] },
        },
        {
          id: 'cca_show_action',
          kind: 'SHOW',
          target: 'immediate_action',
          expr: { op: 'eq', args: [{ field: 'temperature_excursion' }, { lit: 'Yes' }] },
        },
        {
          id: 'cca_require_action',
          kind: 'REQUIRE',
          target: 'immediate_action',
          expr: { op: 'eq', args: [{ field: 'temperature_excursion' }, { lit: 'Yes' }] },
        },
      ],
    },
    {
      slug: 'corrective-action-plan',
      title: 'Corrective Action Plan',
      description: 'One entry per action. Opens only after an audit records an excursion.',
      role: 'ATTACHES',
      settings: { requireAuth: true },
      pages: [{ pageNumber: 1, title: 'Action' }],
      questions: [
        {
          id: 'cap_issue',
          key: 'issue',
          type: 'SHORT_TEXT',
          label: 'Issue',
          validation: { required: true, maxLength: 200 },
        },
        {
          id: 'cap_owner',
          key: 'owner',
          type: 'SHORT_TEXT',
          label: 'Responsible officer',
          validation: { required: true, maxLength: 120 },
        },
        {
          id: 'cap_raised',
          key: 'raised_on',
          type: 'DATE',
          label: 'Raised on',
          defaultValue: TODAY,
          validation: { required: true },
        },
        {
          id: 'cap_due',
          key: 'due_date',
          type: 'DATE',
          label: 'Due by',
          validation: { required: true },
        },
        {
          id: 'cap_status',
          key: 'status',
          type: 'SINGLE_CHOICE',
          label: 'Status',
          options: choices(['Open', 'In progress', 'Closed']),
          validation: { required: true },
        },
        {
          id: 'cap_closed',
          key: 'closed_on',
          type: 'DATE',
          label: 'Closed on',
          validation: {},
        },
        {
          id: 'cap_days',
          key: 'days_allowed',
          type: 'NUMBER',
          label: 'Days allowed',
          description: 'From raised to due.',
          validation: {},
        },
      ],
      rules: [
        {
          id: 'cap_calc_days',
          kind: 'CALCULATE',
          target: 'days_allowed',
          expr: { op: 'daysBetween', args: [{ field: 'raised_on' }, { field: 'due_date' }] },
        },
        {
          id: 'cap_show_closed',
          kind: 'SHOW',
          target: 'closed_on',
          expr: { op: 'eq', args: [{ field: 'status' }, { lit: 'Closed' }] },
        },
        {
          id: 'cap_require_closed',
          kind: 'REQUIRE',
          target: 'closed_on',
          expr: { op: 'eq', args: [{ field: 'status' }, { lit: 'Closed' }] },
        },
        {
          id: 'cap_val_window',
          kind: 'VALIDATE',
          target: 'due_date',
          message: 'A corrective action cannot be scheduled more than 180 days out.',
          expr: { op: 'gt', args: [{ field: 'days_allowed' }, { lit: 180 }] },
        },
        {
          id: 'cap_val_order',
          kind: 'VALIDATE',
          target: 'due_date',
          message: 'The due date must be on or after the date the issue was raised.',
          expr: { op: 'lt', args: [{ field: 'due_date' }, { field: 'raised_on' }] },
        },
      ],
    },
  ],
  steps: [
    {
      key: 'facility',
      formSlug: 'facility-profile',
      title: 'Facility profile',
      description: 'The equipment being audited.',
      icon: '🏭',
      mode: 'SINGLE',
      minEntries: 1,
      maxEntries: 1,
      isOptional: false,
      uniqueBy: [],
    },
    {
      key: 'audits',
      formSlug: 'monthly-cold-chain-audit',
      title: 'Monthly audits',
      description: 'One audit per date.',
      icon: '📋',
      mode: 'REPEATABLE',
      minEntries: 1,
      maxEntries: 12,
      isOptional: false,
      uniqueBy: ['audit_date'],
    },
    {
      key: 'corrective_actions',
      formSlug: 'corrective-action-plan',
      title: 'Corrective actions',
      description: 'Opens when the first audit records a temperature excursion.',
      icon: '🛠️',
      mode: 'REPEATABLE',
      minEntries: 0,
      maxEntries: 5,
      isOptional: true,
      uniqueBy: [],
      showWhen: { op: 'eq', args: [{ field: 'audits.temperature_excursion' }, { lit: 'Yes' }] },
    },
  ],
  // Three periods, two of them closed. Everywhere else in this seed the app has
  // exactly one open window; here the history is the point — a closed period is
  // what makes "last quarter's audits" a query instead of a date range someone
  // has to remember.
  periods: [
    {
      label: MONTH_LABEL(monthStart(-2)),
      startsAt: monthStart(-2),
      endsAt: monthStart(-1),
      isActive: false,
    },
    {
      label: MONTH_LABEL(monthStart(-1)),
      startsAt: monthStart(-1),
      endsAt: monthStart(0),
      isActive: false,
    },
    {
      label: MONTH_LABEL(monthStart(0)),
      startsAt: monthStart(0),
      endsAt: monthStart(1),
      isActive: true,
    },
  ],
  sessions: [
    {
      fingerprint: 'coldchain-demo-1',
      daysAgo: 8,
      entries: [
        {
          stepKey: 'facility',
          answers: {
            facility_code: 'CC-0001',
            facility_name: 'District Vaccine Store, Pune',
            facility_type: 'Walk-in cooler',
            state: 'MH',
            district: 'MH-pune',
            capacity_litres: 4200,
            installed_on: '2019-06-14',
          },
        },
        {
          stepKey: 'audits',
          answers: {
            audit_date: iso(-8),
            min_temp_c: 3,
            max_temp_c: 7,
            compliance_checklist: {
              'Temperature logged twice daily': 'Yes',
              'Thermometer calibrated within 12 months': 'Yes',
              'Vaccines arranged with adequate air flow': 'Yes',
              'No expired stock present': 'Yes',
              'Contingency plan displayed': 'Yes',
              'Voltage stabiliser working': 'Yes',
            } as unknown as RuleValue,
            power_backup_hours: 12,
            logbook_maintained: 'Yes',
            alarm_functional: 'Yes',
            remarks: 'Fully compliant. No action required.',
          },
        },
      ],
    },
    {
      fingerprint: 'coldchain-demo-2',
      daysAgo: 3,
      entries: [
        {
          stepKey: 'facility',
          answers: {
            facility_code: 'CC-0002',
            facility_name: 'PHC Cold Point, Shirur',
            facility_type: 'ILR',
            state: 'MH',
            district: 'MH-pune',
            capacity_litres: 240,
            installed_on: '2014-02-03',
          },
        },
        {
          stepKey: 'audits',
          answers: {
            audit_date: iso(-3),
            min_temp_c: 1,
            max_temp_c: 11,
            immediate_action:
              'Stock moved to the district store the same evening. Stabiliser replaced; vendor called for compressor service.',
            compliance_checklist: {
              'Temperature logged twice daily': 'No',
              'Thermometer calibrated within 12 months': 'Yes',
              'Vaccines arranged with adequate air flow': 'Yes',
              'No expired stock present': 'Yes',
              'Contingency plan displayed': 'No',
              'Voltage stabiliser working': 'No',
            } as unknown as RuleValue,
            power_backup_hours: 4,
            logbook_maintained: 'No',
            alarm_functional: 'No',
            remarks: 'Excursion on both sides of the band. Equipment is 12 years old and due for replacement.',
          },
        },
        {
          stepKey: 'corrective_actions',
          answers: {
            issue: 'Compressor failure causing temperatures outside the 2–8 °C band',
            owner: 'Block Cold Chain Officer',
            raised_on: iso(-3),
            due_date: iso(11),
            status: 'In progress',
          },
        },
        {
          stepKey: 'corrective_actions',
          answers: {
            issue: 'Twice-daily temperature logging not maintained',
            owner: 'PHC Medical Officer',
            raised_on: iso(-3),
            due_date: iso(4),
            status: 'Closed',
            closed_on: iso(-1),
          },
        },
      ],
    },
  ],
};

// ═════════════════════════════════════════════════════════════════════════════
// SCENARIO 5 — Citizen grievance redressal
//
// Anonymous, one sitting, and the only app with no reporting period — a
// complaint arrives when it arrives. The SLA date is derived from the category
// list and the severity, so changing a department's SLA is a data edit.
// ═════════════════════════════════════════════════════════════════════════════

const GRIEVANCE_CATEGORIES: Array<{
  value: string;
  label: string;
  department: string;
  sla: number;
  sub: string[];
}> = [
  {
    value: 'water',
    label: 'Water supply',
    department: 'Public Health Engineering',
    sla: 7,
    sub: ['No supply', 'Contaminated water', 'Leaking pipeline', 'Billing dispute'],
  },
  {
    value: 'electricity',
    label: 'Electricity',
    department: 'Power Distribution',
    sla: 3,
    sub: ['Outage', 'Voltage fluctuation', 'Damaged pole or line', 'Meter fault'],
  },
  {
    value: 'sanitation',
    label: 'Sanitation',
    department: 'Municipal Solid Waste',
    sla: 5,
    sub: ['Garbage not collected', 'Blocked drain', 'Public toilet unusable', 'Dead animal removal'],
  },
  {
    value: 'roads',
    label: 'Roads and footpaths',
    department: 'Public Works',
    sla: 15,
    sub: ['Pothole', 'Broken footpath', 'Street light not working', 'Waterlogging'],
  },
  {
    value: 'health',
    label: 'Health services',
    department: 'District Health Society',
    sla: 5,
    sub: ['Medicine unavailable', 'Staff absent', 'Ambulance delay', 'Cleanliness'],
  },
];

const GRIEVANCE: Scenario = {
  key: 'grievance',
  headline: 'Citizen grievances — anonymous, one sitting, no reporting period',
  subjectType: {
    slug: 'grievance-ticket',
    name: 'Grievance',
    icon: '📮',
    identityConfig: {
      displayName: ['complainant_name'],
      attributes: ['category', 'district', 'priority', 'sla_due_date'],
      externalId: 'ticket_no',
    },
  },
  app: {
    slug: 'grievance-redressal',
    publicSlug: 'grievance',
    name: 'Citizen Grievance Redressal',
    description: 'Register a complaint and track what was done about it.',
    icon: '📮',
    theme: {
      preset: 'purple',
      primaryColor: '#7c3aed',
      backgroundColor: '#faf5ff',
      cardColor: '#ffffff',
      textColor: '#2a1145',
      fontFamily: 'Inter',
      borderRadius: 'full',
      cardVariant: 'card',
      // Appearance: one short complaint from a member of the public. Roomy and
      // unintimidating, with a single brand stripe at the top of the page.
      appMasthead: 'plain',
      appStepStyle: 'plain',
      appDensity: 'spacious',
      appTexture: 'accentBar',
    },
    branding: {
      headerTitle: 'Citizen Grievance Redressal',
      footerText: 'Every complaint gets a ticket number and a due date.',
    },
    // A citizen must not need an account to complain.
    requireAuth: false,
    // No drafts: an anonymous session has nothing durable to resume against,
    // and a half-filed complaint that looks saved but is not is worse than one
    // that had to be finished.
    allowDrafts: false,
    isPublished: true,
    dashboardCards: (formId) => [
      { title: 'Tickets raised', source: 'subjects' },
      { title: 'Raised this week', source: 'subjects', filter: { createdWithinDays: 7 } },
      {
        title: 'Status updates (30 days)',
        source: 'submissions',
        filter: { formId: formId('grievance-status-update'), createdWithinDays: 30 },
      },
    ],
  },
  choiceLists: [
    {
      slug: 'grievance-categories',
      name: 'Grievance categories',
      description:
        'Each category carries its owning department and default SLA. The intake form reads both with `lookup()`, so re-assigning a department never touches the form.',
      metadataSchema: [
        { key: 'department', label: 'Department', type: 'text' },
        { key: 'sla_days', label: 'Default SLA (days)', type: 'number' },
      ],
      items: GRIEVANCE_CATEGORIES.map((category) => ({
        value: category.value,
        label: category.label,
        metadata: { department: category.department, sla_days: category.sla },
      })),
    },
    {
      slug: 'grievance-subcategories',
      name: 'Grievance sub-categories',
      description: 'Cascades from `grievance-categories`.',
      parentSlug: 'grievance-categories',
      metadataSchema: [{ key: 'category', label: 'Category', type: 'text' }],
      items: GRIEVANCE_CATEGORIES.flatMap((category) =>
        category.sub.map((label) => ({
          value: `${category.value}-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
          label,
          parentValue: category.value,
          metadata: { category: category.value },
        })),
      ),
    },
  ],
  knownChoiceLists: ['in-states', 'in-districts', 'grievance-categories', 'grievance-subcategories'],
  forms: [
    {
      slug: 'grievance-intake',
      title: 'Register a Grievance',
      description:
        'Open to any citizen. The department, the SLA and the priority are all derived — nobody chooses their own due date.',
      role: 'REGISTERS',
      settings: {
        requireAuth: false,
        allowMultiple: true,
        notifyEmails: ['grievance-cell@acme.test'],
      },
      pages: [
        { pageNumber: 1, title: 'Your complaint' },
        { pageNumber: 2, title: 'How to reach you' },
      ],
      questions: [
        {
          id: 'grv_ticket',
          key: 'ticket_no',
          type: 'SHORT_TEXT',
          label: 'Ticket number',
          description: 'Issued at the counter, or generated for an online complaint.',
          placeholder: 'GRV-2026-000001',
          pageNumber: 1,
          validation: { required: true, pattern: '^GRV-[0-9]{4}-[0-9]{6}$' },
        },
        {
          id: 'grv_name',
          key: 'complainant_name',
          type: 'SHORT_TEXT',
          label: 'Your name',
          pageNumber: 1,
          validation: { required: true, maxLength: 120 },
        },
        {
          id: 'grv_received',
          key: 'received_on',
          type: 'DATE',
          label: 'Date received',
          defaultValue: TODAY,
          pageNumber: 1,
          validation: { required: true },
        },
        {
          id: 'grv_cat',
          key: 'category',
          type: 'DROPDOWN',
          label: 'Category',
          pageNumber: 1,
          validation: { required: true },
          optionsSource: { kind: 'CHOICE_LIST', listSlug: 'grievance-categories', searchable: true },
        },
        {
          id: 'grv_sub',
          key: 'sub_category',
          type: 'DROPDOWN',
          label: 'Sub-category',
          pageNumber: 1,
          validation: { required: true },
          optionsSource: {
            kind: 'CHOICE_LIST',
            listSlug: 'grievance-subcategories',
            parentQuestionKey: 'category',
          },
        },
        {
          id: 'grv_sev',
          key: 'severity',
          type: 'SINGLE_CHOICE',
          label: 'How severe is it?',
          pageNumber: 1,
          options: choices(['Low', 'Medium', 'High', 'Critical']),
          validation: { required: true },
        },
        {
          id: 'grv_desc',
          key: 'description',
          type: 'LONG_TEXT',
          label: 'What happened?',
          description: 'At least 30 characters, so the department has something to act on.',
          pageNumber: 1,
          validation: { required: true, minLength: 30, maxLength: 2000 },
        },
        {
          id: 'grv_dept',
          key: 'department',
          type: 'SHORT_TEXT',
          label: 'Assigned department',
          description: 'Read from the category list.',
          pageNumber: 1,
          validation: {},
        },
        {
          id: 'grv_sla',
          key: 'sla_days',
          type: 'NUMBER',
          label: 'SLA (days)',
          description: 'A critical or high complaint overrides the category default.',
          pageNumber: 1,
          validation: {},
        },
        {
          id: 'grv_due',
          key: 'sla_due_date',
          type: 'DATE',
          label: 'Due by',
          description: 'Received date plus the SLA — a calculation reading another calculation.',
          pageNumber: 1,
          validation: {},
        },
        {
          id: 'grv_priority',
          key: 'priority',
          type: 'SINGLE_CHOICE',
          label: 'Priority',
          pageNumber: 1,
          options: choices(['P1', 'P2', 'P3']),
          validation: {},
        },
        {
          id: 'grv_state',
          key: 'state',
          type: 'DROPDOWN',
          label: 'State',
          pageNumber: 2,
          validation: { required: true },
          optionsSource: { kind: 'CHOICE_LIST', listSlug: 'in-states', searchable: true },
        },
        {
          id: 'grv_district',
          key: 'district',
          type: 'DROPDOWN',
          label: 'District',
          pageNumber: 2,
          validation: { required: true },
          optionsSource: {
            kind: 'CHOICE_LIST',
            listSlug: 'in-districts',
            parentQuestionKey: 'state',
            searchable: true,
          },
        },
        {
          id: 'grv_locality',
          key: 'locality',
          type: 'SHORT_TEXT',
          label: 'Locality or ward',
          pageNumber: 2,
          validation: { required: true, maxLength: 160 },
        },
        {
          id: 'grv_contact',
          key: 'contact_preference',
          type: 'SINGLE_CHOICE',
          label: 'How should we reach you?',
          pageNumber: 2,
          options: choices(['Phone', 'Email', 'Do not contact me']),
          validation: { required: true },
        },
        {
          id: 'grv_phone',
          key: 'phone',
          type: 'PHONE',
          label: 'Mobile number',
          pageNumber: 2,
          validation: { pattern: '^[6-9][0-9]{9}$' },
        },
        {
          id: 'grv_email',
          key: 'email',
          type: 'EMAIL',
          label: 'Email',
          pageNumber: 2,
          validation: {},
        },
        {
          id: 'grv_file',
          key: 'attachment',
          type: 'FILE_UPLOAD',
          label: 'Photograph or document',
          pageNumber: 2,
          validation: { maxSizeMb: 10, allowedTypes: ['image/jpeg', 'image/png', 'application/pdf'] },
        },
      ],
      rules: [
        {
          id: 'grv_calc_dept',
          kind: 'CALCULATE',
          target: 'department',
          expr: {
            op: 'lookup',
            args: [{ lit: 'grievance-categories' }, { field: 'category' }, { lit: 'department' }],
          },
        },
        // Severity overrides the category default, and the category default is
        // itself a lookup — one expression, no per-category branch.
        {
          id: 'grv_calc_sla',
          kind: 'CALCULATE',
          target: 'sla_days',
          expr: {
            op: 'if',
            args: [
              { op: 'eq', args: [{ field: 'severity' }, { lit: 'Critical' }] },
              { lit: 1 },
              {
                op: 'if',
                args: [
                  { op: 'eq', args: [{ field: 'severity' }, { lit: 'High' }] },
                  { lit: 3 },
                  {
                    op: 'lookup',
                    args: [{ lit: 'grievance-categories' }, { field: 'category' }, { lit: 'sla_days' }],
                  },
                ],
              },
            ],
          },
        },
        {
          id: 'grv_calc_due',
          kind: 'CALCULATE',
          target: 'sla_due_date',
          expr: { op: 'addDays', args: [{ field: 'received_on' }, { field: 'sla_days' }] },
        },
        {
          id: 'grv_calc_priority',
          kind: 'CALCULATE',
          target: 'priority',
          expr: {
            op: 'if',
            args: [
              { op: 'lte', args: [{ field: 'sla_days' }, { lit: 1 }] },
              { lit: 'P1' },
              {
                op: 'if',
                args: [{ op: 'lte', args: [{ field: 'sla_days' }, { lit: 3 }] }, { lit: 'P2' }, { lit: 'P3' }],
              },
            ],
          },
        },
        {
          id: 'grv_show_phone',
          kind: 'SHOW',
          target: 'phone',
          expr: { op: 'eq', args: [{ field: 'contact_preference' }, { lit: 'Phone' }] },
        },
        {
          id: 'grv_require_phone',
          kind: 'REQUIRE',
          target: 'phone',
          expr: { op: 'eq', args: [{ field: 'contact_preference' }, { lit: 'Phone' }] },
        },
        {
          id: 'grv_show_email',
          kind: 'SHOW',
          target: 'email',
          expr: { op: 'eq', args: [{ field: 'contact_preference' }, { lit: 'Email' }] },
        },
        {
          id: 'grv_require_email',
          kind: 'REQUIRE',
          target: 'email',
          expr: { op: 'eq', args: [{ field: 'contact_preference' }, { lit: 'Email' }] },
        },
        // `minLength` on the field is the control's own limit; this is the same
        // rule stated where the respondent-facing message can explain itself.
        {
          id: 'grv_val_desc',
          kind: 'VALIDATE',
          target: 'description',
          message: 'Please describe the problem in at least 30 characters so it can be assigned.',
          expr: { op: 'lt', args: [{ op: 'length', args: [{ field: 'description' }] }, { lit: 30 }] },
        },
        {
          id: 'grv_val_received',
          kind: 'VALIDATE',
          target: 'received_on',
          message: 'A complaint cannot be dated in the future.',
          expr: { op: 'gt', args: [{ field: 'received_on' }, { op: 'today', args: [] }] },
        },
      ],
    },
    {
      slug: 'grievance-status-update',
      title: 'Status Update',
      description: 'Filed by the handling department. Days elapsed is measured against the intake, not re-typed.',
      role: 'ATTACHES',
      settings: { requireAuth: true },
      pages: [{ pageNumber: 1, title: 'Update' }],
      questions: [
        {
          id: 'gsu_date',
          key: 'update_date',
          type: 'DATE',
          label: 'Update date',
          defaultValue: TODAY,
          validation: { required: true },
        },
        {
          id: 'gsu_status',
          key: 'status',
          type: 'SINGLE_CHOICE',
          label: 'Status',
          options: choices(['Received', 'Under review', 'Action taken', 'Resolved', 'Rejected']),
          validation: { required: true },
        },
        {
          id: 'gsu_officer',
          key: 'officer',
          type: 'SHORT_TEXT',
          label: 'Handling officer',
          validation: { required: true, maxLength: 120 },
        },
        {
          id: 'gsu_note',
          key: 'note',
          type: 'LONG_TEXT',
          label: 'What was done',
          validation: { required: true, maxLength: 1000 },
        },
        {
          id: 'gsu_reason',
          key: 'rejection_reason',
          type: 'LONG_TEXT',
          label: 'Reason for rejection',
          description: 'Required when a complaint is rejected, so the citizen gets an explanation.',
          validation: { maxLength: 1000 },
        },
        {
          id: 'gsu_days',
          key: 'days_since_receipt',
          type: 'NUMBER',
          label: 'Days since the complaint was received',
          description: 'Measured against the intake form.',
          validation: {},
        },
      ],
      rules: [
        {
          id: 'gsu_calc_days',
          kind: 'CALCULATE',
          target: 'days_since_receipt',
          expr: {
            op: 'daysBetween',
            args: [
              { ref: { form: '@grievance-intake', question: 'received_on', when: 'REGISTRATION' } },
              { field: 'update_date' },
            ],
          },
        },
        {
          id: 'gsu_show_reason',
          kind: 'SHOW',
          target: 'rejection_reason',
          expr: { op: 'eq', args: [{ field: 'status' }, { lit: 'Rejected' }] },
        },
        {
          id: 'gsu_require_reason',
          kind: 'REQUIRE',
          target: 'rejection_reason',
          expr: { op: 'eq', args: [{ field: 'status' }, { lit: 'Rejected' }] },
        },
        {
          id: 'gsu_val_order',
          kind: 'VALIDATE',
          target: 'update_date',
          message: 'An update cannot be dated before the complaint was received.',
          expr: { op: 'lt', args: [{ field: 'days_since_receipt' }, { lit: 0 }] },
        },
      ],
    },
  ],
  steps: [
    {
      key: 'intake',
      formSlug: 'grievance-intake',
      title: 'Your complaint',
      description: 'Filed once. You get a ticket number and a due date.',
      icon: '📝',
      mode: 'SINGLE',
      minEntries: 1,
      maxEntries: 1,
      isOptional: false,
      uniqueBy: [],
    },
    {
      key: 'updates',
      formSlug: 'grievance-status-update',
      title: 'Status updates',
      description: 'Added by the department as the complaint moves.',
      icon: '🔄',
      mode: 'REPEATABLE',
      minEntries: 0,
      maxEntries: 10,
      isOptional: true,
      uniqueBy: [],
    },
  ],
  // Deliberately none. A grievance is not filed against a reporting window, and
  // inventing one would put every ticket in a bucket nobody asked for.
  periods: [],
  sessions: [
    {
      fingerprint: 'grievance-demo-1',
      daysAgo: 11,
      entries: [
        {
          stepKey: 'intake',
          answers: {
            ticket_no: 'GRV-2026-000001',
            complainant_name: 'Farhan Qureshi',
            received_on: iso(-11),
            category: 'electricity',
            sub_category: 'electricity-voltage-fluctuation',
            severity: 'High',
            description:
              'Voltage has been fluctuating badly every evening for the past two weeks. Two ceiling fans and a refrigerator in the building have already been damaged.',
            state: 'UP',
            district: 'UP-lucknow',
            locality: 'Gomti Nagar, Vibhuti Khand',
            contact_preference: 'Phone',
            phone: '9876501234',
          },
        },
        {
          stepKey: 'updates',
          answers: {
            update_date: iso(-9),
            status: 'Under review',
            officer: 'Assistant Engineer, Gomti Nagar sub-division',
            note: 'Site inspected. Transformer tap setting found incorrect; load survey scheduled.',
          },
        },
        {
          stepKey: 'updates',
          answers: {
            update_date: iso(-6),
            status: 'Resolved',
            officer: 'Assistant Engineer, Gomti Nagar sub-division',
            note: 'Tap setting corrected and stabiliser installed at the distribution point. Complainant confirmed supply is steady.',
          },
        },
      ],
    },
    {
      fingerprint: 'grievance-demo-2',
      daysAgo: 4,
      entries: [
        {
          stepKey: 'intake',
          answers: {
            ticket_no: 'GRV-2026-000002',
            complainant_name: 'Sujata Bose',
            received_on: iso(-4),
            category: 'sanitation',
            sub_category: 'sanitation-blocked-drain',
            severity: 'Medium',
            description:
              'The storm drain along the lane has been blocked since the last rain and is overflowing onto the road outside the school gate.',
            state: 'WB',
            district: 'WB-kolkata',
            locality: 'Ward 68, Jadavpur',
            contact_preference: 'Email',
            email: 'sujata.bose@example.com',
          },
        },
        {
          stepKey: 'updates',
          answers: {
            update_date: iso(-2),
            status: 'Action taken',
            officer: 'Ward Sanitation Supervisor',
            note: 'Drain cleared by the mechanical team. Silt removal scheduled for the full lane next week.',
          },
        },
      ],
    },
  ],
};

// ═════════════════════════════════════════════════════════════════════════════
// SCENARIO 6 — ALAMB Vocational Training Programme
//
// Longitudinal training lifecycle. A student is registered once, enrolled in a
// 6-month vocational course, tracked monthly for attendance and progress,
// assessed at mid-term and final, then followed up for employment outcomes.
//
// The interesting parts:
//   • The progress form reads the enrollment's `course_selected` via a cross-
//     form `ref` to decide which skill multi-choice to show — a Computer
//     student never sees the Beautician checklist.
//   • Attendance percentage and assessment grades are both CALCULATED, so the
//     field worker types only the raw numbers and the derived fields fill in.
//   • Total family members is calculated from siblings + 3 (student + parents).
//   • Guardian details are a two-level conditional: show the group only when
//     `has_guardian` is Yes, then inside it, show `guardian_other_occupation`
//     only when `guardian_occupation` is Other.
// ═════════════════════════════════════════════════════════════════════════════

const ALAMB_AREAS = [
  'Shiv Vihar',
  'Om Vihar Phase-1',
  'Om Vihar Phase-2',
  'Om Vihar Phase-3',
  'Om Vihar Phase-4',
  'Om Vihar Phase-5',
  'Mohan Garden',
  'Vijay Nagar',
  'Vikas Nagar',
  'Maharani Enclave',
  'Hastsal',
  'Other',
];

const ALAMB_COURSE_DATA: Array<{
  value: string;
  label: string;
  code: string;
  duration: number;
}> = [
  { value: 'computer', label: 'Computer', code: 'Comp', duration: 6 },
  { value: 'beautician', label: 'Beautician', code: 'B & C', duration: 6 },
  { value: 'cutting_tailoring', label: 'Cutting & Tailoring', code: 'C & T', duration: 6 },
];

const ALAMB_OCCUPATIONS = [
  'Driver',
  'Labour',
  'Mason',
  'Carpenter',
  'Electrician',
  'Plumber',
  'Painter',
  'Factory Worker',
  'Shop Owner',
  'Vegetable Vendor',
  'Food Vendor',
  'Security Guard',
  'Office Job',
  'Self Employed',
  'Not Working',
  'Deceased',
  'Other',
];

const ALAMB_MOTHER_OCCUPATIONS = [
  'Homemaker',
  'Tailor',
  'Domestic Worker',
  'Labour',
  'Shop Worker',
  'Self Employed',
  'Other',
];

const ALAMB: Scenario = {
  key: 'alamb',
  headline: 'ALAMB vocational training — longitudinal programme with course-conditional skills',
  subjectType: {
    slug: 'alamb-student',
    name: 'Student',
    icon: '👩‍🎓',
    identityConfig: {
      displayName: ['full_name'],
      attributes: ['age', 'gender', 'area', 'course_selected'],
      externalId: 'registration_number',
    },
  },
  app: {
    slug: 'alamb-vocational',
    publicSlug: 'alamb-vocational',
    name: 'ALAMB Vocational Training Programme',
    description:
      'Register a student, enroll in a vocational course, track monthly progress and attendance, conduct skill assessments, and follow up on employment outcomes after completion.',
    icon: '👩‍🎓',
    theme: {
      preset: 'teal',
      primaryColor: '#0d9488',
      backgroundColor: '#f0fdfa',
      cardColor: '#ffffff',
      textColor: '#134e4a',
      fontFamily: 'Inter',
      borderRadius: 'lg',
      cardVariant: 'elevated',
      // A field worker walks through the programme once per student —
      // registration, enrollment, progress checks, assessments, exit,
      // follow-ups — so it is paged as a wizard with timeline markers.
      appShell: 'wizard',
      appMasthead: 'gradient',
      appStepStyle: 'timeline',
      appDensity: 'comfortable',
      appTexture: 'none',
    },
    branding: {
      headerTitle: 'ALAMB Vocational Training Programme',
      footerText: 'ALAMB · Supported by Vibha · Delhi',
    },
    // Public: the link is shared openly so coordinators and field workers can
    // reach it from any device without signing in first.
    requireAuth: false,
    // Field workers doing home visits are interrupted constantly.
    allowDrafts: true,
    isPublished: true,
    // Each form has its own layout: registration is GRID (paired fields),
    // progress and assessment are stacked DOCUMENT.
    layoutMode: 'INHERIT',
    // A monthly progress check needs a monthly cycle. Under FIXED that means
    // twelve hand-made windows a year and a programme that locks every field
    // worker out on the 1st; under RECURRING the current month is computed and
    // being between months is ordinary.
    //
    // Ten days of grace with one earlier cycle offered: a worker who visited on
    // the 28th and reaches a keyboard on the 3rd files it under the month it
    // happened, which is the single most common correction in field data.
    periodMode: 'RECURRING',
    periodConfig: {
      cadence: 'MONTHLY',
      graceDays: 10,
      backfillPeriods: 1,
    },
    dashboardCards: (formId) => [
      { title: 'Students registered', source: 'subjects' },
      { title: 'Enrolled this batch', source: 'subjects', filter: { createdWithinDays: 180 } },
      {
        title: 'Progress checks (30 days)',
        source: 'submissions',
        filter: { formId: formId('alamb-monthly-progress'), createdWithinDays: 30 },
      },
      {
        title: 'Assessments completed',
        source: 'submissions',
        filter: { formId: formId('alamb-skill-assessment') },
      },
      {
        title: 'Placements tracked',
        source: 'submissions',
        filter: { formId: formId('alamb-placement-followup') },
      },
    ],
  },

  // ── Choice lists ──────────────────────────────────────────────────────────
  choiceLists: [
    {
      slug: 'alamb-areas',
      name: 'ALAMB Areas — Delhi',
      description:
        'Neighbourhoods around the ALAMB training centre in West Delhi. Used as a dropdown in the registration form.',
      metadataSchema: [
        { key: 'pin_code', label: 'PIN Code', type: 'text' },
      ],
      items: ALAMB_AREAS.map((area) => ({
        value: area.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
        label: area,
        metadata: { pin_code: '110059' },
      })),
    },
    {
      slug: 'alamb-courses',
      name: 'ALAMB Courses',
      description:
        'The three vocational courses offered. `lookup()` reads the course code and duration for batch ID generation.',
      metadataSchema: [
        { key: 'course_code', label: 'Course Code', type: 'text' },
        { key: 'duration_months', label: 'Duration (months)', type: 'number' },
      ],
      items: ALAMB_COURSE_DATA.map((course) => ({
        value: course.value,
        label: course.label,
        metadata: { course_code: course.code, duration_months: course.duration },
      })),
    },
  ],
  knownChoiceLists: ['alamb-areas', 'alamb-courses'],

  // ── Forms ─────────────────────────────────────────────────────────────────
  forms: [
    // ─── Form 1: Student Registration ───────────────────────────────────────
    {
      slug: 'alamb-registration',
      title: 'Student Registration',
      description:
        'Completed once when the student enrols at the centre. Age and total family members are calculated; guardian details appear only when a guardian exists.',
      role: 'REGISTERS',
      settings: { requireAuth: false, allowMultiple: true, layoutMode: 'GRID' },
      pages: [
        { pageNumber: 1, title: 'Personal Details', description: 'Identity and contact information.' },
        { pageNumber: 2, title: 'Education' },
        { pageNumber: 3, title: 'Family Details' },
        { pageNumber: 4, title: 'Guardian Details', description: 'Only if someone other than the parents is the guardian.' },
      ],
      questions: [
        // ── Page 1: Personal Details ──
        {
          id: 'alm_r_regnum',
          key: 'registration_number',
          type: 'SHORT_TEXT',
          label: 'Registration Number',
          description: 'Format: ALAMB/YYYY/XXXX. This is the student\'s unique identifier.',
          placeholder: 'ALAMB/2026/0001',
          pageNumber: 1,
          width: 'HALF',
          validation: { required: true, pattern: '^ALAMB/[0-9]{4}/[0-9]{4}$' },
        },
        {
          id: 'alm_r_name',
          key: 'full_name',
          type: 'SHORT_TEXT',
          label: 'Full Name',
          pageNumber: 1,
          width: 'HALF',
          validation: { required: true, minLength: 3, maxLength: 120 },
        },
        {
          id: 'alm_r_dob',
          key: 'date_of_birth',
          type: 'DATE',
          label: 'Date of Birth',
          pageNumber: 1,
          width: 'HALF',
          validation: { required: true },
        },
        {
          id: 'alm_r_age',
          key: 'age',
          type: 'NUMBER',
          label: 'Age (years)',
          description: 'Calculated from date of birth.',
          pageNumber: 1,
          width: 'HALF',
          validation: {},
        },
        {
          id: 'alm_r_gender',
          key: 'gender',
          type: 'SINGLE_CHOICE',
          label: 'Gender',
          pageNumber: 1,
          width: 'HALF',
          options: choices(['Female', 'Male', 'Other']),
          validation: { required: true },
        },
        {
          id: 'alm_r_phone',
          key: 'contact_number',
          type: 'PHONE',
          label: 'Contact Number',
          pageNumber: 1,
          width: 'HALF',
          validation: { required: true, pattern: '^[6-9][0-9]{9}$' },
        },
        {
          id: 'alm_r_altphone',
          key: 'alternate_contact',
          type: 'PHONE',
          label: 'Alternate Contact Number',
          pageNumber: 1,
          width: 'HALF',
          validation: { pattern: '^[6-9][0-9]{9}$' },
        },
        {
          id: 'alm_r_address',
          key: 'address',
          type: 'LONG_TEXT',
          label: 'Address',
          pageNumber: 1,
          width: 'FULL',
          validation: { required: true, maxLength: 500 },
        },
        {
          id: 'alm_r_area',
          key: 'area',
          type: 'DROPDOWN',
          label: 'Area',
          pageNumber: 1,
          width: 'HALF',
          validation: { required: true },
          optionsSource: { kind: 'CHOICE_LIST', listSlug: 'alamb-areas', searchable: true },
        },
        {
          id: 'alm_r_otherarea',
          key: 'other_area',
          type: 'SHORT_TEXT',
          label: 'Other Area (specify)',
          pageNumber: 1,
          width: 'HALF',
          validation: { maxLength: 120 },
        },
        {
          id: 'alm_r_idtype',
          key: 'id_proof_type',
          type: 'SINGLE_CHOICE',
          label: 'ID Proof Type',
          pageNumber: 1,
          width: 'HALF',
          options: choices(['Aadhar Card', 'Voter ID', 'Ration Card', 'Other']),
          validation: { required: true },
        },
        {
          id: 'alm_r_idnum',
          key: 'id_proof_number',
          type: 'SHORT_TEXT',
          label: 'ID Proof Number',
          pageNumber: 1,
          width: 'HALF',
          validation: { required: true, maxLength: 40 },
        },

        // ── Page 2: Education ──
        {
          id: 'alm_r_qual',
          key: 'highest_qualification',
          type: 'SINGLE_CHOICE',
          label: 'Highest Qualification',
          pageNumber: 2,
          options: choices([
            'Illiterate', '5th', '8th', '9th', '10th', '11th', '12th',
            'ITI/Diploma', 'Graduation', 'Post Graduation',
          ]),
          validation: { required: true },
        },
        {
          id: 'alm_r_studying',
          key: 'currently_studying',
          type: 'SINGLE_CHOICE',
          label: 'Currently Pursuing Studies',
          pageNumber: 2,
          options: YES_NO(),
          validation: {},
        },
        {
          id: 'alm_r_studydetail',
          key: 'current_study_details',
          type: 'SHORT_TEXT',
          label: 'Current Study Details',
          description: 'Asked only when the student is currently studying.',
          pageNumber: 2,
          validation: { maxLength: 200 },
        },

        // ── Page 3: Family Details ──
        {
          id: 'alm_r_reltype',
          key: 'relationship_type',
          type: 'SINGLE_CHOICE',
          label: 'Relationship Type',
          pageNumber: 3,
          width: 'HALF',
          options: choices(['D/O (Daughter of Father)', 'W/O (Wife of Husband)']),
          validation: { required: true },
        },
        {
          id: 'alm_r_fathname',
          key: 'father_husband_name',
          type: 'SHORT_TEXT',
          label: 'Father / Husband Name',
          pageNumber: 3,
          width: 'HALF',
          validation: { required: true, maxLength: 120 },
        },
        {
          id: 'alm_r_fathocc',
          key: 'father_husband_occupation',
          type: 'SINGLE_CHOICE',
          label: 'Father / Husband Occupation',
          pageNumber: 3,
          width: 'HALF',
          options: choices(ALAMB_OCCUPATIONS),
          validation: { required: true },
        },
        {
          id: 'alm_r_fathocc_other',
          key: 'father_husband_occupation_other',
          type: 'SHORT_TEXT',
          label: 'Other Occupation (specify)',
          pageNumber: 3,
          width: 'HALF',
          validation: { maxLength: 120 },
        },
        {
          id: 'alm_r_fathphone',
          key: 'father_husband_contact',
          type: 'PHONE',
          label: 'Father / Husband Contact',
          pageNumber: 3,
          width: 'HALF',
          validation: { pattern: '^[6-9][0-9]{9}$' },
        },
        {
          id: 'alm_r_mothname',
          key: 'mother_name',
          type: 'SHORT_TEXT',
          label: 'Mother Name',
          pageNumber: 3,
          width: 'HALF',
          validation: { required: true, maxLength: 120 },
        },
        {
          id: 'alm_r_mothocc',
          key: 'mother_occupation',
          type: 'SINGLE_CHOICE',
          label: 'Mother Occupation',
          pageNumber: 3,
          width: 'HALF',
          options: choices(ALAMB_MOTHER_OCCUPATIONS),
          validation: {},
        },
        {
          id: 'alm_r_mothphone',
          key: 'mother_contact',
          type: 'PHONE',
          label: 'Mother Contact',
          pageNumber: 3,
          width: 'HALF',
          validation: { pattern: '^[6-9][0-9]{9}$' },
        },
        {
          id: 'alm_r_income',
          key: 'monthly_family_income',
          type: 'SINGLE_CHOICE',
          label: 'Monthly Family Income',
          pageNumber: 3,
          width: 'HALF',
          options: choices([
            'Less than ₹5,000',
            '₹5,000-8,000',
            '₹8,000-10,000',
            '₹10,000-15,000',
            '₹15,000-25,000',
            'Above ₹25,000',
          ]),
          validation: { required: true },
        },
        {
          id: 'alm_r_brothers',
          key: 'number_of_brothers',
          type: 'NUMBER',
          label: 'Number of Brothers',
          pageNumber: 3,
          width: 'HALF',
          validation: { required: true, min: 0, max: 10 },
        },
        {
          id: 'alm_r_sisters',
          key: 'number_of_sisters',
          type: 'NUMBER',
          label: 'Number of Sisters',
          pageNumber: 3,
          width: 'HALF',
          validation: { required: true, min: 0, max: 10 },
        },
        {
          id: 'alm_r_totalfam',
          key: 'total_family_members',
          type: 'NUMBER',
          label: 'Total Family Members',
          description: 'Calculated: brothers + sisters + 3 (student + parents).',
          pageNumber: 3,
          width: 'HALF',
          validation: {},
        },

        // ── Page 4: Guardian Details ──
        {
          id: 'alm_r_hasguardian',
          key: 'has_guardian',
          type: 'SINGLE_CHOICE',
          label: 'Has a guardian (other than parents)?',
          pageNumber: 4,
          options: YES_NO(),
          validation: {},
        },
        {
          id: 'alm_r_guardname',
          key: 'guardian_name',
          type: 'SHORT_TEXT',
          label: 'Guardian Name',
          pageNumber: 4,
          width: 'HALF',
          validation: { maxLength: 120 },
        },
        {
          id: 'alm_r_guardrel',
          key: 'guardian_relationship',
          type: 'SINGLE_CHOICE',
          label: 'Guardian Relationship',
          pageNumber: 4,
          width: 'HALF',
          options: choices(['Elder Brother', 'Uncle', 'Aunt', 'Grandparent', 'Other']),
          validation: {},
        },
        {
          id: 'alm_r_guardphone',
          key: 'guardian_contact',
          type: 'PHONE',
          label: 'Guardian Contact',
          pageNumber: 4,
          width: 'HALF',
          validation: { pattern: '^[6-9][0-9]{9}$' },
        },
      ],
      rules: [
        // Age from DOB
        {
          id: 'alm_r_calc_age',
          kind: 'CALCULATE',
          target: 'age',
          expr: { op: 'yearsBetween', args: [{ field: 'date_of_birth' }, { op: 'today', args: [] }] },
        },
        // Total family members = brothers + sisters + 3
        {
          id: 'alm_r_calc_family',
          kind: 'CALCULATE',
          target: 'total_family_members',
          expr: {
            op: 'add',
            args: [
              { field: 'number_of_brothers' },
              { field: 'number_of_sisters' },
              { lit: 3 },
            ],
          },
        },
        // Validate age 15–60
        {
          id: 'alm_r_val_age',
          kind: 'VALIDATE',
          target: 'date_of_birth',
          message: 'The date of birth gives an age outside 15–60. ALAMB serves young women aged 15–35, check the year.',
          expr: {
            op: 'not',
            args: [{ op: 'between', args: [{ field: 'age' }, { lit: 15 }, { lit: 60 }] }],
          },
        },
        // Validate DOB not in the future
        {
          id: 'alm_r_val_dob',
          kind: 'VALIDATE',
          target: 'date_of_birth',
          message: 'Date of birth cannot be in the future.',
          expr: { op: 'gt', args: [{ field: 'date_of_birth' }, { op: 'today', args: [] }] },
        },
        // Show other_area when area = 'other'
        {
          id: 'alm_r_show_otherarea',
          kind: 'SHOW',
          target: 'other_area',
          expr: { op: 'eq', args: [{ field: 'area' }, { lit: 'other' }] },
        },
        {
          id: 'alm_r_require_otherarea',
          kind: 'REQUIRE',
          target: 'other_area',
          expr: { op: 'eq', args: [{ field: 'area' }, { lit: 'other' }] },
        },
        // Show father/husband other occupation
        {
          id: 'alm_r_show_fathocc',
          kind: 'SHOW',
          target: 'father_husband_occupation_other',
          expr: { op: 'eq', args: [{ field: 'father_husband_occupation' }, { lit: 'Other' }] },
        },
        {
          id: 'alm_r_require_fathocc',
          kind: 'REQUIRE',
          target: 'father_husband_occupation_other',
          expr: { op: 'eq', args: [{ field: 'father_husband_occupation' }, { lit: 'Other' }] },
        },
        // Show current study details when currently_studying = Yes
        {
          id: 'alm_r_show_study',
          kind: 'SHOW',
          target: 'current_study_details',
          expr: { op: 'eq', args: [{ field: 'currently_studying' }, { lit: 'Yes' }] },
        },
        // Show/require guardian fields when has_guardian = Yes
        {
          id: 'alm_r_show_guardname',
          kind: 'SHOW',
          target: 'guardian_name',
          expr: { op: 'eq', args: [{ field: 'has_guardian' }, { lit: 'Yes' }] },
        },
        {
          id: 'alm_r_require_guardname',
          kind: 'REQUIRE',
          target: 'guardian_name',
          expr: { op: 'eq', args: [{ field: 'has_guardian' }, { lit: 'Yes' }] },
        },
        {
          id: 'alm_r_show_guardrel',
          kind: 'SHOW',
          target: 'guardian_relationship',
          expr: { op: 'eq', args: [{ field: 'has_guardian' }, { lit: 'Yes' }] },
        },
        {
          id: 'alm_r_require_guardrel',
          kind: 'REQUIRE',
          target: 'guardian_relationship',
          expr: { op: 'eq', args: [{ field: 'has_guardian' }, { lit: 'Yes' }] },
        },
        {
          id: 'alm_r_show_guardphone',
          kind: 'SHOW',
          target: 'guardian_contact',
          expr: { op: 'eq', args: [{ field: 'has_guardian' }, { lit: 'Yes' }] },
        },
        {
          id: 'alm_r_require_guardphone',
          kind: 'REQUIRE',
          target: 'guardian_contact',
          expr: { op: 'eq', args: [{ field: 'has_guardian' }, { lit: 'Yes' }] },
        },
      ],
    },

    // ─── Form 2: Course Enrollment ──────────────────────────────────────────
    {
      slug: 'alamb-enrollment',
      title: 'Course Enrollment',
      description:
        'Enroll the student in a vocational course. The course code is derived from the course list. Preferred job type appears only when the student is interested in employment.',
      role: 'ATTACHES',
      settings: { requireAuth: false },
      pages: [
        { pageNumber: 1, title: 'Course Selection' },
        { pageNumber: 2, title: 'Job Interest & Referral' },
      ],
      questions: [
        {
          id: 'alm_e_course',
          key: 'course_selected',
          type: 'DROPDOWN',
          label: 'Course Selected',
          pageNumber: 1,
          validation: { required: true },
          optionsSource: { kind: 'CHOICE_LIST', listSlug: 'alamb-courses', searchable: false },
        },
        {
          id: 'alm_e_batch',
          key: 'batch',
          type: 'SINGLE_CHOICE',
          label: 'Batch',
          pageNumber: 1,
          options: choices([
            'January-June 2025',
            'July-December 2025',
            'January-June 2026',
            'July-December 2026',
          ]),
          validation: { required: true },
        },
        {
          id: 'alm_e_admission',
          key: 'date_of_admission',
          type: 'DATE',
          label: 'Date of Admission',
          defaultValue: TODAY,
          pageNumber: 1,
          validation: { required: true },
        },
        {
          id: 'alm_e_batchid',
          key: 'batch_id',
          type: 'SHORT_TEXT',
          label: 'Batch ID',
          description: 'Derived from the course code and batch period.',
          pageNumber: 1,
          validation: {},
        },
        {
          id: 'alm_e_course_code',
          key: 'course_code',
          type: 'SHORT_TEXT',
          label: 'Course Code',
          description: 'Looked up from the course list.',
          pageNumber: 1,
          validation: {},
        },
        // ── Page 2: Job Interest ──
        {
          id: 'alm_e_jobint',
          key: 'interested_in_job',
          type: 'SINGLE_CHOICE',
          label: 'Interested in Job after Course',
          pageNumber: 2,
          options: choices([
            'Yes - Immediate',
            'Yes - After some time',
            'No - Will continue studies',
            'No - Home responsibilities',
            'Undecided',
          ]),
          validation: { required: true },
        },
        {
          id: 'alm_e_jobtype',
          key: 'preferred_job_type',
          type: 'MULTI_CHOICE',
          label: 'Preferred Job Type',
          description: 'Shown only when the student is interested in employment.',
          pageNumber: 2,
          options: choices([
            'Beauty Parlour',
            'Boutique/Tailor Shop',
            'Office/Company',
            'Home-based work',
            'Teaching/Training',
            'Self-employment',
          ]),
          validation: {},
        },
        {
          id: 'alm_e_referral',
          key: 'referral_source',
          type: 'SINGLE_CHOICE',
          label: 'How did you learn about ALAMB?',
          pageNumber: 2,
          options: choices([
            'Friend/Family',
            'Community meeting',
            'Social media',
            'Banner/Poster',
            'School/College',
            'Other',
          ]),
          validation: {},
        },
      ],
      rules: [
        // Lookup the course code from the courses list
        {
          id: 'alm_e_calc_code',
          kind: 'CALCULATE',
          target: 'course_code',
          expr: {
            op: 'lookup',
            args: [{ lit: 'alamb-courses' }, { field: 'course_selected' }, { lit: 'course_code' }],
          },
        },
        // Validate admission date not in the future
        {
          id: 'alm_e_val_admission',
          kind: 'VALIDATE',
          target: 'date_of_admission',
          message: 'Admission date cannot be in the future.',
          expr: { op: 'gt', args: [{ field: 'date_of_admission' }, { op: 'today', args: [] }] },
        },
        // Show preferred job type when interested in employment
        {
          id: 'alm_e_show_jobtype',
          kind: 'SHOW',
          target: 'preferred_job_type',
          expr: {
            op: 'or',
            args: [
              { op: 'eq', args: [{ field: 'interested_in_job' }, { lit: 'Yes - Immediate' }] },
              { op: 'eq', args: [{ field: 'interested_in_job' }, { lit: 'Yes - After some time' }] },
            ],
          },
        },
      ],
    },

    // ─── Form 3: Monthly Progress Check ─────────────────────────────────────
    {
      slug: 'alamb-monthly-progress',
      title: 'Monthly Progress Check',
      description:
        'One entry per month. Attendance percentage is calculated from the two numbers. The skills checklist changes based on the enrolled course — a Computer student sees Computer skills, not Beautician skills.',
      role: 'ATTACHES',
      settings: { requireAuth: false },
      pages: [
        { pageNumber: 1, title: 'Attendance' },
        { pageNumber: 2, title: 'Progress Assessment' },
        { pageNumber: 3, title: 'Student Engagement' },
      ],
      questions: [
        // ── Page 1: Attendance ──
        {
          id: 'alm_p_month',
          key: 'month_number',
          type: 'SINGLE_CHOICE',
          label: 'Month',
          pageNumber: 1,
          options: choices(['Month 1', 'Month 2', 'Month 3', 'Month 4', 'Month 5', 'Month 6']),
          validation: { required: true },
        },
        {
          id: 'alm_p_attended',
          key: 'days_attended',
          type: 'NUMBER',
          label: 'Days Attended',
          pageNumber: 1,
          validation: { required: true, min: 0, max: 31 },
        },
        {
          id: 'alm_p_workdays',
          key: 'total_working_days',
          type: 'NUMBER',
          label: 'Total Working Days',
          defaultValue: 26,
          pageNumber: 1,
          validation: { required: true, min: 1, max: 31 },
        },
        {
          id: 'alm_p_attpct',
          key: 'attendance_percentage',
          type: 'NUMBER',
          label: 'Attendance Percentage',
          description: 'Calculated: (days attended ÷ total working days) × 100.',
          pageNumber: 1,
          validation: {},
        },

        // ── Page 2: Progress ──
        {
          id: 'alm_p_progress',
          key: 'overall_progress',
          type: 'SINGLE_CHOICE',
          label: 'Overall Progress',
          pageNumber: 2,
          options: choices(['Excellent', 'Good', 'Average', 'Needs Improvement', 'Poor']),
          validation: { required: true },
        },
        {
          id: 'alm_p_skills_comp',
          key: 'skills_computer',
          type: 'MULTI_CHOICE',
          label: 'Skills Practiced (Computer)',
          description: 'Shown only for students enrolled in the Computer course.',
          pageNumber: 2,
          options: choices(['Typing', 'MS Word', 'MS Excel', 'MS PowerPoint', 'Internet', 'Email']),
          validation: {},
        },
        {
          id: 'alm_p_skills_beauty',
          key: 'skills_beautician',
          type: 'MULTI_CHOICE',
          label: 'Skills Practiced (Beautician)',
          description: 'Shown only for students enrolled in the Beautician course.',
          pageNumber: 2,
          options: choices(['Facial', 'Makeup', 'Hair Styling', 'Mehendi', 'Manicure/Pedicure', 'Waxing']),
          validation: {},
        },
        {
          id: 'alm_p_skills_ct',
          key: 'skills_cutting_tailoring',
          type: 'MULTI_CHOICE',
          label: 'Skills Practiced (Cutting & Tailoring)',
          description: 'Shown only for students enrolled in the C&T course.',
          pageNumber: 2,
          options: choices(['Basic Stitching', 'Measurement', 'Cutting', 'Blouse Making', 'Suit Making', 'Dress Designing']),
          validation: {},
        },

        // ── Page 3: Engagement ──
        {
          id: 'alm_p_participation',
          key: 'participation_level',
          type: 'SINGLE_CHOICE',
          label: 'Participation Level',
          pageNumber: 3,
          options: choices(['Very Active', 'Active', 'Moderate', 'Passive', 'Absent frequently']),
          validation: { required: true },
        },
        {
          id: 'alm_p_issues',
          key: 'issues_concerns',
          type: 'MULTI_CHOICE',
          label: 'Any Issues / Concerns',
          pageNumber: 3,
          options: choices([
            'Health issues',
            'Family problems',
            'Transportation',
            'Financial',
            'Peer issues',
            'Learning difficulties',
            'None',
          ]),
          validation: {},
        },
        {
          id: 'alm_p_followup',
          key: 'follow_up_required',
          type: 'SINGLE_CHOICE',
          label: 'Follow-up Required',
          pageNumber: 3,
          options: YES_NO(),
          validation: {},
        },
        {
          id: 'alm_p_followupnotes',
          key: 'follow_up_notes',
          type: 'LONG_TEXT',
          label: 'Follow-up Notes',
          description: 'Appears when follow-up is required.',
          pageNumber: 3,
          validation: { maxLength: 1000 },
        },
      ],
      rules: [
        // Attendance percentage = round((attended / working) * 100)
        {
          id: 'alm_p_calc_att',
          kind: 'CALCULATE',
          target: 'attendance_percentage',
          expr: {
            op: 'round',
            args: [
              {
                op: 'mul',
                args: [
                  { op: 'div', args: [{ field: 'days_attended' }, { field: 'total_working_days' }] },
                  { lit: 100 },
                ],
              },
              { lit: 0 },
            ],
          },
        },
        // Validate days attended ≤ total working days
        {
          id: 'alm_p_val_att',
          kind: 'VALIDATE',
          target: 'days_attended',
          message: 'Days attended cannot exceed total working days.',
          expr: { op: 'gt', args: [{ field: 'days_attended' }, { field: 'total_working_days' }] },
        },
        // Show Computer skills when enrollment course = computer
        {
          id: 'alm_p_show_comp',
          kind: 'SHOW',
          target: 'skills_computer',
          expr: {
            op: 'eq',
            args: [
              { ref: { form: '@alamb-enrollment', question: 'course_selected', when: 'LATEST' } },
              { lit: 'computer' },
            ],
          },
        },
        // Show Beautician skills when enrollment course = beautician
        {
          id: 'alm_p_show_beauty',
          kind: 'SHOW',
          target: 'skills_beautician',
          expr: {
            op: 'eq',
            args: [
              { ref: { form: '@alamb-enrollment', question: 'course_selected', when: 'LATEST' } },
              { lit: 'beautician' },
            ],
          },
        },
        // Show C&T skills when enrollment course = cutting_tailoring
        {
          id: 'alm_p_show_ct',
          kind: 'SHOW',
          target: 'skills_cutting_tailoring',
          expr: {
            op: 'eq',
            args: [
              { ref: { form: '@alamb-enrollment', question: 'course_selected', when: 'LATEST' } },
              { lit: 'cutting_tailoring' },
            ],
          },
        },
        // Show follow-up notes when follow-up = Yes
        {
          id: 'alm_p_show_notes',
          kind: 'SHOW',
          target: 'follow_up_notes',
          expr: { op: 'eq', args: [{ field: 'follow_up_required' }, { lit: 'Yes' }] },
        },
        {
          id: 'alm_p_require_notes',
          kind: 'REQUIRE',
          target: 'follow_up_notes',
          expr: { op: 'eq', args: [{ field: 'follow_up_required' }, { lit: 'Yes' }] },
        },
      ],
    },

    // ─── Form 4: Skill Assessment ───────────────────────────────────────────
    {
      slug: 'alamb-skill-assessment',
      title: 'Skill Assessment',
      description:
        'Mid-term and final assessments. Total score and grade are calculated — the assessor types only the practical and theory scores.',
      role: 'ATTACHES',
      settings: { requireAuth: false, notifyEmails: ['alamb-assessments@acme.test'] },
      pages: [
        { pageNumber: 1, title: 'Assessment Type' },
        { pageNumber: 2, title: 'Practical & Theory' },
        { pageNumber: 3, title: 'Overall Assessment' },
      ],
      questions: [
        // ── Page 1 ──
        {
          id: 'alm_a_type',
          key: 'assessment_type',
          type: 'SINGLE_CHOICE',
          label: 'Assessment Type',
          pageNumber: 1,
          options: choices(['Mid-Term (Month 3)', 'Final (Month 6)']),
          validation: { required: true },
        },
        {
          id: 'alm_a_date',
          key: 'assessment_date',
          type: 'DATE',
          label: 'Assessment Date',
          defaultValue: TODAY,
          pageNumber: 1,
          validation: { required: true },
        },

        // ── Page 2: Practical & Theory ──
        {
          id: 'alm_a_practest',
          key: 'practical_test_conducted',
          type: 'SINGLE_CHOICE',
          label: 'Practical Test Conducted',
          pageNumber: 2,
          options: YES_NO(),
          validation: { required: true },
        },
        {
          id: 'alm_a_pracscore',
          key: 'practical_score',
          type: 'NUMBER',
          label: 'Practical Score (out of 100)',
          description: 'Asked only when the practical test was conducted.',
          pageNumber: 2,
          validation: { min: 0, max: 100 },
        },
        {
          id: 'alm_a_pracperf',
          key: 'practical_performance',
          type: 'SINGLE_CHOICE',
          label: 'Practical Performance',
          description: 'Asked only when the practical test was conducted.',
          pageNumber: 2,
          options: choices(['Excellent', 'Good', 'Average', 'Below Average', 'Poor']),
          validation: {},
        },
        {
          id: 'alm_a_theorytest',
          key: 'theory_test_conducted',
          type: 'SINGLE_CHOICE',
          label: 'Theory Test Conducted',
          pageNumber: 2,
          options: YES_NO(),
          validation: { required: true },
        },
        {
          id: 'alm_a_theoryscore',
          key: 'theory_score',
          type: 'NUMBER',
          label: 'Theory Score (out of 100)',
          description: 'Asked only when the theory test was conducted.',
          pageNumber: 2,
          validation: { min: 0, max: 100 },
        },

        // ── Page 3: Overall ──
        {
          id: 'alm_a_total',
          key: 'total_score',
          type: 'NUMBER',
          label: 'Total Score (out of 100)',
          description: 'Calculated: average of practical and theory scores.',
          pageNumber: 3,
          validation: {},
        },
        {
          id: 'alm_a_grade',
          key: 'grade',
          type: 'SINGLE_CHOICE',
          label: 'Grade',
          description: 'Derived: A (80+), B (60–79), C (40–59), D (below 40).',
          pageNumber: 3,
          options: choices(['A (80+)', 'B (60-79)', 'C (40-59)', 'D (Below 40)']),
          validation: {},
        },
        {
          id: 'alm_a_certready',
          key: 'ready_for_certification',
          type: 'SINGLE_CHOICE',
          label: 'Ready for Certification',
          pageNumber: 3,
          options: choices(['Yes', 'Needs More Practice', 'No']),
          validation: { required: true },
        },
        {
          id: 'alm_a_remarks',
          key: 'assessor_remarks',
          type: 'LONG_TEXT',
          label: 'Assessor Remarks',
          pageNumber: 3,
          validation: { maxLength: 1000 },
        },
      ],
      rules: [
        // Show practical score and performance when test = Yes
        {
          id: 'alm_a_show_pracscore',
          kind: 'SHOW',
          target: 'practical_score',
          expr: { op: 'eq', args: [{ field: 'practical_test_conducted' }, { lit: 'Yes' }] },
        },
        {
          id: 'alm_a_require_pracscore',
          kind: 'REQUIRE',
          target: 'practical_score',
          expr: { op: 'eq', args: [{ field: 'practical_test_conducted' }, { lit: 'Yes' }] },
        },
        {
          id: 'alm_a_show_pracperf',
          kind: 'SHOW',
          target: 'practical_performance',
          expr: { op: 'eq', args: [{ field: 'practical_test_conducted' }, { lit: 'Yes' }] },
        },
        {
          id: 'alm_a_require_pracperf',
          kind: 'REQUIRE',
          target: 'practical_performance',
          expr: { op: 'eq', args: [{ field: 'practical_test_conducted' }, { lit: 'Yes' }] },
        },
        // Show theory score when test = Yes
        {
          id: 'alm_a_show_theory',
          kind: 'SHOW',
          target: 'theory_score',
          expr: { op: 'eq', args: [{ field: 'theory_test_conducted' }, { lit: 'Yes' }] },
        },
        {
          id: 'alm_a_require_theory',
          kind: 'REQUIRE',
          target: 'theory_score',
          expr: { op: 'eq', args: [{ field: 'theory_test_conducted' }, { lit: 'Yes' }] },
        },
        // Total score = round((practical + theory) / 2)
        {
          id: 'alm_a_calc_total',
          kind: 'CALCULATE',
          target: 'total_score',
          expr: {
            op: 'round',
            args: [
              {
                op: 'div',
                args: [
                  {
                    op: 'add',
                    args: [{ field: 'practical_score' }, { field: 'theory_score' }],
                  },
                  { lit: 2 },
                ],
              },
              { lit: 0 },
            ],
          },
        },
        // Grade from total score — nested if
        {
          id: 'alm_a_calc_grade',
          kind: 'CALCULATE',
          target: 'grade',
          expr: {
            op: 'if',
            args: [
              { op: 'gte', args: [{ field: 'total_score' }, { lit: 80 }] },
              { lit: 'A (80+)' },
              {
                op: 'if',
                args: [
                  { op: 'gte', args: [{ field: 'total_score' }, { lit: 60 }] },
                  { lit: 'B (60-79)' },
                  {
                    op: 'if',
                    args: [
                      { op: 'gte', args: [{ field: 'total_score' }, { lit: 40 }] },
                      { lit: 'C (40-59)' },
                      { lit: 'D (Below 40)' },
                    ],
                  },
                ],
              },
            ],
          },
        },
        // Assessment date not in the future
        {
          id: 'alm_a_val_date',
          kind: 'VALIDATE',
          target: 'assessment_date',
          message: 'Assessment date cannot be in the future.',
          expr: { op: 'gt', args: [{ field: 'assessment_date' }, { op: 'today', args: [] }] },
        },
      ],
    },

    // ─── Form 5: Course Exit ────────────────────────────────────────────────
    {
      slug: 'alamb-course-exit',
      title: 'Course Exit',
      description:
        'Marks course completion or dropout. Certificate fields appear only on successful completion. Other reason appears only when exit reason is "Other".',
      role: 'ATTACHES',
      settings: { requireAuth: false, notifyEmails: ['alamb-coordinator@acme.test'] },
      pages: [
        { pageNumber: 1, title: 'Exit Details' },
        { pageNumber: 2, title: 'Completion Status' },
        { pageNumber: 3, title: 'Future Plans' },
      ],
      questions: [
        // ── Page 1: Exit Details ──
        {
          id: 'alm_x_date',
          key: 'exit_date',
          type: 'DATE',
          label: 'Exit Date',
          defaultValue: TODAY,
          pageNumber: 1,
          validation: { required: true },
        },
        {
          id: 'alm_x_reason',
          key: 'exit_reason',
          type: 'SINGLE_CHOICE',
          label: 'Exit Reason',
          pageNumber: 1,
          options: choices([
            'Course Completed',
            'Dropped Out - Personal reasons',
            'Dropped Out - Family reasons',
            'Dropped Out - Got Job',
            'Dropped Out - Health issues',
            'Dropped Out - Migration',
            'Other',
          ]),
          validation: { required: true },
        },
        {
          id: 'alm_x_otherreason',
          key: 'other_exit_reason',
          type: 'SHORT_TEXT',
          label: 'Other Exit Reason (specify)',
          pageNumber: 1,
          validation: { maxLength: 200 },
        },

        // ── Page 2: Completion ──
        {
          id: 'alm_x_completed',
          key: 'course_completed',
          type: 'SINGLE_CHOICE',
          label: 'Course Completed Successfully',
          pageNumber: 2,
          options: YES_NO(),
          validation: { required: true },
        },
        {
          id: 'alm_x_certissued',
          key: 'certificate_issued',
          type: 'SINGLE_CHOICE',
          label: 'Certificate Issued',
          description: 'Asked only when the course was completed.',
          pageNumber: 2,
          options: choices(['Yes', 'No', 'Pending']),
          validation: {},
        },
        {
          id: 'alm_x_certnum',
          key: 'certificate_number',
          type: 'SHORT_TEXT',
          label: 'Certificate Number',
          description: 'Asked only when a certificate was issued.',
          pageNumber: 2,
          validation: { maxLength: 40 },
        },

        // ── Page 3: Future Plans ──
        {
          id: 'alm_x_plan',
          key: 'immediate_plan',
          type: 'SINGLE_CHOICE',
          label: 'Immediate Plan',
          pageNumber: 3,
          options: choices([
            'Looking for Job',
            'Self-employment',
            'Further Studies',
            'Home responsibilities',
            'Undecided',
          ]),
          validation: { required: true },
        },
        {
          id: 'alm_x_support',
          key: 'support_needed',
          type: 'MULTI_CHOICE',
          label: 'Support Needed from ALAMB',
          pageNumber: 3,
          options: choices([
            'Job placement',
            'Reference letter',
            'Skill enhancement',
            'Business guidance',
            'None',
          ]),
          validation: {},
        },
        {
          id: 'alm_x_willing',
          key: 'willing_to_be_contacted',
          type: 'SINGLE_CHOICE',
          label: 'Willing to be Contacted for Follow-up',
          pageNumber: 3,
          options: YES_NO(),
          validation: { required: true },
        },
      ],
      rules: [
        // Show other exit reason when reason = Other
        {
          id: 'alm_x_show_other',
          kind: 'SHOW',
          target: 'other_exit_reason',
          expr: { op: 'eq', args: [{ field: 'exit_reason' }, { lit: 'Other' }] },
        },
        {
          id: 'alm_x_require_other',
          kind: 'REQUIRE',
          target: 'other_exit_reason',
          expr: { op: 'eq', args: [{ field: 'exit_reason' }, { lit: 'Other' }] },
        },
        // Show certificate issued when completed = Yes
        {
          id: 'alm_x_show_cert',
          kind: 'SHOW',
          target: 'certificate_issued',
          expr: { op: 'eq', args: [{ field: 'course_completed' }, { lit: 'Yes' }] },
        },
        {
          id: 'alm_x_require_cert',
          kind: 'REQUIRE',
          target: 'certificate_issued',
          expr: { op: 'eq', args: [{ field: 'course_completed' }, { lit: 'Yes' }] },
        },
        // Show certificate number when certificate_issued = Yes
        {
          id: 'alm_x_show_certnum',
          kind: 'SHOW',
          target: 'certificate_number',
          expr: { op: 'eq', args: [{ field: 'certificate_issued' }, { lit: 'Yes' }] },
        },
        {
          id: 'alm_x_require_certnum',
          kind: 'REQUIRE',
          target: 'certificate_number',
          expr: { op: 'eq', args: [{ field: 'certificate_issued' }, { lit: 'Yes' }] },
        },
        // Exit date not in the future
        {
          id: 'alm_x_val_date',
          kind: 'VALIDATE',
          target: 'exit_date',
          message: 'Exit date cannot be in the future.',
          expr: { op: 'gt', args: [{ field: 'exit_date' }, { op: 'today', args: [] }] },
        },
      ],
    },

    // ─── Form 6: Placement Follow-up ────────────────────────────────────────
    {
      slug: 'alamb-placement-followup',
      title: 'Placement Follow-up',
      description:
        'Post-completion employment tracking. Contact status gates the employment fields, and each employment type shows its own detail fields.',
      role: 'ATTACHES',
      settings: { requireAuth: false },
      pages: [
        { pageNumber: 1, title: 'Follow-up Details' },
        { pageNumber: 2, title: 'Employment Status' },
        { pageNumber: 3, title: 'Feedback' },
      ],
      questions: [
        // ── Page 1: Follow-up Details ──
        {
          id: 'alm_f_number',
          key: 'followup_number',
          type: 'SINGLE_CHOICE',
          label: 'Follow-up Number',
          pageNumber: 1,
          options: choices(['1st (1 Month)', '2nd (3 Months)', '3rd (6 Months)', 'Additional']),
          validation: { required: true },
        },
        {
          id: 'alm_f_date',
          key: 'followup_date',
          type: 'DATE',
          label: 'Follow-up Date',
          defaultValue: TODAY,
          pageNumber: 1,
          validation: { required: true },
        },
        {
          id: 'alm_f_contact',
          key: 'contact_made',
          type: 'SINGLE_CHOICE',
          label: 'Contact Made',
          pageNumber: 1,
          options: choices([
            'Yes - Phone',
            'Yes - In-person',
            'No - Not reachable',
            'No - Number changed',
          ]),
          validation: { required: true },
        },

        // ── Page 2: Employment ──
        {
          id: 'alm_f_empstatus',
          key: 'current_employment_status',
          type: 'SINGLE_CHOICE',
          label: 'Current Employment Status',
          description: 'Asked only when contact was made.',
          pageNumber: 2,
          options: choices([
            'Employed - Formal Job',
            'Self Employed',
            'Continuing Studies',
            'Homemaker',
            'Job Seeking',
            'Not Working',
          ]),
          validation: {},
        },
        {
          id: 'alm_f_emprelated',
          key: 'employment_related_to_course',
          type: 'SINGLE_CHOICE',
          label: 'Employment Related to Course',
          description: 'Asked only when employed.',
          pageNumber: 2,
          options: choices(['Yes - Directly related', 'Yes - Partially related', 'No']),
          validation: {},
        },
        {
          id: 'alm_f_emptype',
          key: 'employment_type',
          type: 'SINGLE_CHOICE',
          label: 'Type of Employment',
          description: 'Asked only when employed.',
          pageNumber: 2,
          options: choices([
            'Beauty Parlour',
            'Boutique/Tailor Shop',
            'Office Job',
            'Factory',
            'Home-based work',
            'Own business',
            'Other',
          ]),
          validation: {},
        },
        {
          id: 'alm_f_employer',
          key: 'employer_name',
          type: 'SHORT_TEXT',
          label: 'Employer Name',
          description: 'Asked only for formal employment.',
          pageNumber: 2,
          validation: { maxLength: 200 },
        },
        {
          id: 'alm_f_empaddr',
          key: 'employer_address',
          type: 'SHORT_TEXT',
          label: 'Employer Address',
          description: 'Asked only for formal employment.',
          pageNumber: 2,
          validation: { maxLength: 300 },
        },
        {
          id: 'alm_f_salary',
          key: 'monthly_salary',
          type: 'SINGLE_CHOICE',
          label: 'Monthly Salary / Income',
          description: 'Asked only when employed.',
          pageNumber: 2,
          options: choices([
            'Less than ₹3,000',
            '₹3,000-5,000',
            '₹5,000-8,000',
            '₹8,000-10,000',
            '₹10,000-15,000',
            'Above ₹15,000',
          ]),
          validation: {},
        },
        {
          id: 'alm_f_satisfaction',
          key: 'job_satisfaction',
          type: 'SINGLE_CHOICE',
          label: 'Job Satisfaction',
          description: 'Asked only when employed.',
          pageNumber: 2,
          options: choices(['Very Satisfied', 'Satisfied', 'Neutral', 'Dissatisfied']),
          validation: {},
        },
        {
          id: 'alm_f_studydetails',
          key: 'study_details',
          type: 'SHORT_TEXT',
          label: 'Study Details',
          description: 'Asked when continuing studies.',
          pageNumber: 2,
          validation: { maxLength: 200 },
        },

        // ── Page 3: Feedback ──
        {
          id: 'alm_f_helpful',
          key: 'course_helpfulness',
          type: 'SINGLE_CHOICE',
          label: 'Course Helpfulness Rating',
          pageNumber: 3,
          options: choices(['Very Helpful', 'Helpful', 'Somewhat Helpful', 'Not Helpful']),
          validation: {},
        },
        {
          id: 'alm_f_recommend',
          key: 'would_recommend',
          type: 'SINGLE_CHOICE',
          label: 'Would Recommend ALAMB',
          pageNumber: 3,
          options: choices(['Yes', 'Maybe', 'No']),
          validation: {},
        },
        {
          id: 'alm_f_needssupport',
          key: 'needs_further_support',
          type: 'SINGLE_CHOICE',
          label: 'Needs Further Support',
          pageNumber: 3,
          options: YES_NO(),
          validation: {},
        },
        {
          id: 'alm_f_supporttype',
          key: 'support_type_needed',
          type: 'MULTI_CHOICE',
          label: 'Support Type Needed',
          description: 'Asked when the student needs further support.',
          pageNumber: 3,
          options: choices(['Job placement', 'Skill upgrade', 'Reference letter', 'Guidance', 'Other']),
          validation: {},
        },
      ],
      rules: [
        // Show employment status when contact was made (phone or in-person)
        {
          id: 'alm_f_show_empstatus',
          kind: 'SHOW',
          target: 'current_employment_status',
          expr: {
            op: 'or',
            args: [
              { op: 'eq', args: [{ field: 'contact_made' }, { lit: 'Yes - Phone' }] },
              { op: 'eq', args: [{ field: 'contact_made' }, { lit: 'Yes - In-person' }] },
            ],
          },
        },
        {
          id: 'alm_f_require_empstatus',
          kind: 'REQUIRE',
          target: 'current_employment_status',
          expr: {
            op: 'or',
            args: [
              { op: 'eq', args: [{ field: 'contact_made' }, { lit: 'Yes - Phone' }] },
              { op: 'eq', args: [{ field: 'contact_made' }, { lit: 'Yes - In-person' }] },
            ],
          },
        },
        // Show employment-related fields when employed
        {
          id: 'alm_f_show_emprelated',
          kind: 'SHOW',
          target: 'employment_related_to_course',
          expr: {
            op: 'or',
            args: [
              { op: 'eq', args: [{ field: 'current_employment_status' }, { lit: 'Employed - Formal Job' }] },
              { op: 'eq', args: [{ field: 'current_employment_status' }, { lit: 'Self Employed' }] },
            ],
          },
        },
        {
          id: 'alm_f_show_emptype',
          kind: 'SHOW',
          target: 'employment_type',
          expr: {
            op: 'or',
            args: [
              { op: 'eq', args: [{ field: 'current_employment_status' }, { lit: 'Employed - Formal Job' }] },
              { op: 'eq', args: [{ field: 'current_employment_status' }, { lit: 'Self Employed' }] },
            ],
          },
        },
        {
          id: 'alm_f_show_salary',
          kind: 'SHOW',
          target: 'monthly_salary',
          expr: {
            op: 'or',
            args: [
              { op: 'eq', args: [{ field: 'current_employment_status' }, { lit: 'Employed - Formal Job' }] },
              { op: 'eq', args: [{ field: 'current_employment_status' }, { lit: 'Self Employed' }] },
            ],
          },
        },
        {
          id: 'alm_f_show_satisfaction',
          kind: 'SHOW',
          target: 'job_satisfaction',
          expr: {
            op: 'or',
            args: [
              { op: 'eq', args: [{ field: 'current_employment_status' }, { lit: 'Employed - Formal Job' }] },
              { op: 'eq', args: [{ field: 'current_employment_status' }, { lit: 'Self Employed' }] },
            ],
          },
        },
        // Show employer details only for formal job
        {
          id: 'alm_f_show_employer',
          kind: 'SHOW',
          target: 'employer_name',
          expr: { op: 'eq', args: [{ field: 'current_employment_status' }, { lit: 'Employed - Formal Job' }] },
        },
        {
          id: 'alm_f_show_empaddr',
          kind: 'SHOW',
          target: 'employer_address',
          expr: { op: 'eq', args: [{ field: 'current_employment_status' }, { lit: 'Employed - Formal Job' }] },
        },
        // Show study details when continuing studies
        {
          id: 'alm_f_show_study',
          kind: 'SHOW',
          target: 'study_details',
          expr: { op: 'eq', args: [{ field: 'current_employment_status' }, { lit: 'Continuing Studies' }] },
        },
        // Show support type when needs support = Yes
        {
          id: 'alm_f_show_support',
          kind: 'SHOW',
          target: 'support_type_needed',
          expr: { op: 'eq', args: [{ field: 'needs_further_support' }, { lit: 'Yes' }] },
        },
        // Follow-up date not in the future
        {
          id: 'alm_f_val_date',
          kind: 'VALIDATE',
          target: 'followup_date',
          message: 'Follow-up date cannot be in the future.',
          expr: { op: 'gt', args: [{ field: 'followup_date' }, { op: 'today', args: [] }] },
        },
      ],
    },
  ],

  // ── Steps ───────────────────────────────────────────────────────────────────
  steps: [
    // ── Scopes ────────────────────────────────────────────────────────────
    // This is the scenario that motivated step scope, so it is the one that
    // has to demonstrate it. A student is registered ONCE and then returned to
    // month after month; every step below is therefore counted against the
    // STUDENT, not against whichever sitting a field worker happens to be in.
    //
    // Left at the default SESSION, `maxEntries: 6` on the progress check would
    // mean six per sitting, `uniqueBy: ['month_number']` would not stop month 3
    // being entered twice in two visits, and adding March would demand the
    // student's whole registration be re-typed first.
    {
      key: 'registration',
      formSlug: 'alamb-registration',
      title: 'Student Registration',
      description: 'Personal, education, and family details. Filled once.',
      icon: '📝',
      mode: 'SINGLE',
      // Once in the student's lifetime — not once per sitting, and not once
      // per cycle. With no uniqueBy and a ceiling of one, the step is its own
      // occurrence, so the partial unique index enforces this in the database.
      scope: 'SUBJECT',
      minEntries: 1,
      maxEntries: 1,
      isOptional: false,
      uniqueBy: [],
    },
    {
      key: 'enrollment',
      formSlug: 'alamb-enrollment',
      title: 'Course Enrollment',
      description: 'Select course, batch, and job interest.',
      icon: '🎓',
      mode: 'SINGLE',
      scope: 'SUBJECT',
      minEntries: 1,
      maxEntries: 1,
      isOptional: false,
      uniqueBy: [],
    },
    {
      key: 'progress_checks',
      formSlug: 'alamb-monthly-progress',
      title: 'Monthly Progress Checks',
      description: 'One entry per month. Attendance and skills are tracked.',
      icon: '📊',
      mode: 'REPEATABLE',
      // Per student PER CYCLE. The six months are a cohort's course, so the
      // count has to reset when the next batch starts — under plain SUBJECT
      // scope a student repeating the course could never be tracked again.
      scope: 'SUBJECT_PERIOD',
      minEntries: 1,
      maxEntries: 6,
      isOptional: false,
      uniqueBy: ['month_number'],
    },
    {
      key: 'assessments',
      formSlug: 'alamb-skill-assessment',
      title: 'Skill Assessments',
      description: 'Mid-term and final assessments with scores and grading.',
      icon: '✅',
      mode: 'REPEATABLE',
      scope: 'SUBJECT',
      minEntries: 0,
      maxEntries: 2,
      isOptional: true,
      uniqueBy: ['assessment_type'],
      occurredAtKey: 'assessment_date',
    },
    {
      key: 'exit',
      formSlug: 'alamb-course-exit',
      title: 'Course Exit',
      description: 'Completion or dropout. Certificate details for completions.',
      icon: '🚪',
      mode: 'SINGLE',
      scope: 'SUBJECT',
      minEntries: 0,
      maxEntries: 1,
      isOptional: true,
      uniqueBy: [],
      occurredAtKey: 'exit_date',
    },
    {
      key: 'followups',
      formSlug: 'alamb-placement-followup',
      title: 'Placement Follow-ups',
      description: 'Post-exit employment tracking at 1, 3, and 6 months.',
      icon: '📞',
      mode: 'REPEATABLE',
      scope: 'SUBJECT',
      minEntries: 0,
      maxEntries: 3,
      isOptional: true,
      uniqueBy: ['followup_number'],
      // Months apart from the sitting they are typed in, which is the whole
      // reason a follow-up needs its own date.
      occurredAtKey: 'followup_date',
      // The programme's actual commitment: check on the student at one, three
      // and six months after they leave. Anchored on the EXIT rather than on
      // registration, because a student who dropped out in month two and one
      // who completed all six are followed up on different clocks.
      //
      // A fortnight of grace before it reads as missed — a follow-up is a phone
      // call that may take several attempts, and flagging it overdue the
      // morning it falls due would make the chase list meaningless.
      schedule: {
        anchor: 'exit',
        offsets: [{ months: 1 }, { months: 3 }, { months: 6 }],
        graceDays: 14,
      },
    },
  ],

  // ── Periods ─────────────────────────────────────────────────────────────────
  //
  // Empty, deliberately. This app runs on a RECURRING monthly cadence, so its
  // windows are COMPUTED and materialised the first time something is filed
  // into one. It previously carried two hand-made half-year windows; under a
  // monthly cadence those match no computed boundary, so they would sit in the
  // table being ignored — two rows that look like configuration and govern
  // nothing, which is worse than none.
  periods: [],

  // ── Sessions ────────────────────────────────────────────────────────────────
  sessions: [
    // Session 1: Priya Sharma — complete journey through Computer course.
    // Registered, enrolled, three progress checks, mid-term assessment,
    // course exit (completed), and one placement follow-up (employed).
    {
      fingerprint: 'alamb-demo-1',
      daysAgo: 140,
      entries: [
        {
          stepKey: 'registration',
          answers: {
            registration_number: 'ALAMB/2026/0001',
            full_name: 'Priya Sharma',
            date_of_birth: '2003-06-15',
            gender: 'Female',
            contact_number: '9876543210',
            address: 'House No. 45, Gali 3, Shiv Vihar, West Delhi',
            area: 'shiv-vihar',
            id_proof_type: 'Aadhar Card',
            id_proof_number: '1234-5678-9012',
            highest_qualification: '12th',
            relationship_type: 'D/O (Daughter of Father)',
            father_husband_name: 'Rajesh Sharma',
            father_husband_occupation: 'Shop Owner',
            mother_name: 'Sunita Sharma',
            mother_occupation: 'Homemaker',
            monthly_family_income: '₹10,000-15,000',
            number_of_brothers: 1,
            number_of_sisters: 2,
          },
        },
        {
          stepKey: 'enrollment',
          answers: {
            course_selected: 'computer',
            batch: 'January-June 2026',
            date_of_admission: iso(-140),
            interested_in_job: 'Yes - Immediate',
            preferred_job_type: ['Office/Company', 'Home-based work'],
            referral_source: 'Friend/Family',
          },
        },
        {
          stepKey: 'progress_checks',
          answers: {
            month_number: 'Month 1',
            days_attended: 23,
            total_working_days: 26,
            overall_progress: 'Good',
            skills_computer: ['Typing', 'MS Word'],
            participation_level: 'Active',
            issues_concerns: ['None'],
          },
        },
        {
          stepKey: 'progress_checks',
          answers: {
            month_number: 'Month 2',
            days_attended: 24,
            total_working_days: 26,
            overall_progress: 'Good',
            skills_computer: ['Typing', 'MS Word', 'MS Excel'],
            participation_level: 'Very Active',
            issues_concerns: ['None'],
          },
        },
        {
          stepKey: 'progress_checks',
          answers: {
            month_number: 'Month 3',
            days_attended: 22,
            total_working_days: 26,
            overall_progress: 'Excellent',
            skills_computer: ['Typing', 'MS Word', 'MS Excel', 'MS PowerPoint'],
            participation_level: 'Very Active',
            issues_concerns: ['None'],
          },
        },
        {
          stepKey: 'assessments',
          answers: {
            assessment_type: 'Mid-Term (Month 3)',
            assessment_date: iso(-50),
            practical_test_conducted: 'Yes',
            practical_score: 78,
            practical_performance: 'Good',
            theory_test_conducted: 'Yes',
            theory_score: 72,
            ready_for_certification: 'Needs More Practice',
            assessor_remarks: 'Good progress in MS Office. Needs more practice on Excel formulas and Internet usage.',
          },
        },
        {
          stepKey: 'exit',
          answers: {
            exit_date: iso(-10),
            exit_reason: 'Course Completed',
            course_completed: 'Yes',
            certificate_issued: 'Yes',
            certificate_number: 'ALAMB/COMP/2026/001',
            immediate_plan: 'Looking for Job',
            support_needed: ['Job placement', 'Reference letter'],
            willing_to_be_contacted: 'Yes',
          },
        },
        {
          stepKey: 'followups',
          answers: {
            followup_number: '1st (1 Month)',
            followup_date: iso(-5),
            contact_made: 'Yes - Phone',
            current_employment_status: 'Employed - Formal Job',
            employment_related_to_course: 'Yes - Directly related',
            employment_type: 'Office Job',
            employer_name: 'TechStar Solutions Pvt Ltd',
            employer_address: 'Janakpuri, West Delhi',
            monthly_salary: '₹8,000-10,000',
            job_satisfaction: 'Satisfied',
            course_helpfulness: 'Very Helpful',
            would_recommend: 'Yes',
          },
        },
      ],
    },

    // Session 2: Fatima Khan — in-progress, Beautician course.
    // Registered, enrolled, two progress checks (one with low attendance and
    // follow-up flagged). No assessment or exit yet.
    {
      fingerprint: 'alamb-demo-2',
      daysAgo: 60,
      entries: [
        {
          stepKey: 'registration',
          answers: {
            registration_number: 'ALAMB/2026/0002',
            full_name: 'Fatima Khan',
            date_of_birth: '2005-11-20',
            gender: 'Female',
            contact_number: '9812345678',
            alternate_contact: '9898765432',
            address: 'B-12, Om Vihar Phase-3, Uttam Nagar, West Delhi',
            area: 'om-vihar-phase-3',
            id_proof_type: 'Aadhar Card',
            id_proof_number: '9876-5432-1098',
            highest_qualification: '10th',
            currently_studying: 'Yes',
            current_study_details: 'Pursuing 11th through Open School (NIOS)',
            relationship_type: 'D/O (Daughter of Father)',
            father_husband_name: 'Mohammed Irfan Khan',
            father_husband_occupation: 'Driver',
            father_husband_contact: '9811223344',
            mother_name: 'Nasreen Khan',
            mother_occupation: 'Domestic Worker',
            mother_contact: '9822334455',
            monthly_family_income: '₹8,000-10,000',
            number_of_brothers: 3,
            number_of_sisters: 1,
            has_guardian: 'Yes',
            guardian_name: 'Arif Khan',
            guardian_relationship: 'Elder Brother',
            guardian_contact: '9833445566',
          },
        },
        {
          stepKey: 'enrollment',
          answers: {
            course_selected: 'beautician',
            batch: 'January-June 2026',
            date_of_admission: iso(-60),
            interested_in_job: 'Yes - After some time',
            preferred_job_type: ['Beauty Parlour', 'Home-based work'],
            referral_source: 'Community meeting',
          },
        },
        {
          stepKey: 'progress_checks',
          answers: {
            month_number: 'Month 1',
            days_attended: 20,
            total_working_days: 26,
            overall_progress: 'Good',
            skills_beautician: ['Facial', 'Mehendi'],
            participation_level: 'Active',
            issues_concerns: ['Transportation'],
          },
        },
        {
          stepKey: 'progress_checks',
          answers: {
            month_number: 'Month 2',
            days_attended: 14,
            total_working_days: 26,
            overall_progress: 'Needs Improvement',
            skills_beautician: ['Facial', 'Mehendi', 'Manicure/Pedicure'],
            participation_level: 'Passive',
            issues_concerns: ['Family problems', 'Transportation'],
            follow_up_required: 'Yes',
            follow_up_notes: 'Attendance dropped sharply. Fatima mentioned her mother fell ill and she had to take over household chores. Counselled her and contacted her elder brother (guardian) to ensure she continues attending.',
          },
        },
      ],
    },
  ],
};

const SCENARIOS: Scenario[] = [ANTENATAL, KHARIF, CAMPUS, COLD_CHAIN, GRIEVANCE, ALAMB];

// ═════════════════════════════════════════════════════════════════════════════
// Validation — the part that runs with or without a database
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Replace every `@form-slug` in a rule's `ref` nodes with the real form id.
 *
 * An author picks the source form in the UI and its id goes straight into the
 * rule. Here the id does not exist until the run publishes it, so the catalogue
 * names forms by slug and this resolves them once the ids are known. Failing
 * loudly on an unknown slug matters: an unresolved reference compiles fine and
 * then reads `null` forever, which looks like missing data rather than a typo.
 */
function resolveRefs(node: ExprNode, formIdBySlug: Map<string, string>): ExprNode {
  if (typeof node !== 'object' || node === null) return node;

  if ('ref' in node && node.ref) {
    const declared = node.ref.form;
    if (!declared.startsWith('@')) return node;
    const id = formIdBySlug.get(declared.slice(1));
    if (!id) {
      throw new Error(
        `Rule references form "${declared}", which is not published earlier in the same scenario.`,
      );
    }
    return { ref: { ...node.ref, form: id } };
  }

  if ('op' in node && Array.isArray(node.args)) {
    return { op: node.op, args: node.args.map((arg) => resolveRefs(arg, formIdBySlug)) };
  }

  return node;
}

interface PreparedForm {
  slug: string;
  title: string;
  role: 'REGISTERS' | 'ATTACHES';
  settings: FormSettings;
  description: string;
  structure: { pages: any[]; questions: any[]; logic: any[]; rules: any[] };
  plan: ReturnType<typeof readPlan>;
  compiledPlan: unknown;
  calculatedKeys: string[];
  lookups: Array<{ list: string; field: string; column: string }>;
  referenceCount: number;
}

/**
 * Normalise and compile one form, exactly as `updateForm` + `publishForm` do.
 *
 * Everything that can reject a form happens here — unknown question types,
 * options-less dropdowns, forward cascades, unknown operators, unresolvable
 * keys, dependency cycles, size budgets. A scenario that gets past this is one
 * the API would also accept.
 */
function prepareForm(
  form: ScenarioForm,
  scenario: Scenario,
  formIdBySlug: Map<string, string>,
): PreparedForm {
  const structure = normalizeFormStructure({
    pages: form.pages,
    questions: form.questions,
    logic: [],
    rules: form.rules.map((rule) => ({ ...rule, expr: resolveRefs(rule.expr, formIdBySlug) })),
  });

  const compiled = compileRules(structure.rules as FormRule[], {
    knownKeys: structure.questions.map((question: any) => question.key),
    // Every form here is bound to a subject type, which is what makes a
    // cross-form reference resolvable at all.
    allowReferences: true,
    knownChoiceLists: scenario.knownChoiceLists,
  });

  if (!compiled.ok) {
    throw new Error(
      `Rules for "${form.title}" (${scenario.key}) do not compile:\n` +
        compiled.errors.map((error) => `  • ${error.ruleId ?? 'form'}: ${error.message}`).join('\n'),
    );
  }

  return {
    slug: form.slug,
    title: form.title,
    role: form.role,
    settings: form.settings ?? {},
    description: form.description,
    structure,
    // Round-tripped through `readPlan`, so responses below are generated
    // against the exact shape the submit path reads back out of the database.
    plan: readPlan(compiled.plan),
    compiledPlan: compiled.plan,
    calculatedKeys: compiled.plan.calculatedKeys,
    lookups: compiled.plan.lookups ?? [],
    referenceCount: compiled.plan.references.length,
  };
}

/** Every choice item's metadata, keyed `listSlug::itemValue` — what `lookup()` reads. */
function metadataIndex(scenario: Scenario): Map<string, Record<string, unknown>> {
  const index = new Map<string, Record<string, unknown>>();
  for (const list of scenario.choiceLists) {
    for (const item of list.items) {
      index.set(`${list.slug}::${item.value}`, item.metadata ?? {});
    }
  }
  return index;
}

/** One entry's answers, evaluated and ready to store. */
interface EvaluatedEntry {
  stepKey: string;
  formSlug: string;
  index: number;
  /** Keyed by question id — the shape a FormSubmission actually holds. */
  answersById: Record<string, RuleValue>;
  /** Keyed by question key — what later entries' `ref`s read. */
  answersByKey: Record<string, RuleValue>;
}

/**
 * Turn one session's declared answers into stored submissions.
 *
 * Every entry goes through `runFormRules` with the same lookup and reference
 * bags the submit path builds, so calculated fields hold their DERIVED value
 * and hidden questions are dropped. Writing the declared answers straight to
 * JSONB would have been shorter and would have produced fixture rows no
 * respondent could ever have generated: blank departments, blank BMIs, and
 * answers to questions that were never on screen.
 */
function evaluateSession(
  scenario: Scenario,
  session: ScenarioSession,
  prepared: Map<string, PreparedForm>,
  formIdBySlug: Map<string, string>,
  metadata: Map<string, Record<string, unknown>>,
): EvaluatedEntry[] {
  const stepByKey = new Map(scenario.steps.map((step) => [step.key, step]));
  const registrationSlug = scenario.forms.find((form) => form.role === 'REGISTERS')?.slug;
  const evaluated: EvaluatedEntry[] = [];
  const perStepCount = new Map<string, number>();

  for (const entry of session.entries) {
    const step = stepByKey.get(entry.stepKey);
    if (!step) throw new Error(`${scenario.key}: session names unknown step "${entry.stepKey}".`);

    const form = prepared.get(step.formSlug);
    if (!form) throw new Error(`${scenario.key}: step "${step.key}" names unknown form.`);

    const byKey = new Map<string, any>(form.structure.questions.map((q: any) => [q.key, q]));
    const answersById: Record<string, RuleValue> = {};
    for (const [key, value] of Object.entries(entry.answers)) {
      const question = byKey.get(key);
      if (!question) {
        throw new Error(`${scenario.key}/${form.slug}: no question with key "${key}".`);
      }
      answersById[question.id] = value;
    }

    const lookups = resolveLookupBag(
      planLookupRequests(form.plan.lookups, entry.answers),
      metadata,
    );

    // Cross-form values, resolved out of what this session has already filed —
    // the same three windows the server offers, over one session's history.
    const refs: Record<string, RuleValue> = {};
    for (const reference of form.plan.references) {
      const sourceSlug = [...formIdBySlug].find(([, id]) => id === reference.form)?.[0];
      const candidates = evaluated.filter((prior) => prior.formSlug === sourceSlug);
      const source =
        reference.when === 'FIRST'
          ? candidates[0]
          : reference.when === 'LATEST'
            ? candidates[candidates.length - 1]
            : candidates.find((prior) => prior.formSlug === registrationSlug);
      refs[refKey(reference)] = source ? (source.answersByKey[reference.question] ?? null) : null;
    }

    const result = runFormRules({
      questions: form.structure.questions,
      plan: form.plan,
      answersById,
      refs,
      lookups,
    });

    if (result.violations.length > 0) {
      throw new Error(
        `${scenario.key}/${form.slug} (${session.fingerprint}): the sample response violates its own form's rules — ` +
          result.violations.map((violation) => violation.message).join('; '),
      );
    }

    // A question a SHOW rule hid was never on screen, so its answer is dropped
    // here exactly as the validator drops it on ingest.
    const stored: Record<string, RuleValue> = {};
    const storedByKey: Record<string, RuleValue> = {};
    const keyById = new Map<string, string>(
      form.structure.questions.map((q: any) => [q.id, q.key]),
    );
    for (const [id, value] of Object.entries(result.answersById)) {
      if (result.hiddenQuestionIds.has(id)) continue;
      if (value === null || value === undefined || value === '') continue;
      stored[id] = value;
      storedByKey[keyById.get(id) ?? id] = value;
    }

    // A required question left blank would be rejected on submit, so a fixture
    // that leaves one blank is a fixture of an impossible row.
    for (const question of form.structure.questions) {
      const required =
        question.validation?.required === true || result.requiredQuestionIds.has(question.id);
      if (!required) continue;
      if (result.hiddenQuestionIds.has(question.id)) continue;
      if (result.calculatedQuestionIds.has(question.id)) continue;
      if (stored[question.id] === undefined) {
        throw new Error(
          `${scenario.key}/${form.slug} (${session.fingerprint}): "${question.label}" is required but the sample response leaves it blank.`,
        );
      }
    }

    const index = perStepCount.get(step.key) ?? 0;
    perStepCount.set(step.key, index + 1);
    evaluated.push({
      stepKey: step.key,
      formSlug: form.slug,
      index,
      answersById: stored,
      answersByKey: storedByKey,
    });
  }

  // The steps' own minimums, checked against what was generated. A session with
  // fewer entries than its step demands would sit in the database looking fine
  // and be rejected the moment anyone filed the same thing through the app.
  for (const step of scenario.steps) {
    const filled = evaluated.filter((entry) => entry.stepKey === step.key).length;
    const minimum = step.isOptional ? 0 : step.minEntries;
    if (filled < minimum) {
      throw new Error(
        `${scenario.key} (${session.fingerprint}): step "${step.key}" needs ${minimum} entr${minimum === 1 ? 'y' : 'ies'} but the session has ${filled}.`,
      );
    }
    if (step.maxEntries !== null && filled > step.maxEntries) {
      throw new Error(
        `${scenario.key} (${session.fingerprint}): step "${step.key}" allows ${step.maxEntries} entries but the session has ${filled}.`,
      );
    }
    for (const key of step.uniqueBy) {
      const values = evaluated
        .filter((entry) => entry.stepKey === step.key)
        .map((entry) => JSON.stringify(entry.answersByKey[key] ?? null));
      if (new Set(values).size !== values.length) {
        throw new Error(
          `${scenario.key} (${session.fingerprint}): step "${step.key}" requires distinct "${key}" but the session repeats one.`,
        );
      }
    }
  }

  return evaluated;
}

/**
 * Prepare and check one scenario end to end, with no database involved.
 *
 * Form ids are synthetic here when `--check` is running — nothing is persisted,
 * and cross-form references only need ids that are internally consistent.
 */
function prepareScenario(scenario: Scenario, formIdBySlug: Map<string, string>) {
  const prepared = new Map<string, PreparedForm>();
  for (const form of scenario.forms) {
    prepared.set(form.slug, prepareForm(form, scenario, formIdBySlug));
  }

  // Steps must name forms that exist, and a `showWhen` must address a step that
  // comes BEFORE it — the session service evaluates conditions in order and a
  // forward reference silently hides the step forever.
  const seenStepKeys = new Set<string>();
  for (const step of scenario.steps) {
    if (!prepared.has(step.formSlug)) {
      throw new Error(`${scenario.key}: step "${step.key}" names unknown form "${step.formSlug}".`);
    }
    if (step.showWhen) {
      for (const address of collectFields(step.showWhen)) {
        const [stepKey, questionKey] = address.split('.');
        if (!seenStepKeys.has(stepKey)) {
          throw new Error(
            `${scenario.key}: step "${step.key}" is gated on "${address}", but step "${stepKey}" does not come before it.`,
          );
        }
        const sourceStep = scenario.steps.find((candidate) => candidate.key === stepKey)!;
        const sourceForm = prepared.get(sourceStep.formSlug)!;
        if (!sourceForm.structure.questions.some((q: any) => q.key === questionKey)) {
          throw new Error(
            `${scenario.key}: step "${step.key}" is gated on "${address}", but "${sourceStep.formSlug}" has no question keyed "${questionKey}".`,
          );
        }
      }
    }
    seenStepKeys.add(step.key);
  }

  const metadata = metadataIndex(scenario);
  const sessions = scenario.sessions.map((session) => ({
    session,
    entries: evaluateSession(scenario, session, prepared, formIdBySlug, metadata),
  }));

  return { prepared, sessions };
}

/** Every `field` address in an expression. Used to check `showWhen` targets. */
function collectFields(node: ExprNode, out: string[] = []): string[] {
  if (typeof node !== 'object' || node === null) return out;
  if ('field' in node && typeof node.field === 'string') out.push(node.field);
  if ('op' in node && Array.isArray(node.args)) {
    for (const arg of node.args) collectFields(arg, out);
  }
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════
// Check mode
// ═════════════════════════════════════════════════════════════════════════════

function runCheck() {
  console.log('Validating scenarios — structure, rules, and every sample response.\n');

  let forms = 0;
  let rules = 0;
  let sessions = 0;
  let entries = 0;

  for (const scenario of SCENARIOS) {
    // Synthetic but stable ids: nothing is persisted, and a cross-form
    // reference only needs the two sides to agree.
    const formIdBySlug = new Map(scenario.forms.map((form) => [form.slug, `check-${form.slug}`]));
    const { prepared, sessions: evaluated } = prepareScenario(scenario, formIdBySlug);

    console.log(`${scenario.app.icon}  ${scenario.app.name}`);
    console.log(`    ${scenario.headline}`);
    for (const form of prepared.values()) {
      forms += 1;
      rules += form.structure.rules.length;
      console.log(
        `    · ${form.title.padEnd(24)} ${String(form.structure.questions.length).padStart(2)} questions` +
          `  ${String(form.structure.rules.length).padStart(2)} rules` +
          (form.calculatedKeys.length ? `  calc: ${form.calculatedKeys.join(', ')}` : '') +
          (form.lookups.length
            ? `  lookup: ${form.lookups.map((l) => `${l.list}.${l.column}`).join(', ')}`
            : '') +
          (form.referenceCount ? `  refs: ${form.referenceCount}` : ''),
      );
    }
    for (const { session, entries: rows } of evaluated) {
      sessions += 1;
      entries += rows.length;
      console.log(`    · session ${session.fingerprint}: ${rows.length} entries, all rules satisfied`);
    }
    console.log('');
  }

  console.log(
    `OK — ${SCENARIOS.length} apps · ${forms} forms · ${rules} rules · ${sessions} sessions · ${entries} entries.`,
  );
  console.log('Nothing was written; run without --check to seed.');
}

// ═════════════════════════════════════════════════════════════════════════════
// Seed mode
// ═════════════════════════════════════════════════════════════════════════════

async function runSeed() {
  // Imported here rather than at the top so `--check` needs neither a database
  // URL nor the native argon2 binding.
  const { PrismaClient } = await import('@prisma/client');
  const { PrismaPg } = await import('@prisma/adapter-pg');
  const argon2 = await import('argon2');

  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env, or pass --check.');
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });

  try {
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

    const globalLists = await prisma.choiceList.findMany({
      where: { organizationId: null, slug: { in: ['in-states', 'in-districts'] } },
      select: { id: true, slug: true, itemCount: true },
    });
    const globalBySlug = new Map(globalLists.map((list) => [list.slug, list]));
    if (!globalBySlug.has('in-states') || !globalBySlug.has('in-districts')) {
      throw new Error('Global lists `in-states` / `in-districts` are missing. Run `bun run db:seed:choices` first.');
    }

    console.log(`Organization: ${org.name} (${org.slug})`);
    console.log(
      `Reference lists: in-states (${globalBySlug.get('in-states')!.itemCount}), in-districts (${globalBySlug.get('in-districts')!.itemCount})\n`,
    );

    for (const scenario of SCENARIOS) {
      await seedScenario(scenario, {
        prisma,
        argon2,
        organizationId: org.id,
        createdById: member.userId,
        globalListIdBySlug: new Map([...globalBySlug].map(([slug, list]) => [slug, list.id])),
      });
    }

    console.log('─'.repeat(74));
    console.log('Public app URLs:');
    for (const scenario of SCENARIOS) {
      console.log(
        `  ${scenario.app.icon}  ${scenario.app.name.padEnd(34)} ` +
          (scenario.app.publicSlug ? `/a/${scenario.app.publicSlug}` : 'internal only — no public URL'),
      );
    }
    console.log('─'.repeat(74));
  } finally {
    await prisma.$disconnect();
  }
}

interface SeedContext {
  prisma: any;
  argon2: typeof import('argon2');
  organizationId: string;
  createdById: string;
  globalListIdBySlug: Map<string, string>;
}

async function seedScenario(scenario: Scenario, ctx: SeedContext) {
  const { prisma, organizationId, createdById } = ctx;
  console.log(`${scenario.app.icon}  ${scenario.app.name}`);

  // ── Choice lists ─────────────────────────────────────────────────────────
  // Parents first, so a cascading list can name the id of the one above it.
  const listIdBySlug = new Map(ctx.globalListIdBySlug);
  for (const list of scenario.choiceLists) {
    const parentListId = list.parentSlug ? (listIdBySlug.get(list.parentSlug) ?? null) : null;
    if (list.parentSlug && !parentListId) {
      throw new Error(`${scenario.key}: list "${list.slug}" cascades from "${list.parentSlug}", which is not defined before it.`);
    }

    const existing = await prisma.choiceList.findFirst({
      where: { organizationId, slug: list.slug },
      select: { id: true },
    });

    const payload = {
      name: list.name,
      description: list.description,
      parentListId,
      metadataSchema: list.metadataSchema as any,
      deletedAt: null,
    };

    const listId = existing
      ? (await prisma.choiceList.update({ where: { id: existing.id }, data: payload, select: { id: true } })).id
      : (
          await prisma.choiceList.create({
            data: { organizationId, slug: list.slug, ...payload },
            select: { id: true },
          })
        ).id;

    await prisma.choiceItem.deleteMany({ where: { listId } });
    await prisma.choiceItem.createMany({
      data: list.items.map((item, index) => ({
        listId,
        value: item.value,
        label: item.label,
        parentValue: item.parentValue ?? null,
        metadata: (item.metadata ?? {}) as any,
        sortOrder: index,
      })),
    });
    await prisma.choiceList.update({
      where: { id: listId },
      data: { itemCount: list.items.length, version: { increment: 1 } },
    });

    listIdBySlug.set(list.slug, listId);
    console.log(`    list ${list.slug}: ${list.items.length} items`);
  }

  // ── Subject type ─────────────────────────────────────────────────────────
  // Created before the forms, because a form carries the subject type id and
  // the foreign key is enforced.
  const subjectType = await prisma.subjectType.upsert({
    where: {
      organizationId_slug: { organizationId, slug: scenario.subjectType.slug },
    },
    update: {
      name: scenario.subjectType.name,
      icon: scenario.subjectType.icon,
      identityConfig: scenario.subjectType.identityConfig as any,
      deletedAt: null,
    },
    create: {
      organizationId,
      slug: scenario.subjectType.slug,
      name: scenario.subjectType.name,
      icon: scenario.subjectType.icon,
      identityConfig: scenario.subjectType.identityConfig as any,
    },
    select: { id: true },
  });

  // ── Forms ────────────────────────────────────────────────────────────────
  // In declaration order, so a form that references an earlier one finds its id
  // already resolved. The catalogue is ordered registration-first for exactly
  // this reason.
  const formIdBySlug = new Map<string, string>();
  const versionIdBySlug = new Map<string, string>();
  const preparedBySlug = new Map<string, PreparedForm>();

  for (const form of scenario.forms) {
    const existing = await prisma.form.findUnique({
      where: { slug: form.slug },
      select: { id: true, currentVersion: true },
    });
    formIdBySlug.set(form.slug, existing?.id ?? randomUUID());
  }

  for (const form of scenario.forms) {
    const prepared = prepareForm(form, scenario, formIdBySlug);
    preparedBySlug.set(form.slug, prepared);

    const formId = formIdBySlug.get(form.slug)!;
    const existing = await prisma.form.findUnique({
      where: { id: formId },
      select: { id: true, currentVersion: true },
    });
    const nextVersion = (existing?.currentVersion ?? 0) + 1;

    const settings = prepared.settings;
    const theme = normalizeTheme(scenario.app.theme);

    // Hashed with the same parameters `createForm` uses, so a hash seeded here
    // verifies against the same code path a hash set through the API does.
    const passwordHash = settings.password
      ? await ctx.argon2.hash(settings.password, {
          type: ctx.argon2.argon2id,
          timeCost: 3,
          memoryCost: 65536,
          parallelism: 4,
        })
      : null;

    const payload = {
      organizationId,
      createdById,
      slug: form.slug,
      title: form.title,
      description: form.description,
      status: 'PUBLISHED' as const,
      layoutMode: settings.layoutMode ?? 'DOCUMENT',
      isQuizMode: settings.isQuizMode ?? false,
      isPasswordProtected: Boolean(settings.password),
      passwordHash,
      requireAuth: settings.requireAuth ?? false,
      allowMultiple: settings.allowMultiple ?? true,
      maxSubmissions: settings.maxSubmissions ?? null,
      expiresAt: settings.expiresInDays === undefined ? null : at(settings.expiresInDays),
      notifyEmails: (settings.notifyEmails ?? null) as any,
      currentVersion: nextVersion,
      themeConfig: theme as any,
      pagesJson: prepared.structure.pages as any,
      questionsJson: prepared.structure.questions as any,
      logicJson: prepared.structure.logic as any,
      rulesJson: prepared.structure.rules as any,
      subjectTypeId: subjectType.id,
      subjectRole: form.role,
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
        pagesJson: prepared.structure.pages as any,
        questionsJson: prepared.structure.questions as any,
        logicJson: prepared.structure.logic as any,
        themeJson: theme as any,
        rulesJson: prepared.structure.rules as any,
        compiledRules: prepared.compiledPlan as any,
      },
      select: { id: true },
    });
    versionIdBySlug.set(form.slug, version.id);

    console.log(
      `    form ${form.slug} v${nextVersion}: ${prepared.structure.questions.length} questions, ${prepared.structure.rules.length} rules`,
    );
  }

  // The registration form is what mints a subject, so the type points back at
  // it. Set after publishing, because the id only exists by then.
  const registrationSlug = scenario.forms.find((form) => form.role === 'REGISTERS')?.slug;
  if (registrationSlug) {
    await prisma.subjectType.update({
      where: { id: subjectType.id },
      data: { registrationFormId: formIdBySlug.get(registrationSlug)! },
    });
  }

  // ── App ──────────────────────────────────────────────────────────────────
  const appSettings = {
    name: scenario.app.name,
    description: scenario.app.description,
    icon: scenario.app.icon,
    isPublished: scenario.app.isPublished,
    publicSlug: scenario.app.publicSlug,
    themeConfig: normalizeTheme(scenario.app.theme) as any,
    branding: scenario.app.branding as any,
    requireAuth: scenario.app.requireAuth,
    allowDrafts: scenario.app.allowDrafts,
    config: {
      dashboardCards: scenario.app.dashboardCards((slug) => {
        const id = formIdBySlug.get(slug);
        if (!id) throw new Error(`${scenario.key}: dashboard card names unknown form "${slug}".`);
        return id;
      }),
      ...(scenario.app.layoutMode ? { layoutMode: scenario.app.layoutMode } : {}),
    } as any,
    // FIXED when the scenario lists windows and NONE when it does not, which
    // reproduces exactly how every scenario behaved before period modes: a
    // hand-made window closed the app outside itself, and no windows meant
    // always open.
    periodMode:
      scenario.app.periodMode ??
      (scenario.periods.length > 0 ? 'FIXED' : 'NONE'),
    periodConfig: (scenario.app.periodConfig ?? {}) as any,
    deletedAt: null,
  };

  const app = await prisma.formApp.upsert({
    where: { organizationId_slug: { organizationId, slug: scenario.app.slug } },
    update: appSettings,
    create: {
      organizationId,
      subjectTypeId: subjectType.id,
      slug: scenario.app.slug,
      ...appSettings,
    },
    select: { id: true },
  });

  // ── Steps and periods ────────────────────────────────────────────────────
  // Sessions hang off the APP, not off the steps — only entries cascade from a
  // step. Deleting steps alone strips every entry and leaves the sessions
  // behind as empty shells, so both go, in that order.
  await prisma.formAppSession.deleteMany({ where: { appId: app.id } });
  await prisma.formAppStep.deleteMany({ where: { appId: app.id } });
  await prisma.formAppStep.createMany({
    data: scenario.steps.map((step, order) => ({
      appId: app.id,
      formId: formIdBySlug.get(step.formSlug)!,
      key: step.key,
      order,
      title: step.title,
      description: step.description,
      icon: step.icon,
      mode: step.mode,
      // A SINGLE step is filled exactly once; carrying anything else here would
      // contradict the mode the service enforces.
      minEntries: step.mode === 'SINGLE' ? 1 : step.minEntries,
      maxEntries: step.mode === 'SINGLE' ? 1 : step.maxEntries,
      isOptional: step.isOptional,
      scope: step.scope ?? 'SESSION',
      uniqueBy: step.uniqueBy as any,
      occurredAtKey: step.occurredAtKey ?? null,
      schedule: (step.schedule ?? null) as any,
      showWhen: (step.showWhen ?? null) as any,
    })),
  });

  const stepIdByKey = new Map<string, string>(
    (
      await prisma.formAppStep.findMany({
        where: { appId: app.id },
        select: { id: true, key: true },
      })
    ).map((step: { id: string; key: string }) => [step.key, step.id]),
  );

  await prisma.formAppPeriod.deleteMany({ where: { appId: app.id } });
  const periodIds: string[] = [];
  for (const period of scenario.periods) {
    const created = await prisma.formAppPeriod.create({ data: { appId: app.id, ...period }, select: { id: true } });
    periodIds.push(created.id);
  }
  const activePeriodId =
    scenario.periods.findIndex((period) => period.isActive) >= 0
      ? periodIds[scenario.periods.findIndex((period) => period.isActive)]
      : null;

  // ── Sessions ─────────────────────────────────────────────────────────────
  // Written as the app produces them: one session holding one entry per step
  // fill, each pointing at the submission it became. Seeding loose submissions
  // instead would leave the session tables empty and the reports page showing
  // nothing while every individual row looked fine.
  //
  // Cleared and regenerated, scoped strictly to this scenario's own forms and
  // subjects — nothing else in the database is touched.
  const seededFormIds = [...formIdBySlug.values()];
  await prisma.formSubmission.deleteMany({ where: { formId: { in: seededFormIds } } });
  await prisma.subject.deleteMany({
    where: { subjectTypeId: subjectType.id, externalId: { startsWith: 'scn-' } },
  });

  const metadata = metadataIndex(scenario);
  let submissionCount = 0;

  for (const session of scenario.sessions) {
    const entries = evaluateSession(scenario, session, preparedBySlug, formIdBySlug, metadata);

    // The subject the whole session hangs off, minted from the registration
    // entry the way the session service does at submit.
    const registrationEntry = entries.find((entry) => entry.formSlug === registrationSlug);
    const identity = scenario.subjectType.identityConfig as {
      displayName?: string[];
      attributes?: string[];
    };
    const displayName =
      (identity.displayName ?? [])
        .map((key) => registrationEntry?.answersByKey[key])
        .filter((value) => value !== undefined && value !== null && value !== '')
        .join(' ') || session.fingerprint;
    const attributes: Record<string, unknown> = {};
    for (const key of identity.attributes ?? []) {
      const value = registrationEntry?.answersByKey[key];
      if (value !== undefined) attributes[key] = value;
    }

    const subject = await prisma.subject.create({
      data: {
        organizationId,
        subjectTypeId: subjectType.id,
        displayName: String(displayName).slice(0, 200),
        attributes: attributes as any,
        externalId: `scn-${scenario.key}-${session.fingerprint}`,
      },
      select: { id: true },
    });

    const sessionEntries: Array<{
      stepId: string;
      index: number;
      answers: any;
      formVersionId: string;
      submissionId: string;
    }> = [];

    for (const entry of entries) {
      // Provenance and occurrence, computed with the SAME helpers the submit
      // path uses rather than reproduced here. Seeded data that skipped this
      // looked right on the record page and behaved wrong the moment anyone
      // added an entry: with no `form_app_step_id`, three seeded progress
      // checks count as zero, so the app offers a fourth as if it were the
      // first and the demo contradicts itself.
      const step = scenario.steps.find((s) => s.key === entry.stepKey);
      const form = scenario.forms.find((f) => f.slug === entry.formSlug);
      const keyToId = new Map<string, string>(
        (form?.questions ?? [])
          .filter((question) => question.id)
          .map((question) => [question.key ?? question.id, question.id]),
      );

      const submittedAt = at(-session.daysAgo);
      const scopedStep = step
        ? {
            id: stepIdByKey.get(step.key)!,
            key: step.key,
            title: step.title,
            mode: step.mode,
            scope: step.scope ?? ('SESSION' as const),
            minEntries: step.minEntries,
            maxEntries: step.maxEntries,
            isOptional: step.isOptional,
            uniqueBy: step.uniqueBy,
            occurredAtKey: step.occurredAtKey ?? null,
          }
        : null;

      const submission = await prisma.formSubmission.create({
        data: {
          formId: formIdBySlug.get(entry.formSlug)!,
          formVersionId: versionIdBySlug.get(entry.formSlug)!,
          organizationId,
          subjectId: subject.id,
          answers: entry.answersById as any,
          submittedAt,
          occurredAt: scopedStep
            ? occurredAtFor(
                scopedStep,
                entry.answersById as Record<string, unknown>,
                keyToId,
                submittedAt,
              )
            : submittedAt,
          formAppStepId: scopedStep?.id ?? null,
          periodId: activePeriodId,
          occurrenceKey: scopedStep
            ? occurrenceKeyFor(
                scopedStep,
                activePeriodId,
                entry.answersById as Record<string, unknown>,
                keyToId,
              )
            : null,
          status: 'SUBMITTED',
        },
        select: { id: true },
      });
      submissionCount += 1;
      sessionEntries.push({
        stepId: stepIdByKey.get(entry.stepKey)!,
        index: entry.index,
        answers: entry.answersById as any,
        formVersionId: versionIdBySlug.get(entry.formSlug)!,
        submissionId: submission.id,
      });
    }

    await prisma.formAppSession.create({
      data: {
        appId: app.id,
        organizationId,
        periodId: activePeriodId,
        subjectId: subject.id,
        status: 'SUBMITTED',
        // No user account behind a seeded report, so it carries the same
        // anonymous fingerprint an unauthenticated respondent would.
        fingerprint: session.fingerprint,
        startedAt: at(-session.daysAgo),
        submittedAt: at(-session.daysAgo),
        entries: { create: sessionEntries },
      },
    });

    // The registration submission is what created the subject; recording it
    // makes the REGISTRATION reference window resolvable on the server too,
    // not just inside this script.
    if (registrationEntry) {
      const registrationSubmission = sessionEntries.find(
        (entry) => entry.stepId === stepIdByKey.get(registrationEntry.stepKey),
      );
      if (registrationSubmission) {
        await prisma.subject.update({
          where: { id: subject.id },
          data: { registrationSubmissionId: registrationSubmission.submissionId },
        });
      }
    }
  }

  console.log(
    `    app ${scenario.app.slug}: ${scenario.steps.length} steps · ${scenario.periods.length} period(s) · ` +
      `${scenario.sessions.length} sessions · ${submissionCount} submissions\n`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────

(CHECK_ONLY ? Promise.resolve(runCheck()) : runSeed())
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\nFAILED — a scenario is not something this platform would accept:\n');
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
