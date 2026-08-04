'use client';

import React from 'react';
import { Search, Bell, Menu, LogOut, User, Building2, CreditCard } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ThemeToggle } from '@/components/ThemeToggle';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSidebarStore } from '@/store/sidebar-store';
import { useUser, useLogout } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';

// Human-readable route title map
const ROUTE_TITLES: Record<string, string> = {
  dashboard: 'Dashboard',
  forms: 'My Forms',
  builder: 'Form Builder',
  submissions: 'Submissions',
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
  'org-audit': 'Audit Logs',
  'global-audit': 'Global Audit Logs',
  platform: 'Platform Overview',
  organizations: 'Organizations',
  users: 'Users',
  invite: 'Invite',
};

export function Header() {
  const pathname = usePathname();
  const { open } = useSidebarStore();
  const { data: session } = useUser();
  const logout = useLogout();

  const user = session?.user;
  const displayName = user ? `${user.firstName} ${user.lastName}`.trim() || user.email : 'User';
  const initials = user
    ? `${user.firstName?.charAt(0) ?? ''}${user.lastName?.charAt(0) ?? ''}`.toUpperCase() || 'U'
    : 'U';

  // Build breadcrumbs from pathname
  const pathSegments = pathname.split('/').filter(Boolean);
  const breadcrumbs = pathSegments.map((segment, index) => {
    const href = '/' + pathSegments.slice(0, index + 1).join('/');
    const title = ROUTE_TITLES[segment] ?? segment.charAt(0).toUpperCase() + segment.slice(1);
    return { title, href };
  });

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-4 sm:px-6">
      {/* Mobile hamburger */}
      <button
        onClick={open}
        className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground md:hidden"
        aria-label="Open sidebar"
      >
        <Menu size={20} strokeWidth={1.5} />
      </button>

      {/* Breadcrumbs */}
      <nav className="hidden flex-1 items-center gap-1 text-sm md:flex">
        <Link href="/dashboard" className="text-muted-foreground hover:text-foreground transition-colors">
          Home
        </Link>
        {breadcrumbs.map((crumb, index) => (
          <React.Fragment key={crumb.href}>
            <span className="text-muted-foreground/40">/</span>
            <Link
              href={crumb.href}
              className={cn(
                'transition-colors',
                index === breadcrumbs.length - 1
                  ? 'font-semibold text-foreground pointer-events-none'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {crumb.title}
            </Link>
          </React.Fragment>
        ))}
      </nav>

      {/* Right-side actions */}
      <div className="flex items-center gap-2 ml-auto">
        {/* Search — hidden on small screens */}
        <div className="relative hidden sm:block">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.5} />
          <input
            type="search"
            placeholder="Search..."
            className="h-9 w-48 rounded-lg border border-input bg-muted/40 pl-8 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring focus:bg-background transition-all lg:w-64"
          />
        </div>

        <ThemeToggle />

        {/* Notifications */}
        <DropdownMenu>
          <DropdownMenuTrigger className="relative rounded-full p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors outline-none">
            <Bell size={18} strokeWidth={1.5} />
            <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-primary ring-2 ring-background" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel className="flex items-center justify-between">
              Notifications
              <Link href="/notifications" className="text-xs text-primary hover:underline">
                View all
              </Link>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <div className="flex flex-col gap-1 p-2">
              <div className="flex flex-col gap-1 rounded-lg p-2.5 hover:bg-muted/50 cursor-pointer">
                <span className="text-sm font-medium">New form submission</span>
                <span className="text-xs text-muted-foreground">
                  Feedback Survey received a new response.
                </span>
                <span className="text-[10px] text-muted-foreground mt-0.5">2 mins ago</span>
              </div>
              <div className="flex flex-col gap-1 rounded-lg p-2.5 hover:bg-muted/50 cursor-pointer">
                <span className="text-sm font-medium">Weekly report ready</span>
                <span className="text-xs text-muted-foreground">
                  Your performance analytics are available.
                </span>
                <span className="text-[10px] text-muted-foreground mt-0.5">1 hr ago</span>
              </div>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* User avatar dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/60 text-primary-foreground text-xs font-bold ring-2 ring-transparent hover:ring-primary/30 transition-all outline-none">
            {initials}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col">
                <span className="font-semibold">{displayName}</span>
                <span className="text-xs text-muted-foreground font-normal">
                  {user?.email}
                </span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <Link href="/profile" className="flex items-center gap-2 w-full">
                <User size={14} strokeWidth={1.5} />
                Profile
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Link href="/settings/organization" className="flex items-center gap-2 w-full">
                <Building2 size={14} strokeWidth={1.5} />
                Organization
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Link href="/settings/billing" className="flex items-center gap-2 w-full">
                <CreditCard size={14} strokeWidth={1.5} />
                Billing
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-red-500 hover:text-red-600 focus:text-red-600 focus:bg-red-50 cursor-pointer"
              onClick={() => logout.mutate()}
            >
              <LogOut size={14} strokeWidth={1.5} className="mr-2" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
