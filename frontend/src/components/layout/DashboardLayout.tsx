'use client';

import React from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { usePathname } from 'next/navigation';
import { useSidebarStore } from '@/store/sidebar-store';
import { useNotificationStream } from '@/hooks/use-notifications';
import { cn } from '@/lib/utils';
import { AssistantPanel } from '@/components/assistant/AssistantPanel';
import { FEATURES, useFeature } from '@/hooks/use-features';
import { usePermissions } from '@/hooks/use-auth';

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { isCollapsed } = useSidebarStore();
  const { can } = usePermissions();
  const aiAssistantFeature = useFeature(FEATURES.AI_ASSISTANT);
  const assistantEnabled = aiAssistantFeature && can('analytics:view');

  // The single notification stream for the whole app shell.
  //
  // Here rather than in <Header/>, which is deliberately not rendered on the
  // form builder — the page a user spends the longest on, and the last place
  // you want their notifications to quietly stop arriving. Called before the
  // early return below so the hook order is unconditional; on the invite page
  // there is no session yet, and the hook does nothing without one.
  useNotificationStream();

  const isBuilderPage = pathname === '/forms/builder' || pathname.startsWith('/forms/builder?');
  const isInvitePage = pathname.startsWith('/invite');

  // The shell below is a fixed `h-screen` box with its own scroll region (the
  // `overflow-y-auto` div a few lines down) — that's meant to be the only
  // thing that scrolls. But `<body>` has no height ceiling of its own, so if
  // its rendered content ends up even a pixel taller than the viewport (an
  // unstyled portal, a browser rounding a fractional `100vh`, a scrollbar
  // temporarily changing the available width), the document scrolls too and
  // you get two scrollbars fighting each other. Locking the document's own
  // overflow while this shell is mounted makes that structurally impossible
  // rather than chasing whatever the pixel happened to come from.
  React.useEffect(() => {
    if (isInvitePage) return;
    const { style } = document.documentElement;
    const previousOverflow = style.overflow;
    style.overflow = 'hidden';
    return () => {
      style.overflow = previousOverflow;
    };
  }, [isInvitePage]);

  if (isInvitePage) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        {children}
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {/* Sidebar — fixed position, pushes content on desktop */}
      <Sidebar />

      {/* Main content area — shifts right based on sidebar width on desktop */}
      <main
        className={cn(
          'flex flex-1 flex-col h-screen min-h-0 min-w-0 overflow-hidden transition-all duration-300 ease-in-out',
          // Desktop: push content based on sidebar state
          isCollapsed ? 'md:ml-16' : 'md:ml-64',
        )}
      >
        {/* Top Header — hidden on builder page */}
        {!isBuilderPage && <Header />}

        {/* Page Content — `min-h-0` overrides the flex default of
            `min-height: auto`, which otherwise sizes this to its content
            instead of the space actually left by the header, and shows up as
            a second scrollbar on any page tall enough to hit it. */}
        <div
          className={cn(
            'min-h-0 flex-1 overflow-y-auto',
            !isBuilderPage && 'p-4 sm:p-6 lg:p-8',
          )}
        >
          {children}
        </div>
      </main>

      {/* Floating AI assistant — bottom-right FAB, visible across all pages */}
      {assistantEnabled && <AssistantPanel />}
    </div>
  );
}
