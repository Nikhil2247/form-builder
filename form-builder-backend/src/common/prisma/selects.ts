import { Prisma } from '@prisma/client';

/**
 * The predicate every "how many responses does this form have?" count uses.
 *
 * A relation `_count` is a read path like any other, and it was the easiest one
 * to miss: nothing about `_count: { select: { submissions: true } }` looks like
 * a query. Left unfiltered, a form card would read "1,204 responses" above a
 * list that paginates through 1,198 of them, and the only way to discover why
 * would be to count the pages.
 *
 * Both markers, for the reason given at the head of
 * SubmissionsService.listSubmissions: `deletedAt` is the primary, indexed,
 * fully-backfilled filter and `status` is the backstop for a row that reaches
 * DELETED by some route that does not stamp a timestamp.
 */
const undeletedSubmissions = {
  where: { deletedAt: null, status: { not: 'DELETED' } },
} satisfies Prisma.FormCountOutputTypeCountSubmissionsArgs;

/**
 * Shared Prisma `select` projections.
 *
 * ── Why ────────────────────────────────────────────────────────────────────
 * The list endpoints used `include`, which selects *every* scalar column on the
 * model and then adds the relations. For forms that meant every row of a list
 * page carried `questionsJson`, `pagesJson`, `logicJson`, and `themeConfig` —
 * the entire form definition. A 40-question form is on the order of 50–100 KB
 * of JSONB; a page of them is megabytes read from Postgres, serialised, sent
 * over the wire, and parsed by the browser, to render a table showing a title,
 * a status, and a count.
 *
 * It was also a disclosure problem: the form `passwordHash` and `notifyEmails`
 * rode along in every list response.
 *
 * ── The `satisfies` clauses are load-bearing ───────────────────────────────
 * They check each projection against the generated Prisma types. Adding them
 * immediately surfaced six fields the frontend was rendering that do not exist
 * on any model — `Organization.plan`, `Organization.website`,
 * `User.lastLoginAt`, `FormWebhook.events`, `FormWebhook.lastTriggeredAt`, and
 * `FormSubmission.metadata`. Those columns had never been returned by the API,
 * so the UI was displaying `undefined` behind a fallback. Keep the `satisfies`:
 * without it a renamed column fails silently at runtime instead of at build.
 */

// ─────────────────────────────────────────────────────────────────────────────
// User
// ─────────────────────────────────────────────────────────────────────────────

/** Safe to embed anywhere a user is referenced (form author, audit actor). */
export const userSummarySelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  avatarUrl: true,
} satisfies Prisma.UserSelect;

/** The authenticated user's own profile. Never includes secrets. */
export const userProfileSelect = {
  ...userSummarySelect,
  systemRole: true,
  emailVerified: true,
  mfaEnabled: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

/**
 * Login lookup. Deliberately narrow: the password hash and MFA secret are
 * needed here and must not be selected anywhere else.
 */
export const userCredentialsSelect = {
  id: true,
  email: true,
  passwordHash: true,
  firstName: true,
  lastName: true,
  systemRole: true,
  emailVerified: true,
  mfaEnabled: true,
  mfaSecret: true,
  deletedAt: true,
} satisfies Prisma.UserSelect;

/** Platform admin user list. */
export const userAdminSelect = {
  ...userProfileSelect,
  deletedAt: true,
  memberships: {
    select: {
      role: true,
      organization: { select: { id: true, name: true, slug: true } },
    },
  },
} satisfies Prisma.UserSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Form
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List rows. No JSON definition columns, no password hash, no notify list —
 * a list view needs none of them, and the builder fetches the full record by id
 * when it actually opens a form.
 */
export const formListSelect = {
  id: true,
  slug: true,
  title: true,
  description: true,
  status: true,
  isQuizMode: true,
  currentVersion: true,
  expiresAt: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: userSummarySelect },
  _count: { select: { submissions: undeletedSubmissions } },
} satisfies Prisma.FormSelect;

/** Trash rows: the list projection plus when it was deleted. */
export const formTrashSelect = {
  ...formListSelect,
  deletedAt: true,
} satisfies Prisma.FormSelect;

/**
 * The full editable record, for the builder. This is the only place the JSON
 * definition columns are returned — and `passwordHash` still is not.
 */
