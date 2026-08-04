'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/hooks/use-auth';

interface RoleGuardProps {
  children: React.ReactNode;
  allowedSystemRoles?: string[];
  allowedOrgRoles?: string[];
}

export function RoleGuard({ children, allowedSystemRoles, allowedOrgRoles }: RoleGuardProps) {
  const { data: session, isLoading } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading) {
      if (!session || !session.user) {
        router.push('/login');
        return;
      }

      // Check System Role (e.g., SUPER_ADMIN)
      if (allowedSystemRoles && allowedSystemRoles.length > 0) {
        if (!allowedSystemRoles.includes(session.user.systemRole)) {
          router.push('/dashboard'); // Fallback for unauthorized
          return;
        }
      }

      // Check Org Role (e.g., ADMIN, EDITOR)
      const orgRole = session.activeOrganization?.role; 
      
      if (allowedOrgRoles && allowedOrgRoles.length > 0) {
        if (!orgRole || !allowedOrgRoles.includes(orgRole)) {
          router.push('/dashboard'); // Fallback
          return;
        }
      }
    }
  }, [session, isLoading, allowedSystemRoles, allowedOrgRoles, router]);

  if (isLoading || !session || !session.user) {
    return <div className="p-8 text-center text-muted-foreground">Checking access...</div>;
  }

  const hasSystemRole = !allowedSystemRoles || allowedSystemRoles.includes(session.user.systemRole);
  const orgRole = session.activeOrganization?.role;
  const hasOrgRole = !allowedOrgRoles || (orgRole && allowedOrgRoles.includes(orgRole));

  if (!hasSystemRole || !hasOrgRole) {
    return null; // Will redirect in useEffect
  }

  return <>{children}</>;
}
