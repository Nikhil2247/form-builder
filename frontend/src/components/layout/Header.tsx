'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, Building2, LogOut, Menu, Search, Settings, User } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Kbd } from '@/components/ui/kbd';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { StatusBadge } from '@/components/shared/status-badge';
import { useSidebarStore } from '@/store/sidebar-store';
import { useUser, useLogout, usePermissions } from '@/hooks/use-auth';
import { useCommandMenuStore } from '@/store/command-menu-store';
import { useUnreadNotificationCount } from '@/hooks/use-notifications';

/** Human-readable names for URL segments. */
const SEGMENT_TITLES: Record<string, string> = {
  dashboard: 'Dashboard',
  forms: 'Forms',
  builder: 'Builder',
  submissions: 'Responses',
  analytics: 'Analytics',
  templates: 'Templates',
  integrations: 'Integrations',
  trash: 'Trash',
  team: 'Team',
  settings: 'Settings',
  organization: 'Organization',
  billing: 'Billing',
  profile: 'Profile',
  notifications: 'Notifications',
  'org-audit': 'Audit log',
  'global-audit': 'Platform audit',
  platform: 'Platform',
  organizations: 'Organizations',
  users: 'Users',
  'audit-logs': 'Audit logs',
  invite: 'Invitation',
  accept: 'Accept',
};

/** Segments that are ids, not pages — never render them as a crumb label. */
function isOpaqueId(segment: string) {
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment) ||
    /^[0-9a-f]{16,}$/i.test(segment)
  );
}

export function Header() {
  const pathname = usePathname();
  const { open } = useSidebarStore();
  const openCommandMenu = useCommandMenuStore((s) => s.open);
  const { data: session } = useUser();
  const { can } = usePermissions();
  const logout = useLogout();
  // The badge only. The EventSource that keeps it live is mounted once in
  // DashboardLayout — see the note there.
  const { data: notificationCount } = useUnreadNotificationCount();
  const unread = notificationCount?.unreadCount ?? 0;

  const user = session?.user;
  const org = session?.activeOrganization;
  const displayName = user
    ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email
    : '';
  const initials = user
    ? `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`.toUpperCase() ||
      user.email?.[0]?.toUpperCase() ||
      'U'
    : 'U';

  const segments = pathname.split('/').filter(Boolean);
  const crumbs = segments
    .map((segment, index) => ({
      segment,
      href: '/' + segments.slice(0, index + 1).join('/'),
      // Unknown segments get title-cased rather than shown raw; ids are dropped
      // entirely — the old breadcrumb rendered a full UUID as a clickable crumb.
      label: SEGMENT_TITLES[segment] ?? (isOpaqueId(segment) ? null : titleCase(segment)),
    }))
    .filter((crumb) => crumb.label !== null);

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-6">
      <button
        onClick={open}
        aria-label="Open navigation"
        className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground md:hidden"
      >
        <Menu className="size-5" strokeWidth={1.5} />
      </button>

      <nav aria-label="Breadcrumb" className="hidden min-w-0 flex-1 md:block">
        <ol className="flex items-center gap-1.5 text-sm">
          {crumbs.map((crumb, index) => {
            const isLast = index === crumbs.length - 1;
            return (
              <li key={crumb.href} className="flex min-w-0 items-center gap-1.5">
                {index > 0 && (
                  <span aria-hidden className="text-border-strong">
                    /
                  </span>
                )}
                {isLast ? (
                  <span className="truncate font-medium text-foreground" aria-current="page">
                    {crumb.label}
                  </span>
                ) : (
                  <Link
                    href={crumb.href}
                    className="truncate rounded-sm text-muted-foreground hover:text-foreground"
                  >
                    {crumb.label}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="ml-auto flex items-center gap-1.5">
        {/* Opens the existing command palette. Previously this was an <input>
            that accepted text and did nothing with it. */}
        <button
          onClick={openCommandMenu}
          className="hidden h-8 items-center gap-2 rounded-md border border-input bg-muted/40 px-2.5 text-sm
                     text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:flex"
        >
          <Search className="size-3.5" strokeWidth={1.5} />
          <span className="hidden lg:inline">Search…</span>
          <Kbd className="hidden lg:inline-flex">⌘K</Kbd>
        </button>

        {/* Unread notifications. The count is announced to screen readers in
            words — a bare "3" floating next to an icon is meaningless without
            sight of the icon — and capped at 99+ so a neglected inbox cannot
            widen the header. */}
        <Link
          href="/notifications"
          aria-label={
            unread === 0
              ? 'Notifications'
              : `Notifications, ${unread} unread`
          }
          className="relative flex size-8 items-center justify-center rounded-md text-muted-foreground
                     transition-colors hover:bg-muted hover:text-foreground"
        >
          <Bell className="size-4" strokeWidth={1.5} />
          {unread > 0 && (
            <span
              aria-hidden
              className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full
                         bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground"
            >
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Link>

        <ThemeToggle />

        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Account menu"
            className="flex size-8 items-center justify-center rounded-full bg-muted text-xs font-semibold
                       text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {initials}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel>
              <div className="flex flex-col gap-0.5">
                <span className="truncate text-sm font-medium">{displayName}</span>
                <span className="truncate text-xs font-normal text-muted-foreground">
                  {user?.email}
                </span>
                {org && (
                  <span className="mt-1.5 flex items-center gap-1.5">
                    <span className="truncate text-xs font-normal text-muted-foreground">
                      {org.name}
                    </span>
                    <StatusBadge status={org.role} />
                  </span>
                )}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />

            <DropdownMenuItem render={<Link href="/profile" />} className="cursor-pointer">
              <User className="mr-2 size-3.5" strokeWidth={1.5} /> Profile and security
            </DropdownMenuItem>

            {/* Gate the admin entries — the old menu showed Organization and
                Billing to every user, and both 403'd for non-admins. */}
            {can('org:manage') && (
              <DropdownMenuItem
                render={<Link href="/settings/organization" />}
                className="cursor-pointer"
              >
                <Building2 className="mr-2 size-3.5" strokeWidth={1.5} /> Organization
              </DropdownMenuItem>
            )}
            {can('billing:view') && (
              <DropdownMenuItem render={<Link href="/settings/billing" />} className="cursor-pointer">
                <Settings className="mr-2 size-3.5" strokeWidth={1.5} /> Billing
              </DropdownMenuItem>
            )}

            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
              className={cn(
                'cursor-pointer text-destructive',
                'focus:bg-destructive/10 focus:text-destructive',
              )}
            >
              <LogOut className="mr-2 size-3.5" strokeWidth={1.5} />
              {logout.isPending ? 'Signing out…' : 'Sign out'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

function titleCase(segment: string) {
  return segment
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
