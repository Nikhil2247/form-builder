'use client';

import { useMemo } from 'react';
import { allNavGroups, filterNavigation, type NavGroup } from '@/config/navigation';
import { usePermissions } from './use-auth';

/**
 * The sidebar's navigation, filtered to what the current user can actually
 * reach.
 *
 * The previous version took a `userRoles` array as an argument and memoised on
 * it — but the caller built that array inline (`[systemRole, orgRole]`), so a
 * new array identity arrived on every render and the memo never hit. It also
 * special-cased SUPER_ADMIN by *replacing* the role list, which hid the
 * workspace section from a super admin who was also a member of an
 * organization.
 */
export function useFilteredNavigation(): NavGroup[] {
  const { can, permissions } = usePermissions();

  return useMemo(
    () => filterNavigation(allNavGroups, can),
    // `permissions` is a Set rebuilt only when the resolved roles change, so
    // this recomputes exactly when the answer can differ.
    [can, permissions],
  );
}
