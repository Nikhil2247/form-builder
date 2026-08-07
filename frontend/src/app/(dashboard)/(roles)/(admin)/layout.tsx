import React from 'react';
import { RoleGuard } from '@/components/auth/RoleGuard';

/**
 * Organization administration: team, settings, billing, org audit log.
 * Gated on `org:manage` rather than the ADMIN string — see config/roles.ts.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleGuard
      require="org:manage"
      forbiddenTitle="Organization settings are admin-only"
      forbiddenDescription="You need the Admin role in this organization to manage members, billing, and settings."
    >
      {children}
    </RoleGuard>
  );
}
