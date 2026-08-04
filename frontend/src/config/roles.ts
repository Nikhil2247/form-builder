// Role definitions for the Form Builder platform

export const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  EDITOR: 'EDITOR',
  VIEWER: 'VIEWER',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

// Role hierarchy — each level includes all permissions below it
export const ROLE_HIERARCHY: Record<Role, number> = {
  SUPER_ADMIN: 4,
  ADMIN: 3,
  EDITOR: 2,
  VIEWER: 1,
};

/**
 * Check if a given role meets or exceeds the required minimum role.
 */
export function hasRole(userRole: Role | string | undefined, requiredRole: Role): boolean {
  if (!userRole) return false;
  const userLevel = ROLE_HIERARCHY[userRole as Role] ?? 0;
  const requiredLevel = ROLE_HIERARCHY[requiredRole] ?? 0;
  return userLevel >= requiredLevel;
}
