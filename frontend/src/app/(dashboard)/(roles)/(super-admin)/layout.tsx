import React from 'react';
import { RoleGuard } from '@/components/auth/RoleGuard';

/**
 * Platform administration. Gated on the *system* role axis only — org
 * membership is irrelevant here, and an org ADMIN must never reach it.
 */
export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleGuard
      require="platform:access"
      forbiddenTitle="Platform administration"
      forbiddenDescription="This area is restricted to platform super admins."
    >
      {children}
    </RoleGuard>
  );
}
