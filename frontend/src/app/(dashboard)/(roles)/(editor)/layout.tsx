import React from 'react';
import { RoleGuard } from '@/components/auth/RoleGuard';

/** Authoring surfaces: the builder, integrations, and trash. */
export default function EditorLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoleGuard
      require="form:edit"
      forbiddenTitle="You have read-only access"
      forbiddenDescription="Creating and editing forms requires the Editor or Admin role in this organization."
    >
      {children}
    </RoleGuard>
  );
}
