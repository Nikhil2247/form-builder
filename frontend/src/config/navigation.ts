// Sidebar navigation.
//
// Items declare the *permission* they need, not a role. That keeps this file in
// step with the route guards (which check the same permissions), so a link can
// no longer appear for someone whose page then refuses to render — the previous
// role-array approach had exactly that drift: /integrations was listed for
// EDITOR and ADMIN while its layout gated on a different set.

import {
  BarChart2,
  Bell,
  BookTemplate,
  Building2,
  ClipboardList,
  CreditCard,
  FileBox,
  Globe,
  Inbox,
  Layers,
  LayoutDashboard,
  Settings,
  Shield,
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
}

export const workspaceNav: NavGroup = {
  title: 'Workspace',
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
    { title: 'Analytics', href: '/analytics', icon: BarChart2, permissions: ['analytics:view'] },
    { title: 'Templates', href: '/templates', icon: BookTemplate, permissions: ['template:view'] },
  ],
};

export const buildNav: NavGroup = {
  title: 'Build',
  items: [
    { title: 'Form builder', href: '/forms/builder', icon: Layers, permissions: ['form:create'] },
    { title: 'Integrations', href: '/integrations', icon: Webhook, permissions: ['webhook:view'] },
    { title: 'Trash', href: '/trash', icon: Trash2, permissions: ['form:restore'] },
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
  organizationNav,
  platformNav,
  accountNav,
];

/**
 * Drop items the user cannot use, then drop groups left empty.
 *
 * Items with no permissions declared (Profile, Notifications) are always
 * visible to a signed-in user.
 */
export function filterNavigation(
  groups: NavGroup[],
  can: (permission: Permission) => boolean,
): NavGroup[] {
  const allowed = (item: NavItem): boolean => {
    if (item.permissions?.length && !item.permissions.every(can)) return false;
    if (item.anyPermission?.length && !item.anyPermission.some(can)) return false;
    return true;
  };

  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter(allowed).map((item) => ({
        ...item,
        children: item.children?.filter(allowed),
      })),
    }))
    .filter((group) => group.items.length > 0);
}

/** Whether `href` should be highlighted for the current pathname. */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.exact) return pathname === item.href;
  // `/forms` must not light up on `/forms/builder` when both are in the nav,
  // and `/platform` must not light up on `/platform/users`.
  if (pathname === item.href) return true;
  return pathname.startsWith(`${item.href}/`);
}
