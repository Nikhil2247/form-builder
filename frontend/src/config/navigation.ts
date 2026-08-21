// Sidebar navigation.
//
// Items declare the *permission* they need, not a role. That keeps this file in
// step with the route guards (which check the same permissions), so a link can
// no longer appear for someone whose page then refuses to render — the previous
// role-array approach had exactly that drift: /integrations was listed for
// EDITOR and ADMIN while its layout gated on a different set.

import {
  Activity,
  Bell,
  BookMarked,
  BookTemplate,
  Boxes,
  Building2,
  ClipboardList,
  Coins,
  Contact,
  CreditCard,
  FileBox,
  Globe,
  Inbox,
  Layers,
  LayoutDashboard,
  LayoutGrid,
  Settings,
  Shield,
  Smartphone,
  ToggleLeft,
  Trash2,
  User,
  Users,
  Webhook,
  type LucideIcon,
} from 'lucide-react';
import type { Permission } from './roles';

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  /** Every listed permission is required for the item to appear. */
  permissions?: Permission[];
  /** At least one of these is required. */
  anyPermission?: Permission[];
  badge?: string;
  children?: NavItem[];
  /** Match the active state on the exact path only (for index routes). */
  exact?: boolean;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
  /**
   * Which workspace mode this group belongs to.
   *
   * 'forms' — the form builder the product has always been
   * 'apps'  — the data-entry surface over subject records
   * omitted — shown in both (Organization, Platform, Account)
   *
   * The two modes are deliberately separate rather than one long sidebar: a
   * data-entry user and a form author want different things on screen, and
   * merging them would leave both with a menu mostly full of the other's tools.
   */
  mode?: NavMode;
}

export type NavMode = 'forms' | 'apps';

export const workspaceNav: NavGroup = {
  title: 'Workspace',
  mode: 'forms',
  items: [
    {
      title: 'Dashboard',
      href: '/dashboard',
      icon: LayoutDashboard,
      permissions: ['form:view'],
      exact: true,
    },
    { title: 'Forms', href: '/forms', icon: FileBox, permissions: ['form:view'] },
    { title: 'Responses', href: '/submissions', icon: Inbox, permissions: ['submission:view'] },
    { title: 'Templates', href: '/templates', icon: BookTemplate, permissions: ['template:view'] },
  ],
};

export const buildNav: NavGroup = {
  title: 'Build',
  mode: 'forms',
  items: [
    { title: 'Form builder', href: '/forms/builder', icon: Layers, permissions: ['form:create'] },
    { title: 'Integrations', href: '/integrations', icon: Webhook, permissions: ['webhook:view'] },
    { title: 'Trash', href: '/trash', icon: Trash2, permissions: ['form:restore'] },
  ],
};

/**
 * Data Apps mode — the subject-record surface.
 *
 * Gated behind the FORM_APPS feature flag, so this entire mode is invisible
 * until a super-admin enables it. Existing installations see no change.
 */
export const appsNav: NavGroup = {
  title: 'Data entry',
  mode: 'apps',
  items: [
    { title: 'Apps', href: '/apps', icon: LayoutGrid, permissions: ['form:view'], exact: true },
    { title: 'Records', href: '/records', icon: Contact, permissions: ['form:view'] },
  ],
};

export const appsBuildNav: NavGroup = {
  title: 'Configure',
  mode: 'apps',
  items: [
    { title: 'Record types', href: '/record-types', icon: Boxes, permissions: ['form:create'] },
    { title: 'App builder', href: '/apps/builder', icon: Smartphone, permissions: ['form:create'] },
  ],
};

