'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/hooks/use-auth';
import { landingRoute } from '@/config/roles';
import { Spinner } from '@/components/ui/spinner';

/**
 * Landing pad for visitors the edge proxy caught already holding a session
 * cookie on /login or /signup (see proxy.ts's AUTH_PAGES check).
 *
 * The edge can only see whether the refresh-token cookie exists — not the
 * role it belongs to — so it cannot pick a destination itself. Sending
 * everyone to a hardcoded route (it used to be /dashboard) is wrong for
 * anyone who isn't an org member with form:view, which is exactly what a
 * platform super admin with no organization membership is not: they landed
 * on /dashboard's RoleGuard and got the generic "you do not have access"
 * screen instead of /platform.
 *
 * This page has real session data (via useUser), so it applies the one
 * shared landingRoute rule and replaces itself immediately.
 */
export default function RedirectingPage() {
  const router = useRouter();
  const { data: session, isLoading } = useUser();

  useEffect(() => {
    if (isLoading) return;
    if (!session?.user) {
      router.replace('/login');
      return;
    }
    router.replace(landingRoute(session.user.systemRole, session.activeOrganization?.role));
  }, [isLoading, session, router]);

  return (
    <div className="flex min-h-[24rem] items-center justify-center" role="status">
      <Spinner className="size-5 text-muted-foreground" />
      <span className="sr-only">Redirecting…</span>
    </div>
  );
}
