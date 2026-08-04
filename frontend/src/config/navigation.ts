// Navigation configuration for all roles in the Form Builder platform

import {
  LayoutDashboard,
  FileBox,
  Layers,
  BarChart2,
  Inbox,
  BookTemplate,
  Webhook,
  Trash2,
  Users,
  Building2,
  CreditCard,
  ClipboardList,
  Shield,
  Globe,
  User,
  Bell,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import { ROLES, type Role } from './roles';

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  roles: Role[];
  badge?: string;
  children?: NavItem[];
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Platform Navigation — VIEWER and above
// ─────────────────────────────────────────────────────────────────────────────
export const platformNav: NavGroup = {
  title: 'Platform',
  items: [
    {
      title: 'Dashboard',
      href: '/dashboard',
      icon: LayoutDashboard,
      roles: [ROLES.VIEWER, ROLES.EDITOR, ROLES.ADMIN, ROLES.SUPER_ADMIN],
    },
    {
      title: 'My Forms',
      href: '/forms',
      icon: FileBox,
      roles: [ROLES.VIEWER, ROLES.EDITOR, ROLES.ADMIN, ROLES.SUPER_ADMIN],
    },
    {
      title: 'Submissions',
      href: '/submissions',
      icon: Inbox,
      roles: [ROLES.VIEWER, ROLES.EDITOR, ROLES.ADMIN, ROLES.SUPER_ADMIN],
    },
    {
      title: 'Analytics',
      href: '/analytics',
      icon: BarChart2,
      roles: [ROLES.VIEWER, ROLES.EDITOR, ROLES.ADMIN, ROLES.SUPER_ADMIN],
    },
    {
      title: 'Templates',
      href: '/templates',
      icon: BookTemplate,
      roles: [ROLES.VIEWER, ROLES.EDITOR, ROLES.ADMIN, ROLES.SUPER_ADMIN],
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Builder Navigation — EDITOR and above
// ─────────────────────────────────────────────────────────────────────────────
export const builderNav: NavGroup = {
  title: 'Builder',
  items: [
    {
      title: 'Form Builder',
      href: '/forms/builder',
      icon: Layers,
      roles: [ROLES.EDITOR, ROLES.ADMIN, ROLES.SUPER_ADMIN],
    },
    {
      title: 'Integrations',
      href: '/integrations',
      icon: Webhook,
      roles: [ROLES.EDITOR, ROLES.ADMIN, ROLES.SUPER_ADMIN],
    },
    {
      title: 'Trash',
      href: '/trash',
      icon: Trash2,
      roles: [ROLES.EDITOR, ROLES.ADMIN, ROLES.SUPER_ADMIN],
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Organization Navigation — ADMIN and above
// ─────────────────────────────────────────────────────────────────────────────
export const organizationNav: NavGroup = {
  title: 'Organization',
  items: [
    {
      title: 'Team',
      href: '/team',
      icon: Users,
      roles: [ROLES.ADMIN, ROLES.SUPER_ADMIN],
    },
    {
      title: 'Settings',
      href: '/settings',
      icon: Settings,
      roles: [ROLES.ADMIN, ROLES.SUPER_ADMIN],
      children: [
        {
          title: 'Profile',
          href: '/settings',
          icon: User,
          roles: [ROLES.ADMIN, ROLES.SUPER_ADMIN],
        },
        {
          title: 'Organization',
          href: '/settings/organization',
          icon: Building2,
          roles: [ROLES.ADMIN, ROLES.SUPER_ADMIN],
        },
        {
          title: 'Billing',
          href: '/settings/billing',
          icon: CreditCard,
          roles: [ROLES.ADMIN, ROLES.SUPER_ADMIN],
        },
      ],
    },
    {
      title: 'Audit Logs',
      href: '/org-audit',
      icon: ClipboardList,
      roles: [ROLES.ADMIN, ROLES.SUPER_ADMIN],
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Super Admin Navigation — SUPER_ADMIN only
// ─────────────────────────────────────────────────────────────────────────────
export const superAdminNav: NavGroup = {
  title: 'Super Admin',
  items: [
    {
      title: 'Platform Overview',
      href: '/platform',
      icon: Globe,
      roles: [ROLES.SUPER_ADMIN],
    },
    {
      title: 'Organizations',
      href: '/platform/organizations',
      icon: Building2,
      roles: [ROLES.SUPER_ADMIN],
    },
    {
      title: 'Users',
      href: '/platform/users',
      icon: Users,
      roles: [ROLES.SUPER_ADMIN],
    },
    {
      title: 'Global Audit',
      href: '/global-audit',
      icon: Shield,
      roles: [ROLES.SUPER_ADMIN],
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Account Navigation — all roles
// ─────────────────────────────────────────────────────────────────────────────
export const accountNav: NavGroup = {
  title: 'Account',
  items: [
    {
      title: 'Profile',
      href: '/profile',
      icon: User,
      roles: [ROLES.VIEWER, ROLES.EDITOR, ROLES.ADMIN, ROLES.SUPER_ADMIN],
    },
    {
      title: 'Notifications',
      href: '/notifications',
      icon: Bell,
      roles: [ROLES.VIEWER, ROLES.EDITOR, ROLES.ADMIN, ROLES.SUPER_ADMIN],
    },
  ],
};

// All navigation groups in display order
export const allNavGroups: NavGroup[] = [
  platformNav,
  builderNav,
  organizationNav,
  superAdminNav,
  accountNav,
];

/**
 * Filter navigation groups and items based on user role.
 * Items not accessible to the user's role are hidden.
 */
export function filterNavForRole(groups: NavGroup[], userRole: Role | string | undefined): NavGroup[] {
  if (!userRole) return [];

  return groups
    .map((group) => ({
      ...group,
      items: group.items
        .filter((item) => item.roles.includes(userRole as Role))
        .map((item) => ({
          ...item,
          children: item.children?.filter((child) => child.roles.includes(userRole as Role)),
        })),
    }))
    .filter((group) => group.items.length > 0);
}