export const organizationNav: NavGroup = {
  title: 'Organization',
  items: [
    { title: 'Team', href: '/team', icon: Users, permissions: ['member:view'] },
    {
      title: 'Settings',
      href: '/settings',
      icon: Settings,
      permissions: ['org:manage'],
      children: [
        { title: 'General', href: '/settings', icon: Settings, permissions: ['org:manage'], exact: true },
        {
          title: 'Organization',
          href: '/settings/organization',
          icon: Building2,
          permissions: ['org:manage'],
        },
        {
          title: 'Billing',
          href: '/settings/billing',
          icon: CreditCard,
          permissions: ['billing:view'],
        },
      ],
    },
    // Reference data the org's dropdowns draw from. Sits under Organization
    // rather than Build because it is curated once and used by every form,
    // which is how settings behave and not how the builder does.
    { title: 'Option lists', href: '/dictionary', icon: BookMarked, permissions: ['org:manage'] },
    { title: 'Audit log', href: '/org-audit', icon: ClipboardList, permissions: ['audit:view'] },
  ],
};

export const platformNav: NavGroup = {
  title: 'Platform',
  items: [
    {
      title: 'Overview',
      href: '/platform',
      icon: Globe,
      permissions: ['platform:access'],
      exact: true,
    },
    {
      title: 'Organizations',
      href: '/platform/organizations',
      icon: Building2,
      permissions: ['platform:access'],
    },
    { title: 'Users', href: '/platform/users', icon: Users, permissions: ['platform:access'] },
    {
      title: 'Global dictionary',
      href: '/platform/dictionary',
      icon: BookMarked,
      permissions: ['platform:access'],
    },
    {
      title: 'System health',
      href: '/platform/system',
      icon: Activity,
      permissions: ['platform:access'],
    },
    {
      title: 'Assistant usage',
      href: '/platform/assistant',
      icon: Coins,
      permissions: ['platform:access'],
    },
    {
      title: 'Features',
      href: '/platform/features',
      icon: ToggleLeft,
      permissions: ['platform:access'],
    },
    {
      title: 'Audit logs',
      href: '/platform/audit-logs',
      icon: Shield,
      permissions: ['platform:access'],
    },
  ],
};

export const accountNav: NavGroup = {
  title: 'Account',
  items: [
    { title: 'Profile', href: '/profile', icon: User },
    { title: 'Notifications', href: '/notifications', icon: Bell },
  ],
};

export const allNavGroups: NavGroup[] = [
  workspaceNav,
  buildNav,
  appsNav,
  appsBuildNav,
  organizationNav,
  platformNav,
  accountNav,
];

/**
 * Drop items the user cannot use, then drop groups left empty.
 *
 * Items with no permissions declared (Profile, Notifications) are always
 * visible to a signed-in user. Groups carrying a `mode` appear only in that
 * mode; groups without one (Organization, Platform, Account) appear in both.
 */
export function filterNavigation(
  groups: NavGroup[],
  can: (permission: Permission) => boolean,
  mode: NavMode = 'forms',
): NavGroup[] {
  const allowed = (item: NavItem): boolean => {
    if (item.permissions?.length && !item.permissions.every(can)) return false;
    if (item.anyPermission?.length && !item.anyPermission.some(can)) return false;
    return true;
  };

  return groups
    .filter((group) => group.mode === undefined || group.mode === mode)
    .map((group) => ({
      ...group,
      items: group.items.filter(allowed).map((item) => ({
        ...item,
        children: item.children?.filter(allowed),
      })),
    }))
    .filter((group) => group.items.length > 0);
}

/** Route prefixes that belong to Data Apps mode. */
const APPS_PREFIXES = ['/apps', '/records', '/record-types'];

/**
 * Which mode a path belongs to.
 *
 * Used to keep the switcher honest when a user arrives by deep link or the
 * back button — the sidebar should reflect where they actually are, not the
 * last button they pressed.
 */
export function modeForPath(pathname: string): NavMode | null {
  if (APPS_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return 'apps';
  return null;
}

/** Whether `href` should be highlighted for the current pathname. */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.exact) return pathname === item.href;
  // `/forms` must not light up on `/forms/builder` when both are in the nav,
  // and `/platform` must not light up on `/platform/users`.
  if (pathname === item.href) return true;
  return pathname.startsWith(`${item.href}/`);
}
