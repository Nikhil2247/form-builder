'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  PanelLeftClose,
  PanelLeft,
  X,
  ChevronDown,
  MessageCircle,
  LogOut,
  User,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSidebarStore } from '@/store/sidebar-store';
import { useUser } from '@/hooks/use-auth';
import { useFilteredNavigation } from '@/hooks/use-filtered-navigation';
import { type NavGroup, type NavItem } from '@/config/navigation';

export function Sidebar() {
  const pathname = usePathname();
  const { isCollapsed, isOpen, setCollapsed, close } = useSidebarStore();
  const { data: session } = useUser();

  const systemRole = session?.user?.systemRole;
  const orgRole = session?.activeOrganization?.role;
  
  // If user is a Super Admin, strictly limit their view to Super Admin routes
  // to prevent cluttering the sidebar with organization-specific links.
  const activeRoles = systemRole === 'SUPER_ADMIN' ? [systemRole] : [systemRole, orgRole];
  const navigation = useFilteredNavigation(activeRoles);

  const user = session?.user;
  const displayName = user ? `${user.firstName} ${user.lastName}`.trim() || user.email : 'User';
  const displayEmail = user?.email ?? '';
  const initials = user
    ? `${user.firstName?.charAt(0) ?? ''}${user.lastName?.charAt(0) ?? ''}`.toUpperCase() || 'U'
    : 'U';

  return (
    <>
      {/* Mobile overlay backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
          onClick={close}
        />
      )}

      <aside
        className={cn(
          'fixed left-0 top-0 z-50 flex h-screen flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground shadow-xl transition-all duration-300 ease-in-out',
          // Mobile: hidden by default, shown when isOpen
          '-translate-x-full md:translate-x-0',
          isOpen && 'translate-x-0',
          // Desktop width: 256px expanded, 64px collapsed
          isCollapsed ? 'md:w-16' : 'md:w-64',
          // Always 64px on mobile (full width when open handled by translate)
          'w-64',
        )}
      >
        {/* ── Logo + Toggle ── */}
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-sidebar-border px-4">
          <Link href="/dashboard" className="flex items-center gap-2.5 overflow-hidden">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground shadow-sm">
              <MessageCircle size={16} fill="currentColor" strokeWidth={0} />
            </div>
            <div
              className={cn(
                'overflow-hidden transition-all duration-300',
                isCollapsed ? 'md:w-0 md:opacity-0' : 'md:w-auto md:opacity-100',
              )}
            >
              <div className="text-sm font-bold leading-none tracking-tight whitespace-nowrap">
                FormBuilder
              </div>
              <div className="mt-0.5 text-[10px] font-medium uppercase tracking-widest text-sidebar-foreground/60 whitespace-nowrap">
                Enterprise
              </div>
            </div>
          </Link>

          {/* Desktop collapse toggle */}
          <button
            onClick={() => setCollapsed(!isCollapsed)}
            className="hidden rounded-md p-1.5 text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-foreground md:flex"
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {isCollapsed ? <PanelLeft size={16} strokeWidth={1.5} /> : <PanelLeftClose size={16} strokeWidth={1.5} />}
          </button>

          {/* Mobile close button */}
          <button
            onClick={close}
            className="rounded-md p-1.5 text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-foreground md:hidden"
            aria-label="Close sidebar"
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        {/* ── Navigation ── */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden p-2 scrollbar-thin">
          {navigation.map((group, i) => (
            <NavGroupSection
              key={i}
              group={group}
              isCollapsed={isCollapsed}
              pathname={pathname}
              onNavigate={close}
            />
          ))}
        </nav>

        {/* ── User Profile Footer ── */}
        <div
          className={cn(
            'border-t border-sidebar-border p-3 transition-all duration-300',
            isCollapsed && 'md:p-2',
          )}
        >
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sidebar-primary to-sidebar-primary/60 text-sidebar-primary-foreground text-sm font-bold shadow-md">
              {initials}
            </div>
            <div
              className={cn(
                'min-w-0 flex-1 overflow-hidden transition-all duration-300',
                isCollapsed && 'md:w-0 md:opacity-0',
              )}
            >
              <p className="truncate text-sm font-semibold text-sidebar-foreground">{displayName}</p>
              <p className="truncate text-[11px] text-sidebar-foreground/60">{displayEmail}</p>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// NavGroupSection
// ─────────────────────────────────────────────────────────────────────────────
interface NavGroupSectionProps {
  group: NavGroup;
  isCollapsed: boolean;
  pathname: string;
  onNavigate: () => void;
}

function NavGroupSection({ group, isCollapsed, pathname, onNavigate }: NavGroupSectionProps) {
  return (
    <div className="mb-4">
      {!isCollapsed && (
        <p className="mb-1 px-3 text-[10px] font-bold uppercase tracking-widest text-sidebar-foreground/40">
          {group.title}
        </p>
      )}
      <ul className="space-y-0.5">
        {group.items.map((item, i) => (
          <NavItemComponent
            key={i}
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

// ─────────────────────────────────────────────────────────────────────────────
// NavItemComponent
// ─────────────────────────────────────────────────────────────────────────────
interface NavItemComponentProps {
  item: NavItem;
  isCollapsed: boolean;
  pathname: string;
  onNavigate: () => void;
  depth?: number;
}

function NavItemComponent({
  item,
  isCollapsed,
  pathname,
  onNavigate,
  depth = 0,
}: NavItemComponentProps) {
  const hasChildren = item.children && item.children.length > 0;
  const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href + '/'));
  const isChildActive = item.children?.some(
    (child) => pathname === child.href || pathname.startsWith(child.href + '/'),
  );

  const [isExpanded, setIsExpanded] = useState(isChildActive || false);
  const Icon = item.icon;

  const shouldBeOpen = isExpanded || isChildActive;

  if (hasChildren && !isCollapsed) {
    return (
      <li>
        <button
          onClick={() => setIsExpanded(!shouldBeOpen)}
          className={cn(
            'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200',
            isActive || isChildActive
              ? 'bg-sidebar-accent text-sidebar-accent-foreground'
              : 'text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
          )}
        >
          <Icon
            size={16}
            strokeWidth={1.5}
            className={cn(
              'shrink-0',
              isActive || isChildActive
                ? 'text-sidebar-accent-foreground'
                : 'text-sidebar-foreground/50',
            )}
          />
          <span className="flex-1 text-left">{item.title}</span>
          <ChevronDown
            size={14}
            className={cn(
              'text-sidebar-foreground/40 transition-transform duration-200',
              !shouldBeOpen && '-rotate-90',
            )}
          />
        </button>
        {shouldBeOpen && (
          <ul className="ml-4 mt-0.5 space-y-0.5 border-l border-sidebar-border pl-3">
            {item.children?.map((child, i) => (
              <NavItemComponent
                key={i}
                item={child}
                isCollapsed={isCollapsed}
                pathname={pathname}
                onNavigate={onNavigate}
                depth={depth + 1}
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
        className={cn(
          'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200',
          isActive
            ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm'
            : 'text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
          isCollapsed && 'md:justify-center md:px-2',
        )}
      >
        <Icon
          size={16}
          strokeWidth={1.5}
          className={cn(
            'shrink-0',
            isActive ? 'text-sidebar-accent-foreground' : 'text-sidebar-foreground/50',
          )}
        />
        <span
          className={cn(
            'truncate transition-all duration-300',
            isCollapsed && 'md:w-0 md:opacity-0 md:overflow-hidden',
          )}
        >
          {item.title}
        </span>
        {!isCollapsed && item.badge && (
          <span className="ml-auto rounded-full bg-sidebar-primary px-2 py-0.5 text-[10px] font-bold text-sidebar-primary-foreground">
            {item.badge}
          </span>
        )}
      </Link>
    </li>
  );
}
