'use client';

import { Check, ChevronsUpDown, Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { StatusBadge } from '@/components/shared/status-badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useOrganizations, useOrgId, useSwitchOrganization } from '@/hooks/use-auth';

interface OrgSwitcherProps {
  /** Collapsed sidebar shows the initial only, with the name in a tooltip. */
  isCollapsed?: boolean;
}

/**
 * Workspace switcher.
 *
 * A user can hold a different role in each organization they belong to, so this
 * shows the role alongside every entry — "which hat am I wearing here" is not
 * inferable from the workspace name alone.
 *
 * Renders as static text when there is only one workspace: a dropdown that can
 * only ever resolve to its current value is noise.
 */
export function OrgSwitcher({ isCollapsed = false }: OrgSwitcherProps) {
  const organizations = useOrganizations();
  const activeOrgId = useOrgId();
  const switchOrg = useSwitchOrganization();

  const active = organizations.find((org) => org.id === activeOrgId) ?? organizations[0];

  // The caller (Sidebar) only mounts this component when there is at least one
  // organization; this is just the defensive fallback for that invariant.
  if (!active) return null;

  const initial = active.name?.[0]?.toUpperCase() ?? '?';

  // Single workspace — show it, but don't imply there is a choice.
  if (organizations.length < 2) {
    return (
      <div
        className="flex items-center gap-2 px-3 py-2"
        title={isCollapsed ? active.name : undefined}
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-sidebar-accent text-[11px] font-semibold text-sidebar-accent-foreground">
          {initial}
        </span>
        <span className={cn('min-w-0 flex-1', isCollapsed && 'md:hidden')}>
          <span className="block truncate text-xs font-medium leading-tight">{active.name}</span>
        </span>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Current workspace: ${active.name}. Switch workspace`}
        disabled={switchOrg.isPending}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left transition-colors',
          'hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'disabled:cursor-progress disabled:opacity-60',
        )}
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-sidebar-accent text-[11px] font-semibold text-sidebar-accent-foreground">
          {switchOrg.isPending ? (
            <Loader2 className="size-3 animate-spin" strokeWidth={2} />
          ) : (
            initial
          )}
        </span>

        <span className={cn('min-w-0 flex-1', isCollapsed && 'md:hidden')}>
          <span className="block truncate text-xs font-medium leading-tight">{active.name}</span>
        </span>

        <ChevronsUpDown
          className={cn('size-3.5 shrink-0 text-muted-foreground', isCollapsed && 'md:hidden')}
          strokeWidth={1.5}
          aria-hidden
        />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Workspaces
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {organizations.map((org) => {
          const isActive = org.id === active.id;
          return (
            <DropdownMenuItem
              key={org.id}
              className="cursor-pointer gap-2"
              // Switching to the workspace already open would throw away the
              // entire query cache to arrive back where we started.
              onClick={() => {
                if (!isActive) switchOrg.mutate(org.id);
              }}
            >
              <Check
                className={cn('size-3.5 shrink-0', !isActive && 'invisible')}
                strokeWidth={2}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-sm">{org.name}</span>
              <StatusBadge status={org.role} />
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
