'use client';

import React, { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useUser, usePermissions } from '@/hooks/use-auth';
import { ButtonLink } from '@/components/shared/button-link';
import { Spinner } from '@/components/ui/spinner';
import { ForbiddenState } from '@/components/shared/empty-state';
import { landingRoute, type Permission } from '@/config/roles';

/**
 * Client-side route gate.
 *
 * Two changes from the previous version, both of which were user-visible bugs:
 *
 *  1. Insufficient permission used to `router.push('/dashboard')`. For a user
 *     with no org membership that is itself a guarded route, so the guard
 *     bounced them to a page that bounced them back — an infinite redirect that
 *     pinned the CPU. Now it renders an explanation and stays put.
 *
 *  2. It gated on role strings, conflating the platform and organization axes,
 *     so a SUPER_ADMIN with no membership satisfied `allowedOrgRoles={['ADMIN']}`
 *     and was shown org screens whose API calls all 403'd. It now gates on
 *     named permissions (see config/roles.ts).
 *
 * This is UX, not security. It decides what to render; the API re-checks every
 * request. Never move an authorization decision here.
 */

export interface RoleGuardProps {
  children: React.ReactNode;
  /** Every listed permission is required. */
  require?: Permission | Permission[];
  /** At least one listed permission is required. */
  requireAny?: Permission[];
  /** Rendered instead of the forbidden state. */
  fallback?: React.ReactNode;
  /** Custom copy on the forbidden screen. */
  forbiddenTitle?: string;
  forbiddenDescription?: string;
}

export function RoleGuard({
  children,
  require,
  requireAny,
  fallback,
  forbiddenTitle,
  forbiddenDescription,
}: RoleGuardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session, isLoading } = useUser();
  const { can, canAny, isLoading: permsLoading } = usePermissions();

  const home = landingRoute(session?.user?.systemRole, session?.activeOrganization?.role);

  const settled = !isLoading && !permsLoading;
  const authenticated = !!session?.user;

  useEffect(() => {
    if (settled && !authenticated) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [settled, authenticated, router, pathname]);

  if (!settled) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center" role="status">
        <Spinner className="size-5 text-muted-foreground" />
        <span className="sr-only">Checking access…</span>
      </div>
    );
  }

  // The redirect above is in flight; render nothing rather than a flash of the
  // protected page.
  if (!authenticated) return null;

  const required = require ? (Array.isArray(require) ? require : [require]) : [];
  const allowed =
    (required.length === 0 || required.every((p) => can(p))) &&
    (!requireAny || requireAny.length === 0 || canAny(...requireAny));

  if (!allowed) {
    if (fallback !== undefined) return <>{fallback}</>;
    return (
      <ForbiddenState
        title={forbiddenTitle ?? 'You do not have access to this page'}
        description={
          forbiddenDescription ??
          'Your role in this organization does not include this area. Ask an admin if you need access.'
        }
        action={
          // Points at wherever this user can actually go. Hardcoding /dashboard
          // sent a super admin (no org membership, so no `form:view`) from one
          // forbidden page straight to another.
          <ButtonLink variant="outline" size="sm" href={home}>
            {home === '/platform' ? 'Go to platform admin' : 'Go to your dashboard'}
          </ButtonLink>
        }
      />
    );
  }

  return <>{children}</>;
}

/**
 * Inline permission check for parts of a page — a "Create form" button, a
 * delete menu item. Renders nothing (or `fallback`) when not permitted.
 *
 * Pages previously wrote `orgRole === 'ADMIN' || orgRole === 'EDITOR'` inline;
 * that expression appeared in six files and had drifted in two of them.
 */
export function Can({
  permission,
  any,
  children,
  fallback = null,
}: {
  permission?: Permission;
  any?: Permission[];
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { can, canAny } = usePermissions();

  const ok =
    (permission ? can(permission) : true) && (any && any.length ? canAny(...any) : true);

  return <>{ok ? children : fallback}</>;
}
