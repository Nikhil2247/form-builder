/**
 * Active-organization resolution.
 *
 * A user may belong to many organizations. "Which one am I looking at?" is a
 * session/UI concern, resolved here from User.lastActiveOrganizationId with a
 * deterministic fallback. It is never an authorization decision — every
 * org-scoped route reads :orgId from the URL and re-checks membership in
 * OrgMemberGuard, so a stale or hostile value here grants nothing.
 *
 * Pure functions over already-fetched rows: no Prisma import, so callers keep
 * control of their own `select` and this stays trivially testable.
 */

export interface MembershipLike {
  organizationId: string;
  joinedAt?: Date;
  organization?: {
    isActive: boolean;
    suspendedAt: Date | null;
  } | null;
}

/** An org is usable when it is active and not under suspension. */
export function isUsable(membership: MembershipLike): boolean {
  const org = membership.organization;
  // Callers that don't select the organization relation can't be judged on it;
  // treat the membership as usable rather than silently dropping it.
  if (!org) return true;
  return org.isActive && !org.suspendedAt;
}

export interface ActiveOrgResolution<T extends MembershipLike> {
  /** The membership the session should default to, if any is usable. */
  active: T | undefined;
  /** Memberships in good standing, oldest first. */
  usable: T[];
  /**
   * True when the user belongs to at least one org but every one of them is
   * suspended. Distinguishes "suspended" from "not in any org yet", which are
   * different messages to the user and different states in the UI.
   */
  allSuspended: boolean;
}

/**
 * Pick the organization a session should open in.
 *
 * Order of preference:
 *  1. lastActiveOrganizationId, when it still refers to a usable membership
 *  2. the earliest-joined usable membership, so the choice is stable across
 *     logins rather than dependent on row order
 */
export function resolveActiveOrganization<T extends MembershipLike>(
  memberships: T[],
  lastActiveOrganizationId?: string | null,
): ActiveOrgResolution<T> {
  const usable = [...memberships].filter(isUsable).sort((a, b) => {
    const aTime = a.joinedAt?.getTime() ?? 0;
    const bTime = b.joinedAt?.getTime() ?? 0;
    return aTime - bTime;
  });

  const preferred = lastActiveOrganizationId
    ? usable.find((m) => m.organizationId === lastActiveOrganizationId)
    : undefined;

  return {
    active: preferred ?? usable[0],
    usable,
    allSuspended: memberships.length > 0 && usable.length === 0,
  };
}