export const formDetailSelect = {
  id: true,
  organizationId: true,
  createdById: true,
  slug: true,
  title: true,
  description: true,
  status: true,
  layoutMode: true,
  isQuizMode: true,
  isPasswordProtected: true,
  requireAuth: true,
  allowMultiple: true,
  maxSubmissions: true,
  expiresAt: true,
  currentVersion: true,
  themeConfig: true,
  pagesJson: true,
  questionsJson: true,
  logicJson: true,
  // The builder round-trips the whole definition: without rulesJson the rules
  // panel reloads empty and the next autosave writes that emptiness back,
  // silently destroying the author's rules.
  rulesJson: true,
  // Decides whether cross-form references are offered in the rule builder —
  // they are only valid on a form bound to a subject type.
  subjectTypeId: true,
  subjectRole: true,
  notifyEmails: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: userSummarySelect },
  _count: { select: { submissions: undeletedSubmissions } },
} satisfies Prisma.FormSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Submission
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List rows WITHOUT the answers blob.
 *
 * Answers are the heaviest column on the model, and the plain list view shows
 * only who responded and when. The grid view opts into `submissionGridSelect`.
 */
export const submissionListSelect = {
  id: true,
  formId: true,
  formVersionId: true,
  submittedAt: true,
  processedAt: true,
  completionTimeMs: true,
  status: true,
  country: true,
  quizScore: true,
  maxQuizScore: true,
  isPassed: true,
  respondent: { select: userSummarySelect },
} satisfies Prisma.FormSubmissionSelect;

/** List rows for the spreadsheet view, which does need the answers. */
export const submissionGridSelect = {
  ...submissionListSelect,
  answers: true,
} satisfies Prisma.FormSubmissionSelect;

/** A single response, opened from the list. */
export const submissionDetailSelect = {
  ...submissionGridSelect,
  form: { select: { id: true, title: true, slug: true } },
} satisfies Prisma.FormSubmissionSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Organization
// ─────────────────────────────────────────────────────────────────────────────

export const organizationSummarySelect = {
  id: true,
  name: true,
  slug: true,
  logoUrl: true,
  isActive: true,
} satisfies Prisma.OrganizationSelect;

export const organizationDetailSelect = {
  ...organizationSummarySelect,
  maxForms: true,
  maxSubmissionsMonth: true,
  maxMembers: true,
  storageQuotaBytes: true,
  storageUsedBytes: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { members: true, forms: true } },
} satisfies Prisma.OrganizationSelect;

/** Platform admin list. Adds suspension state. */
export const organizationAdminSelect = {
  ...organizationSummarySelect,
  suspendedAt: true,
  suspendReason: true,
  storageUsedBytes: true,
  storageQuotaBytes: true,
  maxForms: true,
  maxMembers: true,
  createdAt: true,
  _count: { select: { members: true, forms: true } },
} satisfies Prisma.OrganizationSelect;

/** Note: the join row's timestamp is `joinedAt`, not `createdAt`. */
export const memberSelect = {
  id: true,
  userId: true,
  role: true,
  joinedAt: true,
  user: { select: userSummarySelect },
} satisfies Prisma.OrganizationMemberSelect;

export const invitationSelect = {
  id: true,
  email: true,
  role: true,
  status: true,
  expiresAt: true,
  acceptedAt: true,
  createdAt: true,
  invitedBy: { select: userSummarySelect },
} satisfies Prisma.OrganizationInvitationSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Audit
// ─────────────────────────────────────────────────────────────────────────────

export const auditLogSelect = {
  id: true,
  action: true,
  resource: true,
  resourceId: true,
  metadata: true,
  ipAddress: true,
  createdAt: true,
  // Relation added in this change — the column existed but was never joinable,
  // so every audit entry rendered without an actor.
  user: { select: userSummarySelect },
  organization: { select: { id: true, name: true } },
} satisfies Prisma.AuditLogSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Webhooks
// ─────────────────────────────────────────────────────────────────────────────

/** Never includes `secret` — it is encrypted at rest and shown once on create. */
export const webhookSelect = {
  id: true,
  url: true,
  name: true,
  isActive: true,
  createdAt: true,
  _count: { select: { deliveries: true } },
} satisfies Prisma.FormWebhookSelect;

export const webhookDeliverySelect = {
  id: true,
  submissionId: true,
  statusCode: true,
  attempt: true,
  success: true,
  deliveredAt: true,
  // Capped to 512 bytes at write time, so it is safe to return whole.
  responseBody: true,
} satisfies Prisma.WebhookDeliverySelect;

// ─────────────────────────────────────────────────────────────────────────────
// Notifications
// ─────────────────────────────────────────────────────────────────────────────

export const notificationSelect = {
  id: true,
  type: true,
  title: true,
  body: true,
  metadata: true,
  isRead: true,
  createdAt: true,
} satisfies Prisma.NotificationSelect;
