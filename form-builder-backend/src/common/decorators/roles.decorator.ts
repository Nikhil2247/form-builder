import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key used by RoleGuard to read the required role.
 */
export const ROLES_KEY = 'requiredRole';

/**
 * @RequiredRole decorator — sets the minimum org role required for a route.
 *
 * Usage:
 *   @RequiredRole('ADMIN')   // Only ADMIN members can access
 *   @RequiredRole('EDITOR')  // EDITOR and ADMIN can access
 *   @RequiredRole('VIEWER')  // Any member can access (same as no decorator)
 *
 * Must be used with RoleGuard (which must come after OrgMemberGuard).
 */
export const RequiredRole = (role: 'ADMIN' | 'EDITOR' | 'VIEWER') =>
  SetMetadata(ROLES_KEY, role);
