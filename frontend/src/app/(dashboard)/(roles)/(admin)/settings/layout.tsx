import React from 'react';
import Link from 'next/link';
import { User, Building, CreditCard, Bell } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Manage your account settings and set email preferences.
        </p>
      </div>
      <div className="flex flex-col space-y-8 lg:flex-row lg:space-x-12 lg:space-y-0">
        <aside className="-mx-4 lg:w-1/5">
          <nav className="flex space-x-2 lg:flex-col lg:space-x-0 lg:space-y-1 px-4 lg:px-0">
            <Link 
              href="/settings" 
              className={cn(buttonVariants({ variant: 'ghost' }), "justify-start text-foreground bg-muted hover:bg-muted")}
            >
              <User className="mr-2 h-4 w-4" />
              Profile
            </Link>
            <Link 
              href="/settings/organization" 
              className={cn(buttonVariants({ variant: 'ghost' }), "justify-start text-muted-foreground hover:bg-muted/50")}
            >
              <Building className="mr-2 h-4 w-4" />
              Organization
            </Link>
            <Link 
              href="/settings/billing" 
              className={cn(buttonVariants({ variant: 'ghost' }), "justify-start text-muted-foreground hover:bg-muted/50")}
            >
              <CreditCard className="mr-2 h-4 w-4" />
              Billing
            </Link>
          </nav>
        </aside>
        <div className="flex-1 lg:max-w-3xl">{children}</div>
      </div>
    </div>
  );
}
