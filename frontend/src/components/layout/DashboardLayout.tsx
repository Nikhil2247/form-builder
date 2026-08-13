'use client';

import React from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { usePathname } from 'next/navigation';
import { useSidebarStore } from '@/store/sidebar-store';
import { useNotificationStream } from '@/hooks/use-notifications';
import { cn } from '@/lib/utils';

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { isCollapsed } = useSidebarStore();

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
          'flex flex-1 flex-col h-screen overflow-hidden min-w-0 transition-all duration-300 ease-in-out',
          // Desktop: push content based on sidebar state
          isCollapsed ? 'md:ml-16' : 'md:ml-64',
        )}
      >
        {/* Top Header — hidden on builder page */}
        {!isBuilderPage && <Header />}

        {/* Page Content */}
        <div
          className={cn(
            'flex-1 overflow-y-auto',
            !isBuilderPage && 'p-4 sm:p-6 lg:p-8',
          )}
        >
          {children}
        </div>
      </main>
    </div>
  );
}
