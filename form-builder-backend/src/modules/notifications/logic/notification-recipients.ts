/**
 * Who receives a given notification.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Deliberately a pure function over a plain list of members, with no Prisma, no
 * Redis and no Nest in scope. Fan-out is the part of a notification system that
 * leaks data when it is wrong — "member joined" carries the joiner's email
 * address, "quota warning" carries commercial data about the account — and the
 * only way to get real coverage on it is to be able to call it directly with a
 * fabricated roster. `notification-recipients.spec.ts` does exactly that.
 *
 * ── Two rules, both of which have to hold ──────────────────────────────────
 *
 *  1. ORG SCOPE. A member list is always fetched for ONE organization, and the
 *     event carries the organization it belongs to. `selectRecipients` refuses
 *     to fan out when the two disagree rather than trusting the caller to have
 *     queried the right org — a mismatch there is a cross-tenant leak, and
 *     "the caller passed the wrong list" is a mistake that only ever shows up
 *     in production.
 *
 *  2. ROLE. Notification content mirrors what a role may already read through
 *     the API, so the minimum role per type below tracks the guard on the page
 *     the notification deep-links to. A VIEWER can read submissions
 *     (`submission:view`) and so is told about new ones; a VIEWER cannot read
 *     the member roster, webhook configuration or billing, and so is told about
 *     none of those. Sending them anyway would be an information disclosure
 *     dressed up as a convenience — the notification body is the leak, whether
 *     or not the link 403s when they follow it.
 *
 * NOTE ON WEBHOOKS: webhook routes are guarded with `@RequiredRole('ADMIN')`,
 * not EDITOR. That is not an oversight in the guard — a webhook holds a signing
 * secret and can forward every submission to an arbitrary URL. Delivery-failure
 * notifications therefore go to ADMINs only, matching who can actually go and
 * fix the endpoint.
 */

/** The org-level role axis. Mirrors `ROLE_HIERARCHY` in `role.guard.ts`. */
export type OrgRole = 'ADMIN' | 'EDITOR' | 'VIEWER';

const ORG_ROLE_RANK: Record<OrgRole, number> = {
  ADMIN: 3,
  EDITOR: 2,
  VIEWER: 1,
};

/**
 * Every notification type the platform emits.
 *
 * The string values are persisted in `Notification.type` and are matched by the
 * frontend to pick an icon and a deep link, so they are a wire contract: rename
 * one and every historical row becomes unrenderable.
 */
export const NOTIFICATION_TYPES = {
  NEW_SUBMISSION: 'new_submission',
  MEMBER_JOINED: 'member_joined',
  WEBHOOK_FAILED: 'webhook_failed',
  QUOTA_WARNING: 'quota_warning',
} as const;

