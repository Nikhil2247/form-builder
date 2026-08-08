'use client';

import { useEffect, useMemo } from 'react';
import { usePathname } from 'next/navigation';

import {
  allNavGroups,
  filterNavigation,
  modeForPath,
  type NavGroup,
  type NavMode,
} from '@/config/navigation';
import { usePermissions } from './use-auth';
import { useFeature, FEATURES } from './use-features';
import { useNavModeStore } from '@/store/nav-mode-store';

/**
 * The sidebar's navigation, filtered to what the current user can reach in the
 * mode they are currently in.
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
  const mode = useNavMode();

  return useMemo(
    () => filterNavigation(allNavGroups, can, mode),
    // `permissions` is a Set rebuilt only when the resolved roles change, so
    // this recomputes exactly when the answer can differ.
    [can, permissions, mode],
  );
}

/**
 * The active sidebar mode.
 *
 * Two things can set it: the switcher, and the URL. The URL wins — arriving at
 * /records by deep link or the back button must show the Data Apps sidebar,
 * not whichever button was last pressed. Without this the chrome and the page
 * disagree, which reads as a bug.
 *
 * Collapses to 'forms' whenever the FORM_APPS flag is off, so disabling the
 * feature cannot strand a user in a mode whose navigation has vanished.
 */
export function useNavMode(): NavMode {
  const pathname = usePathname();
  const appsEnabled = useFeature(FEATURES.FORM_APPS);
  const { mode: storedMode, setMode } = useNavModeStore();

  const pathMode = modeForPath(pathname);
  const effectiveMode: NavMode = !appsEnabled ? 'forms' : (pathMode ?? storedMode);

  // Keep the store in step with where the user actually navigated, so the
  // switcher reflects reality and a later reload lands in the same place.
  useEffect(() => {
    if (pathMode && pathMode !== storedMode) setMode(pathMode);
  }, [pathMode, storedMode, setMode]);

  return effectiveMode;
}
