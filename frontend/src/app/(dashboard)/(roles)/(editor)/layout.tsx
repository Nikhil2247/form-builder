import React from 'react';
import { RoleGuard } from '@/components/auth/RoleGuard';

export default function EditorLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleGuard allowedOrgRoles={['ADMIN', 'EDITOR']}>
      {children}
    </RoleGuard>
  );
}
