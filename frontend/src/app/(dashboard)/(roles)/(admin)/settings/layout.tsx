'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Building, CreditCard } from 'lucide-react';

import { cn } from '@/lib/utils';
import { PageHeader, PageShell } from '@/components/shared';
import { usePermissions } from '@/hooks/use-auth';
import type { Permission } from '@/config/roles';

/**
 * Organization settings shell.
 *
 * The previous version hardcoded the "Profile" link as active — every page
 * under /settings highlighted the same tab, so the sidebar never reflected
 * where you were. It also linked to a "Profile" section that duplicated
 * /profile.
 */
const SECTIONS: Array<{
  href: string;
  label: string;
  icon: React.ElementType;
  permission: Permission;
}> = [
  {
    href: '/settings/organization',
    label: 'Organization',
    icon: Building,
    permission: 'org:manage',
  },
  { href: '/settings/billing', label: 'Billing', icon: CreditCard, permission: 'billing:view' },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { can } = usePermissions();

  const sections = SECTIONS.filter((section) => can(section.permission));

  return (
    <PageShell>
      <PageHeader
        title="Settings"
        description="Manage your organization, plan, and usage."
      />

      <div className="flex flex-col gap-6 lg:flex-row lg:gap-10">
        <nav aria-label="Settings sections" className="lg:w-56 lg:shrink-0">
          <ul className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
            {sections.map((section) => {
              const Icon = section.icon;
              const isActive = pathname === section.href || pathname.startsWith(`${section.href}/`);

              return (
                <li key={section.href}>
                  <Link
                    href={section.href}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors',
                      isActive
                        ? 'bg-muted font-medium text-foreground'
                        : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                    )}
                  >
                    <Icon className="size-4" strokeWidth={1.5} />
                    {section.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="min-w-0 flex-1 lg:max-w-3xl">{children}</div>
      </div>
    </PageShell>
  );
}
