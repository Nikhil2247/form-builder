'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, PanelLeft, PanelLeftClose, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useSidebarStore } from '@/store/sidebar-store';
import { useOrganizations, useUser } from '@/hooks/use-auth';
import { useFilteredNavigation } from '@/hooks/use-filtered-navigation';
import { isNavItemActive, type NavGroup, type NavItem } from '@/config/navigation';
import { StatusBadge } from '@/components/shared/status-badge';
import { OrgSwitcher } from '@/components/layout/OrgSwitcher';
import { ModeSwitcher } from '@/components/layout/ModeSwitcher';

export function Sidebar() {
  const pathname = usePathname();
  const { isCollapsed, isOpen, setCollapsed, close } = useSidebarStore();
  const { data: session } = useUser();
  const navigation = useFilteredNavigation();
  const organizations = useOrganizations();

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

  return (
    <>
      {isOpen && (
        <div
          role="presentation"
          className="fixed inset-0 z-40 bg-foreground/20 backdrop-blur-sm md:hidden"
          onClick={close}
        />
      )}

      <aside
        aria-label="Main navigation"
        className={cn(
          'fixed left-0 top-0 z-50 flex h-dvh w-64 flex-col border-r border-sidebar-border',
          'bg-sidebar text-sidebar-foreground transition-[width,transform] duration-200 ease-out',
          '-translate-x-full md:translate-x-0',
          isOpen && 'translate-x-0',
          isCollapsed ? 'md:w-16' : 'md:w-64',
        )}
      >
        {/* ── Brand ─────────────────────────────────────────────────────── */}
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-sidebar-border px-3">
          <Link
            href="/dashboard"
            className="flex h-8 min-w-0 items-center rounded-md"
            aria-label="ImpactLens home"
          >
            {/* One image, not an icon-box plus a text span: the medium
                logotype already bakes in the wordmark. Collapsing is done by
                clipping the wrapper down to the icon's own width (the mark
                sits in the first ~64 of the SVG's 300 viewBox units) rather
                than swapping images, so it's the same crop the eye already
                knows from the expanded state. */}
            <span
              className={cn(
                'flex h-8 w-[134px] shrink-0 items-center overflow-hidden transition-[width] duration-150',
                isCollapsed && 'md:w-8',
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- next/image's
                  optimizer 400s on local SVGs unless `dangerouslyAllowSVG` is set;
                  not worth loosening for a static decorative logotype. */}
              <img
                src="/logos/impactlens-logo-medium.svg"
                alt=""
                width={134}
                height={32}
                className="h-8 w-[134px] max-w-none shrink-0"
              />
            </span>
          </Link>

          <button
            onClick={() => setCollapsed(!isCollapsed)}
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="hidden shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground md:block"
          >
            {isCollapsed ? (
              <PanelLeft className="size-4" strokeWidth={1.5} />
            ) : (
              <PanelLeftClose className="size-4" strokeWidth={1.5} />
            )}
          </button>

          <button
            onClick={close}
            aria-label="Close navigation"
            className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-sidebar-accent md:hidden"
          >
            <X className="size-4" strokeWidth={1.5} />
          </button>
        </div>

        {/* ── Workspace ─────────────────────────────────────────────────────
            Its own row rather than nested under the brand link: a dropdown
            trigger inside an anchor is both an accessibility violation and
            ambiguous to click. Omitted entirely for a super admin with no
            organization membership — a platform-only account has no workspace
            to switch, so there is nothing this row could ever say. */}
        {organizations.length > 0 && (
          <div className="shrink-0 border-b border-sidebar-border py-1">
            <OrgSwitcher isCollapsed={isCollapsed} />
          </div>
        )}

        {/* ── Navigation ────────────────────────────────────────────────── */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden p-2">
          {navigation.map((group) => (
            <NavSection
              key={group.title}
              group={group}
              isCollapsed={isCollapsed}
              pathname={pathname}
              onNavigate={close}
            />
          ))}
        </nav>

        {/* ── Mode switcher ─────────────────────────────────────────────────
            Sits above the account block so the two persistent context
            controls — which workspace, which mode — bracket the navigation
            rather than being buried in it. Renders nothing when the Data Apps
            feature is off. */}
        <div className="shrink-0 border-t border-sidebar-border">
          <ModeSwitcher isCollapsed={isCollapsed} onNavigate={close} />
        </div>

        {/* ── Account ───────────────────────────────────────────────────── */}
        <div className="border-t border-sidebar-border p-2">
          <Link
            href="/profile"
            onClick={close}
            className={cn(
              'flex items-center gap-2.5 rounded-lg p-2 transition-colors hover:bg-sidebar-accent',
              isCollapsed && 'md:justify-center',
            )}
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
              {initials}
            </span>
            <span
              className={cn(
                'min-w-0 flex-1 overflow-hidden transition-opacity duration-150',
                isCollapsed && 'md:w-0 md:opacity-0',
              )}
            >
              <span className="block truncate text-sm font-medium">{displayName}</span>
              <span className="block truncate text-xs text-muted-foreground">{user?.email}</span>
            </span>
            {!isCollapsed && org?.role && <StatusBadge status={org.role} className="shrink-0" />}
          </Link>
        </div>
      </aside>
    </>
  );
}

function NavSection({
  group,
  isCollapsed,
  pathname,
  onNavigate,
}: {
  group: NavGroup;
  isCollapsed: boolean;
  pathname: string;
  onNavigate: () => void;
}) {
  return (
    <div className="mb-4 last:mb-0">
      {!isCollapsed && (
        <h2 className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {group.title}
        </h2>
      )}
      <ul className="space-y-0.5">
        {group.items.map((item) => (
          <NavRow
            key={item.href}
            item={item}
            isCollapsed={isCollapsed}
            pathname={pathname}
            onNavigate={onNavigate}
          />
        ))}
      </ul>
    </div>
  );
}

function NavRow({
  item,
  isCollapsed,
  pathname,
  onNavigate,
}: {
  item: NavItem;
  isCollapsed: boolean;
  pathname: string;
  onNavigate: () => void;
}) {
  const Icon = item.icon;
  const isActive = isNavItemActive(item, pathname);
  const hasChildren = !!item.children?.length;
  const childActive = item.children?.some((child) => isNavItemActive(child, pathname)) ?? false;

  const [manuallyOpen, setManuallyOpen] = useState<boolean | null>(null);
  // Default to open when a child is active, but let an explicit toggle win —
  // the previous implementation forced the section open whenever a child route
  // matched, so it could not be collapsed while you were inside it.
  const expanded = manuallyOpen ?? childActive;

  const rowClasses = (active: boolean) =>
    cn(
      'flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-sm transition-colors',
      active
        ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
        : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
    );

  if (hasChildren && !isCollapsed) {
    return (
      <li>
        <button
          onClick={() => setManuallyOpen(!expanded)}
          aria-expanded={expanded}
          className={rowClasses(isActive || childActive)}
        >
          <Icon className="size-4 shrink-0" strokeWidth={1.5} />
          <span className="flex-1 text-left">{item.title}</span>
          <ChevronDown
            className={cn('size-3.5 transition-transform', !expanded && '-rotate-90')}
            aria-hidden
          />
        </button>

        {expanded && (
          <ul className="ml-4 mt-0.5 space-y-0.5 border-l border-sidebar-border pl-2">
            {item.children!.map((child) => (
              <NavRow
                key={child.href}
                item={child}
                isCollapsed={isCollapsed}
                pathname={pathname}
                onNavigate={onNavigate}
              />
            ))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <li>
      <Link
        href={item.href}
        onClick={onNavigate}
        title={isCollapsed ? item.title : undefined}
        aria-current={isActive ? 'page' : undefined}
        className={cn(rowClasses(isActive), isCollapsed && 'md:justify-center md:px-2')}
      >
        <Icon className="size-4 shrink-0" strokeWidth={1.5} />
        <span className={cn('truncate', isCollapsed && 'md:hidden')}>{item.title}</span>
        {!isCollapsed && item.badge && (
          <span className="tabular ml-auto rounded bg-muted px-1.5 text-xs text-muted-foreground">
            {item.badge}
          </span>
        )}
      </Link>
    </li>
  );
}
