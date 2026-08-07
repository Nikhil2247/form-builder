'use client';

import { useMemo } from 'react';
import { allNavGroups, filterNavForRole, type NavGroup } from '@/config/navigation';
import type { Role } from '@/config/roles';

/**
 * Returns navigation groups filtered by the given user roles.
 * Memoized to avoid unnecessary re-computations on re-renders.
 */
export function useFilteredNavigation(userRoles: (Role | string | undefined)[]): NavGroup[] {
  return useMemo(() => filterNavForRole(allNavGroups, userRoles), [userRoles]);
}
