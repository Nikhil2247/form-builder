import React from 'react';
import { RoleGuard } from '@/components/auth/RoleGuard';

export default function ViewerLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleGuard allowedOrgRoles={['ADMIN', 'EDITOR', 'VIEWER']}>
      {children}
    </RoleGuard>
  );
}
