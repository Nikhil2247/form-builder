import React from 'react';
import { RoleGuard } from '@/components/auth/RoleGuard';

/** Anything a member of the organization may read. */
export default function ViewerLayout({ children }: { children: React.ReactNode }) {
  return <RoleGuard require="form:view">{children}</RoleGuard>;
}
