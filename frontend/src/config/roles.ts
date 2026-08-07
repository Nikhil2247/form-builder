// Role and permission model for the Form Builder platform.
//
// Two independent axes, which the previous code conflated:
//
//   systemRole  — platform-wide (SUPER_ADMIN | USER). Governs /platform/*.
//   orgRole     — the user's role inside their active organization
//                 (ADMIN | EDITOR | VIEWER). Governs everything else.
//
// A SUPER_ADMIN is not automatically an org ADMIN, and an org ADMIN has no
// platform access. Treating "SUPER_ADMIN" as the top of a single ladder — as
// ROLE_HIERARCHY did — meant a super admin appeared to satisfy org-level checks
// they may hold no membership for.
//
// This mirrors the API's guard chain (JwtAuthGuard → OrgMemberGuard →
// RoleGuard). It is a UX layer only: it decides what to *render*. Every
// decision here is re-made server-side, and nothing on this axis may be
// treated as a security boundary.

export const SYSTEM_ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  USER: 'USER',
} as const;

export type SystemRole = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES];

export const ORG_ROLES = {
  ADMIN: 'ADMIN',
  EDITOR: 'EDITOR',
  VIEWER: 'VIEWER',
} as const;

export type OrgRole = (typeof ORG_ROLES)[keyof typeof ORG_ROLES];

/** Retained for call sites that still reference the flat union. */
export const ROLES = { ...SYSTEM_ROLES, ...ORG_ROLES } as const;
export type Role = SystemRole | OrgRole;

/** Ordering *within* the org axis only. Never mixes in SUPER_ADMIN. */
export const ORG_ROLE_RANK: Record<OrgRole, number> = {
  ADMIN: 3,
  EDITOR: 2,
  VIEWER: 1,
};

export const ORG_ROLE_LABELS: Record<OrgRole, string> = {
  ADMIN: 'Admin',
  EDITOR: 'Editor',
  VIEWER: 'Viewer',
};

export const ORG_ROLE_DESCRIPTIONS: Record<OrgRole, string> = {
  ADMIN: 'Full access to forms, members, billing, and organization settings.',
  EDITOR: 'Can create, edit, publish, and delete forms and view all responses.',
  VIEWER: 'Read-only access to forms, responses, and analytics.',
};

/** True when `role` sits at or above `minimum` on the org ladder. */
export function atLeastOrgRole(
  role: string | null | undefined,
  minimum: OrgRole,
): boolean {
  if (!role) return false;
  const have = ORG_ROLE_RANK[role as OrgRole];
  if (!have) return false;
  return have >= ORG_ROLE_RANK[minimum];
}

// ─────────────────────────────────────────────────────────────────────────────
// Permissions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Named capabilities. Components ask "can I do X", never "is the user an
 * ADMIN" — so changing who may do X is a one-line edit here rather than a
 * sweep through the pages.
 */
export const PERMISSIONS = [
  'form:view',
  'form:create',
  'form:edit',
  'form:delete',
  'form:publish',
  'form:restore',
  'submission:view',
  'submission:export',
  'submission:delete',
  'template:view',
  'template:use',
  'analytics:view',
  'webhook:view',
  'webhook:manage',
  'member:view',
  'member:invite',
  'member:manage',
  'org:view',
  'org:manage',
  'billing:view',
  'billing:manage',
  'audit:view',
  'platform:access',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const VIEWER_PERMISSIONS: Permission[] = [
  'form:view',
  'submission:view',
  'template:view',
  'analytics:view',
];

const EDITOR_PERMISSIONS: Permission[] = [
  ...VIEWER_PERMISSIONS,
  'form:create',
  'form:edit',
  'form:delete',
  'form:publish',
  'form:restore',
  'submission:export',
  'submission:delete',
  'template:use',
];

const ADMIN_PERMISSIONS: Permission[] = [
  ...EDITOR_PERMISSIONS,
  // Webhooks carry a signing secret and can exfiltrate every submission to an
  // arbitrary URL, so the API guards them with @RequiredRole('ADMIN'). Granting
  // them to EDITOR here — as the previous matrix did — put /integrations in an
  // editor's sidebar and then 403'd every request the page made.
  'webhook:view',
  'webhook:manage',
  'member:view',
  'member:invite',
  'member:manage',
  'org:view',
  'org:manage',
  'billing:view',
  'billing:manage',
  'audit:view',
];

export const ORG_ROLE_PERMISSIONS: Record<OrgRole, Permission[]> = {
  VIEWER: VIEWER_PERMISSIONS,
  EDITOR: EDITOR_PERMISSIONS,
  ADMIN: ADMIN_PERMISSIONS,
};

/** Permissions granted by the platform axis, independent of org membership. */
/**
 * Permissions granted by the platform axis alone.
 *
 * `audit:view` is deliberately NOT here. It is the *organization* audit
 * permission, and granting it on the system axis put "Audit log" (which links
 * to /org-audit) in a super admin's sidebar even though they hold no
 * membership. Following it hit the admin layout — correctly gated on
 * `org:manage` — and produced a forbidden page reached from a link the app
 * itself had offered.
 *
 * Platform-wide audit access is covered by `platform:access`, which is what
 * /platform/audit-logs and /global-audit gate on.
 */
const SYSTEM_ROLE_PERMISSIONS: Record<SystemRole, Permission[]> = {
  SUPER_ADMIN: ['platform:access'],
  USER: [],
};

/**
 * Where a signed-in user should land.
 *
 * One rule, used by the login redirect, the middleware, the logo link, and the
 * "go back" action on the forbidden page — so they cannot disagree.
 *
 * The previous login handler sent an org ADMIN to /org-audit (the audit log, of
 * all places) and an EDITOR to /forms/builder (a blank, unsaved new form).
 * Worse, a SUPER_ADMIN with no membership was eligible for /dashboard, which
 * requires `form:view` and therefore refused them.
 */
export function landingRoute(
  systemRole: string | null | undefined,
  orgRole: string | null | undefined,
): string {
  // Org membership decides first: a super admin who is also a member of an
  // organization is usually there to do normal work.
  if (orgRole && ORG_ROLE_RANK[orgRole as OrgRole]) return '/dashboard';
  if (systemRole === SYSTEM_ROLES.SUPER_ADMIN) return '/platform';
  // Signed in but in no organization and not a platform admin — the profile is
  // the only page they can actually use.
  return '/profile';
}

/** The full permission set for a (systemRole, orgRole) pair. */
export function resolvePermissions(
  systemRole: string | null | undefined,
  orgRole: string | null | undefined,
): Set<Permission> {
  const granted = new Set<Permission>();

  const sys = SYSTEM_ROLE_PERMISSIONS[systemRole as SystemRole];
  if (sys) sys.forEach((p) => granted.add(p));

  const org = ORG_ROLE_PERMISSIONS[orgRole as OrgRole];
  if (org) org.forEach((p) => granted.add(p));

  return granted;
}