export type NotificationType =
  (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

/**
 * Minimum org role for each type, chosen to match the permission that already
 * gates the underlying data:
 *
 *   new_submission → `submission:view` → VIEWER and above
 *   member_joined  → `member:view`     → ADMIN only
 *   webhook_failed → `webhook:view`    → ADMIN only (see the note above)
 *   quota_warning  → `billing:view`    → ADMIN only
 */
const MINIMUM_ROLE: Record<NotificationType, OrgRole> = {
  [NOTIFICATION_TYPES.NEW_SUBMISSION]: 'VIEWER',
  [NOTIFICATION_TYPES.MEMBER_JOINED]: 'ADMIN',
  [NOTIFICATION_TYPES.WEBHOOK_FAILED]: 'ADMIN',
  [NOTIFICATION_TYPES.QUOTA_WARNING]: 'ADMIN',
};

/** The shape `organizationMember.findMany` is asked for. Nothing more is needed. */
export interface OrgMemberRef {
  userId: string;
  /** Typed loosely because Prisma hands back the enum as a plain string. */
  role: string;
  organizationId: string;
}

export interface NotificationEvent {
  /** The organization the event happened in. Must match every member's org. */
  organizationId: string;
  type: NotificationType;
  /**
   * The user who caused the event, when there is one.
   *
   * Excluded from the audience: an admin who invited someone does not need to
   * be told that the person accepted, and telling the person who just submitted
   * a form that a form was just submitted is noise. Anonymous respondents have
   * no user id, so this is usually null for `new_submission`.
   */
  actorUserId?: string | null;
}

/**
 * The users who should receive `event`, given the organization's full roster.
 *
 * Returns ids in the order the members were supplied, deduplicated. An empty
 * array is a completely normal answer — an org whose only ADMIN is the actor
 * has nobody to tell — and callers must treat it as "write nothing" rather
 * than as an error.
 */
export function selectRecipients(
  members: readonly OrgMemberRef[],
  event: NotificationEvent,
): string[] {
  const minimum = MINIMUM_ROLE[event.type];

  // Fail CLOSED on an unrecognised type. A type with no entry in MINIMUM_ROLE
  // has no declared audience, and the safe reading of "no declared audience" is
  // nobody — not everybody. This is the branch that catches a new notification
  // type being added here without its role rule being thought about.
  if (!minimum) return [];

  const seen = new Set<string>();
  const recipients: string[] = [];

  for (const member of members) {
    // Rule 1: never fan out across tenants, even if the caller handed us a
    // mixed list. Silently skipping is right rather than throwing — a stray row
    // must not stop the members who legitimately qualify from being notified.
    if (member.organizationId !== event.organizationId) continue;

    if (!member.userId) continue;
    if (event.actorUserId && member.userId === event.actorUserId) continue;

    // Rule 2. An unknown role string ranks 0 and therefore never clears any
    // threshold, so a role added to the schema without being added here fails
    // closed too.
    const rank = ORG_ROLE_RANK[member.role as OrgRole] ?? 0;
    if (rank < ORG_ROLE_RANK[minimum]) continue;

    if (seen.has(member.userId)) continue;
    seen.add(member.userId);
    recipients.push(member.userId);
  }

  return recipients;
}

/** The minimum role a type requires. Exported for the wiring documentation. */
export function minimumRoleFor(type: NotificationType): OrgRole | undefined {
  return MINIMUM_ROLE[type];
}

// ═══════════════════════════════════════════════════════════════════════════
// Quota thresholds
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Percentages of the monthly submission allowance worth interrupting an admin
 * for. 80% leaves time to act; 100% is the moment ingest starts rejecting.
 */
export const QUOTA_THRESHOLDS = [80, 100] as const;

/** Checked high-to-low, so an increment that clears both reports the worse one. */
const DESCENDING_THRESHOLDS = [...QUOTA_THRESHOLDS].sort((a, b) => b - a);

/**
 * The threshold this submission just crossed, if any.
 *
 * Called with the counter value BEFORE and AFTER a single increment, so it
 * fires exactly once per threshold per month however many pods are counting:
 * only the one increment that steps over the line sees `previous` below it and
 * `current` at or above it. Deriving it from a snapshot of the counter instead
 * ("is usage >= 80%?") would notify on every submission for the rest of the
 * month, which is how these features usually get switched off by the user.
 *
 * The threshold count rounds UP: on an allowance of 7, 80% is submission 6, not
 * submission 5. Rounding down would warn at 71% of the real allowance.
 *
 * Returning null — the overwhelmingly common case — must cost nothing, because
 * this runs on the hot ingest path for every submission.
 */
export function crossedQuotaThreshold(
  previous: number,
  current: number,
  limit: number,
): number | null {
  if (!Number.isFinite(limit) || limit <= 0) return null;
  // The ingest path decrements the counter when it rejects a submission, so a
  // non-advancing pair is expected and must not re-fire anything.
  if (current <= previous) return null;

  for (const percent of DESCENDING_THRESHOLDS) {
    const at = Math.ceil((limit * percent) / 100);
    if (previous < at && current >= at) return percent;
  }

  return null;
}
