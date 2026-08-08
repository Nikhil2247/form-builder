'use client';

import React from 'react';
import { Check, Minus, ShieldCheck } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { PageHeader, PageShell } from '@/components/shared';
import {
  ORG_ROLE_LABELS,
  ORG_ROLE_DESCRIPTIONS,
  ORG_ROLE_PERMISSIONS,
  PERMISSIONS,
  type OrgRole,
  type Permission,
} from '@/config/roles';

/** Ascending, so the matrix reads as capabilities accumulating left to right. */
const ROLE_COLUMNS: OrgRole[] = ['VIEWER', 'EDITOR', 'ADMIN'];

/**
 * The permission matrix, rendered from the matrix itself.
 *
 * Deliberately read-only. Roles are fixed enum values compiled into both the
 * client and the API guards, so an editable screen here would promise something
 * the backend cannot honour. Custom per-tenant roles are a schema change, not a
 * UI feature.
 *
 * Everything below is derived from `config/roles.ts` — the same source the
 * sidebar and the route guards read. A hand-written table would be a second
 * copy of the rules, and the copy would be the one that goes stale.
 */

/** Grouped by the prefix each permission already carries. */
const GROUP_LABELS: Record<string, string> = {
  form: 'Forms',
  submission: 'Responses',
  template: 'Templates',
  analytics: 'Analytics',
  webhook: 'Webhooks & integrations',
  member: 'Team',
  org: 'Organization',
  billing: 'Billing',
  audit: 'Audit',
  platform: 'Platform',
};

/** Plain-language reading of each capability. */
const PERMISSION_LABELS: Partial<Record<Permission, string>> = {
  'form:view': 'View forms',
  'form:create': 'Create forms',
  'form:edit': 'Edit forms',
  'form:delete': 'Delete forms',
  'form:publish': 'Publish forms',
  'form:restore': 'Restore from trash',
  'submission:view': 'View responses',
  'submission:export': 'Export responses',
  'submission:delete': 'Delete responses',
  'template:view': 'Browse templates',
  'template:use': 'Create from a template',
  'analytics:view': 'View analytics',
  'webhook:view': 'View webhooks',
  'webhook:manage': 'Create and rotate webhooks',
  'member:view': 'View team members',
  'member:invite': 'Invite members',
  'member:manage': 'Change roles and remove members',
  'org:view': 'View organization settings',
  'org:manage': 'Change organization settings',
  'billing:view': 'View billing',
  'billing:manage': 'Change billing',
  'audit:view': 'View the audit log',
  'platform:access': 'Access the platform admin portal',
};

function groupOf(permission: Permission): string {
  return permission.split(':')[0];
}

export default function PlatformRolesPage() {
  // Platform access is not on the org ladder at all — it comes from
  // systemRole — so it is shown separately rather than as an empty column.
  const orgPermissions = PERMISSIONS.filter((p) => p !== 'platform:access');

  const groups = Array.from(new Set(orgPermissions.map(groupOf)));

  return (
    <PageShell>
      <PageHeader
        title="Roles and permissions"
        description="What each role can do. Read-only — these are fixed roles enforced by the API, not editable settings."
      />

      {/* The two axes are the thing people get wrong, so state it before the
          table rather than leaving it to be inferred from a footnote. */}
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={1.5} />
          <div className="space-y-2 text-sm">
            <p className="font-medium text-foreground">Two independent axes</p>
            <p className="text-muted-foreground">
              <strong className="text-foreground">Platform role</strong> (Super admin) governs this
              portal only. <strong className="text-foreground">Organization role</strong> (Admin,
              Editor, Viewer) governs everything inside a workspace, and is held{' '}
              <em>per membership</em> — the same person can be an Admin in one organization and a
              Viewer in another.
            </p>
            <p className="text-muted-foreground">
              A super admin is <strong className="text-foreground">not</strong> automatically an
              organization admin. To work inside a workspace they need a membership there, which is
              recorded in the audit log like any other.
            </p>
          </div>
        </div>
      </Card>

      <Card className="mt-4 overflow-hidden">
        {/* Wide content scrolls in its own container so the page body never
            scrolls sideways. */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Capability
                </th>
                {ROLE_COLUMNS.map((role) => (
                  <th
                    key={role}
                    className="w-28 px-4 py-2.5 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground"
                  >
                    {ORG_ROLE_LABELS[role]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <React.Fragment key={group}>
                  <tr className="border-b border-border bg-muted/20">
                    <td
                      colSpan={ROLE_COLUMNS.length + 1}
                      className="px-4 py-1.5 text-xs font-semibold text-foreground"
                    >
                      {GROUP_LABELS[group] ?? group}
                    </td>
                  </tr>
                  {orgPermissions
                    .filter((permission) => groupOf(permission) === group)
                    .map((permission) => (
                      <tr key={permission} className="border-b border-border last:border-b-0">
                        <td className="px-4 py-2">
                          <div className="text-foreground">
                            {PERMISSION_LABELS[permission] ?? permission}
                          </div>
                          <code className="text-[0.6875rem] text-muted-foreground">
                            {permission}
                          </code>
                        </td>
                        {ROLE_COLUMNS.map((role) => (
                          <td key={role} className="px-4 py-2 text-center">
                            <PermissionCell role={role} permission={permission} />
                          </td>
                        ))}
                      </tr>
                    ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {ROLE_COLUMNS.map((role) => (
          <Card key={role} className="p-4">
            <h3 className="text-sm font-semibold text-foreground">{ORG_ROLE_LABELS[role]}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{ORG_ROLE_DESCRIPTIONS[role]}</p>
            <p className="mt-2 text-xs tabular-nums text-muted-foreground">
              {ORG_ROLE_PERMISSIONS[role].length} of {orgPermissions.length} capabilities
            </p>
          </Card>
        ))}
      </div>
    </PageShell>
  );
}

function PermissionCell({ role, permission }: { role: OrgRole; permission: Permission }) {
  const granted = ORG_ROLE_PERMISSIONS[role].includes(permission);

  return granted ? (
    <>
      <Check className="mx-auto size-4 text-primary" strokeWidth={2.5} aria-hidden />
      <span className="sr-only">{ORG_ROLE_LABELS[role]} can</span>
    </>
  ) : (
    <>
      <Minus className="mx-auto size-3.5 text-muted-foreground/40" strokeWidth={2} aria-hidden />
      <span className="sr-only">{ORG_ROLE_LABELS[role]} cannot</span>
    </>
  );
}
