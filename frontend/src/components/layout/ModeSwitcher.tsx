'use client';

import { useRouter } from 'next/navigation';
import { FileBox, LayoutGrid } from 'lucide-react';

import { cn } from '@/lib/utils';
import { FEATURES, useFeature } from '@/hooks/use-features';
import { useNavMode } from '@/hooks/use-filtered-navigation';
import { useNavModeStore } from '@/store/nav-mode-store';
import type { NavMode } from '@/config/navigation';

interface ModeSwitcherProps {
  isCollapsed?: boolean;
  onNavigate?: () => void;
}

const MODES: Array<{ mode: NavMode; label: string; icon: typeof FileBox; home: string }> = [
  { mode: 'forms', label: 'Forms', icon: FileBox, home: '/dashboard' },
  { mode: 'apps', label: 'Data', icon: LayoutGrid, home: '/apps' },
];

/**
 * Switch between the form builder and the data-entry app surface.
 *
 * Renders nothing at all unless the FORM_APPS feature is on — an installation
 * that does not use Data Apps should see no trace of it, not a disabled control
 * hinting at something unavailable.
 *
 * Switching also navigates to that mode's home. Leaving the user on the current
 * URL while swapping the sidebar out from under them puts the chrome and the
 * page in disagreement, which reads as a bug.
 */
export function ModeSwitcher({ isCollapsed = false, onNavigate }: ModeSwitcherProps) {
  const router = useRouter();
  const appsEnabled = useFeature(FEATURES.FORM_APPS);
  const activeMode = useNavMode();
  const setMode = useNavModeStore((s) => s.setMode);

  if (!appsEnabled) return null;

  const select = (mode: NavMode, home: string) => {
    if (mode === activeMode) return;
    setMode(mode);
    router.push(home);
    onNavigate?.();
  };

  return (
    <div className="px-2 pb-2 pt-1">
      <div
        role="tablist"
        aria-label="Workspace mode"
        className={cn(
          'flex gap-1 rounded-lg bg-sidebar-accent/40 p-1',
          isCollapsed && 'md:flex-col',
        )}
      >
        {MODES.map(({ mode, label, icon: Icon, home }) => {
          const isActive = mode === activeMode;
          return (
            <button
              key={mode}
              role="tab"
              aria-selected={isActive}
              onClick={() => select(mode, home)}
              title={isCollapsed ? label : undefined}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5',
                'text-xs font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isActive
                  ? 'bg-sidebar text-sidebar-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-sidebar-foreground',
              )}
            >
              <Icon className="size-3.5 shrink-0" strokeWidth={1.5} aria-hidden />
              <span className={cn(isCollapsed && 'md:hidden')}>{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
