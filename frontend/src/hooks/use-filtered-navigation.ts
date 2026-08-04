'use client';

import { useMemo } from 'react';
import { allNavGroups, filterNavForRole, type NavGroup } from '@/config/navigation';
import type { Role } from '@/config/roles';

/**
 * Returns navigation groups filtered by the given user role.
 * Memoized to avoid unnecessary re-computations on re-renders.
 */
export function useFilteredNavigation(userRole: Role | string | undefined): NavGroup[] {
  return useMemo(() => filterNavForRole(allNavGroups, userRole), [userRole]);
}
