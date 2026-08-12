'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  Building2,
  Check,
  KeyRound,
  Loader2,
  LogOut,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  UserX,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import {
  PageHeader,
  PageShell,
  DataTable,
  StatusBadge,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  ButtonLink,
  CopyField,
  FormattedDate,
  RelativeTime,
  type DataTableColumn,
} from '@/components/shared';
import {
  useAdminUser,
  useResetUserMfa,
  useRevokeUserSessions,
  useSetSystemRole,
  useSetUserOrgRole,
  useSetUserSuspended,
  type AdminUserDetail,
  type AdminUserMembership,
  type OrgRole,
  type SystemRole,
} from '@/hooks/use-admin';

/**
 * One account, everywhere it has reach.
 *
 * The two role axes are shown as two separate controls on purpose. A super
 * admin is not implicitly an admin of any organization, and an org admin has
 * no platform access — merging them into one "role" dropdown is the mistake
 * that quietly grants tenant data access to a support engineer.
 *
 * The API refuses several of these actions by design (demoting the last super
 * admin, suspending yourself, removing an org's only admin) and returns a
 * sentence explaining why. Those sentences are shown verbatim rather than
 * being flattened into "Something went wrong".
 */

/**
 * Every mutation here shares one failure path: show what the API said. That is
 * now the global MutationCache handler in query-provider, which prefers the
 * API's sentence and falls back to each mutation's `meta.errorFallback`. The
 * `catch` blocks below only stop `mutateAsync` rejecting unhandled and roll
 * back optimistic local state; they deliberately do not toast, or every
 * failure would produce two.
 */

export default function PlatformUserDetailPage() {
  const params = useParams<{ userId: string }>();
  const userId = params.userId;

  const { data: user, isLoading, error, refetch } = useAdminUser(userId);

  const setSuspended = useSetUserSuspended();
  const revokeSessions = useRevokeUserSessions();
  const resetMfa = useResetUserMfa();

  const [confirm, setConfirm] = useState<'suspend' | 'reinstate' | 'sessions' | 'mfa' | null>(null);

  if (error) {
    return (
      <PageShell>
        <ErrorState
          title="Could not load this user"
          error={error}
          onRetry={() => refetch()}
        />
      </PageShell>
    );
  }

  if (!isLoading && !user) {
    return (
      <PageShell>
        <EmptyState
          icon={Users}
          title="User not found"
          description="The account may have been removed, or the identifier in the URL is not a user."
          action={
            <ButtonLink size="sm" href="/platform/users">
              Back to users
            </ButtonLink>
          }
        />
      </PageShell>
    );
  }

  const fullName = user ? [user.firstName, user.lastName].filter(Boolean).join(' ') : '';
  const displayName = fullName || user?.email || '';
  const suspended = Boolean(user?.deletedAt);

  async function handleSuspension(next: boolean) {
    if (!user) return;
    try {
      await setSuspended.mutateAsync({ userId: user.id, suspended: next });
      toast.success(next ? `${user.email} suspended` : `${user.email} reinstated`);
      setConfirm(null);
    } catch {
      // Reported globally; the confirm dialog stays open.
    }
  }

  async function handleRevokeSessions() {
    if (!user) return;
    try {
      const result = await revokeSessions.mutateAsync(user.id);
      toast.success(result.message);
      setConfirm(null);
    } catch {
      // Reported globally.
    }
  }

  async function handleResetMfa() {
    if (!user) return;
    try {
      const result = await resetMfa.mutateAsync(user.id);
      toast.success(result.message);
      setConfirm(null);
    } catch {
      // Reported globally.
    }
  }

  return (
    <PageShell>
      <PageHeader
        isLoading={isLoading}
        back="/platform/users"
        breadcrumbs={[{ label: 'Users', href: '/platform/users' }, { label: displayName }]}
        title={displayName}
        description={fullName ? user?.email : undefined}
        badge={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={user?.systemRole} />
            {suspended && <StatusBadge status="SUSPENDED" dot />}
          </span>
        }
        actions={
          user ? (
            suspended ? (
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => setConfirm('reinstate')}
              >
                <UserCheck className="size-4" /> Reinstate account
              </Button>
            ) : (
              <Button
                variant="destructive"
                size="sm"
                className="gap-2"
                onClick={() => setConfirm('suspend')}
              >
                <UserX className="size-4" /> Suspend account
              </Button>
            )
          ) : undefined
        }
      />

      {suspended && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <ShieldAlert className="size-4 shrink-0" />
          <span>
            This account is suspended and cannot sign in. Its forms, submissions, and audit trail
            are untouched — suspension is a soft delete.
          </span>
        </div>
      )}

      {isLoading || !user ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-64 animate-pulse rounded-xl border border-border bg-card" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <AccountCard user={user} />
            <PlatformRoleCard key={`${user.id}:${user.systemRole}`} user={user} />
          </div>

          <MembershipsSection user={user} />

          <SecurityCard
            user={user}
            onRevokeSessions={() => setConfirm('sessions')}
            onResetMfa={() => setConfirm('mfa')}
          />
        </>
      )}

      <ConfirmDialog
        open={confirm === 'suspend'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Suspend this account"
        description={
          <>
            {user?.email} will be signed out of every device and blocked from signing in. Nothing
            they created is deleted, and the account can be reinstated at any time.
          </>
        }
        confirmLabel="Suspend account"
        confirmText={user?.email}
        isPending={setSuspended.isPending}
        onConfirm={() => handleSuspension(true)}
      />

      <ConfirmDialog
        open={confirm === 'reinstate'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Reinstate this account"
        description={<>{user?.email} will be able to sign in again with their existing password.</>}
        confirmLabel="Reinstate"
        variant="default"
        isPending={setSuspended.isPending}
        onConfirm={() => handleSuspension(false)}
      />

      <ConfirmDialog
        open={confirm === 'sessions'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Revoke every session"
        description={
          <>
            All {user?.security.activeSessions ?? 0} refresh token(s) for {user?.email} are
            revoked immediately. Access tokens are stateless, so an already-issued one keeps
            working until it expires — up to 15 minutes.
          </>
        }
        confirmLabel="Revoke sessions"
        isPending={revokeSessions.isPending}
        onConfirm={handleRevokeSessions}
      />

      <ConfirmDialog
        open={confirm === 'mfa'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Reset two-factor authentication"
        description={
          <>
            Removes the authenticator secret and every recovery code for {user?.email}. Their
            account drops to password-only until they enrol again. Use this only after verifying
            the request through another channel.
          </>
        }
        confirmLabel="Reset MFA"
        isPending={resetMfa.isPending}
        onConfirm={handleResetMfa}
      />
    </PageShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-2 last:border-0">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right text-sm text-foreground">{value}</dd>
    </div>
  );
}

function AccountCard({ user }: { user: AdminUserDetail }) {
  return (
    <Card className="gap-4 p-5">
      <h2 className="text-sm font-semibold">Account</h2>
      <dl>
        <Fact label="Email" value={user.email} />
        <Fact label="First name" value={user.firstName || '—'} />
        <Fact label="Last name" value={user.lastName || '—'} />
        <Fact label="Registered" value={<FormattedDate value={user.createdAt} />} />
        <Fact label="Last updated" value={<RelativeTime value={user.updatedAt} />} />
        <Fact label="Organizations" value={user.memberships.length.toLocaleString()} />
        <Fact label="Forms created" value={user.activity.formsCreated.toLocaleString()} />
      </dl>
      <CopyField label="User ID" value={user.id} />
    </Card>
  );
}

const SYSTEM_ROLES: Array<{ value: SystemRole; label: string; blurb: string }> = [
  {
    value: 'USER',
    label: 'User',
    blurb: 'No platform access. Can only do what their organization roles allow.',
  },
  {
    value: 'SUPER_ADMIN',
    label: 'Super admin',
    blurb:
      'Full access to every organization’s administration, all users, and the audit trail across the deployment.',
  },
];

/**
 * Seeded from props at mount and remounted by the parent (`key` includes the
 * server's current role), so a successful save or a background refetch resets
 * the control without an effect writing state.
 */
function PlatformRoleCard({ user }: { user: AdminUserDetail }) {
  const [role, setRole] = useState<SystemRole>(user.systemRole);
  const [confirming, setConfirming] = useState(false);
  const setSystemRole = useSetSystemRole();

  const dirty = role !== user.systemRole;
  const promoting = role === 'SUPER_ADMIN';
  const selected = SYSTEM_ROLES.find((option) => option.value === role);

  async function save() {
    try {
      await setSystemRole.mutateAsync({ userId: user.id, systemRole: role });
      toast.success(
        promoting
          ? `${user.email} is now a platform super admin`
          : `${user.email} no longer has platform access`,
      );
      setConfirming(false);
    } catch {
      // Reported globally; the confirm state stays so the operator can retry.
    }
  }

  return (
    <Card className="gap-4 p-5">
      <div>
        <h2 className="text-sm font-semibold">Platform role</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Governs the /platform section only. It grants no membership of any organization.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="system-role">Role</Label>
        <NativeSelect
          className="w-full"
          id="system-role"
          value={role}
          onChange={(event) => setRole(event.target.value as SystemRole)}
        >
          {SYSTEM_ROLES.map((option) => (
            <NativeSelectOption key={option.value} value={option.value}>
              {option.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        {selected && <p className="text-xs text-muted-foreground">{selected.blurb}</p>}
      </div>

      <div className="mt-auto flex items-center gap-2">
        <Button size="sm" disabled={!dirty || setSystemRole.isPending} onClick={() => setConfirming(true)}>
          Save role
        </Button>
        {dirty && (
          <Button variant="ghost" size="sm" onClick={() => setRole(user.systemRole)}>
            Cancel
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={promoting ? 'Grant platform admin access' : 'Remove platform admin access'}
        description={
          promoting ? (
            <>
              {user.email} will be able to read and administer every organization on this
              deployment, including data they were never invited to.
            </>
          ) : (
            <>
              {user.email} loses access to the platform section. Their organization memberships are
              unaffected.
            </>
          )
        }
        confirmLabel={promoting ? 'Grant access' : 'Remove access'}
        variant={promoting ? 'default' : 'destructive'}
        isPending={setSystemRole.isPending}
        onConfirm={save}
      />
    </Card>
  );
}

const ORG_ROLES: OrgRole[] = ['ADMIN', 'EDITOR', 'VIEWER'];

function MembershipsSection({ user }: { user: AdminUserDetail }) {
  const columns: DataTableColumn<AdminUserMembership>[] = [
    {
      id: 'organization',
      header: 'Organization',
      isRowHeader: true,
      className: 'max-w-0',
      cell: (membership) => (
        <div className="flex items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Building2 className="size-4" strokeWidth={1.5} />
          </span>
          <div className="min-w-0">
            <Link
              href={`/platform/organizations/${membership.organization.id}`}
              className="truncate font-medium text-foreground hover:underline"
            >
              {membership.organization.name}
            </Link>
            <div className="truncate font-mono text-xs text-muted-foreground">
              {membership.organization.slug}
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'orgStatus',
      header: 'Org status',
      width: 'w-32',
      hideBelow: 'md',
      cell: (membership) => (
        <StatusBadge
          status={
            membership.organization.suspendedAt
              ? 'SUSPENDED'
              : membership.organization.isActive === false
                ? 'INACTIVE'
                : 'ACTIVE'
          }
          dot
        />
      ),
    },
    {
      id: 'joinedAt',
      header: 'Joined',
      width: 'w-40',
      hideBelow: 'lg',
      cell: (membership) => (
        <span className="text-muted-foreground">
          <RelativeTime value={membership.joinedAt} />
        </span>
      ),
    },
    {
      id: 'role',
      header: 'Role',
      width: 'w-44',
      className: 'text-right',
      headerClassName: 'text-right',
      cell: (membership) => (
        <MembershipRoleSelect
          // Remount when the server's value changes so the control is always
          // seeded from the authoritative role, never from an effect.
          key={`${membership.id}:${membership.role}`}
          user={user}
          membership={membership}
        />
      ),
    },
  ];

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Organization memberships</h2>
        <span className="text-xs text-muted-foreground">
          Changing a role here is recorded in that organization’s audit log.
        </span>
      </div>

      <DataTable
        caption="Organizations this user belongs to"
        columns={columns}
        data={user.memberships}
        getRowId={(membership) => membership.id}
        empty={
          <EmptyState
            variant="inline"
            icon={Building2}
            title="No organization memberships"
            description="This account belongs to no organization, so it can only sign in — there is nothing for it to open."
          />
        }
      />
    </section>
  );
}

/**
 * Applies on change rather than behind a Save button — but it owns the request,
 * so a rejection (the org's only admin, say) puts the control back to the role
 * the user actually has instead of leaving the table lying about it.
 */
function MembershipRoleSelect({
  user,
  membership,
}: {
  user: AdminUserDetail;
  membership: AdminUserMembership;
}) {
  const [role, setRole] = useState<OrgRole>(membership.role);
  const setOrgRole = useSetUserOrgRole();

  async function change(next: OrgRole) {
    setRole(next);
    try {
      await setOrgRole.mutateAsync({
        userId: user.id,
        orgId: membership.organization.id,
        role: next,
      });
      toast.success(
        `${user.email} is now ${next === 'ADMIN' ? 'an' : 'a'} ${next.toLowerCase()} of ${membership.organization.name}`,
      );
    } catch {
      // Roll the select back to what the server still believes. The toast
      // itself comes from the global handler.
      setRole(membership.role);
    }
  }

  return (
    <div className="flex items-center justify-end gap-2">
      {setOrgRole.isPending && (
        <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
      )}
      <NativeSelect
        size="sm"
        aria-label={`Role in ${membership.organization.name}`}
        id={`role-${user.id}-${membership.id}`}
        value={role}
        disabled={setOrgRole.isPending}
        onChange={(event) => change(event.target.value as OrgRole)}
      >
        {ORG_ROLES.map((role) => (
          <NativeSelectOption key={role} value={role}>
            {role.charAt(0) + role.slice(1).toLowerCase()}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
}

function SecurityCard({
  user,
  onRevokeSessions,
  onResetMfa,
}: {
  user: AdminUserDetail;
  onRevokeSessions: () => void;
  onResetMfa: () => void;
}) {
  const { security } = user;

  return (
    <Card className="gap-4 p-5">
      <div>
        <h2 className="text-sm font-semibold">Security</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Sessions are refresh tokens. Revoking them ends the ability to stay signed in; it does
          not invalidate an access token already in flight.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SecurityTile
          label="Two-factor"
          value={
            security.mfaEnabled ? (
              <span className="flex items-center gap-1.5 text-success">
                <ShieldCheck className="size-4" /> Enabled
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <ShieldAlert className="size-4" /> Not enabled
              </span>
            )
          }
        />
        <SecurityTile
          label="Recovery codes left"
          value={
            <span
              className={
                security.mfaEnabled && security.recoveryCodesRemaining === 0
                  ? 'text-warning'
                  : undefined
              }
            >
              {security.mfaEnabled ? security.recoveryCodesRemaining.toLocaleString() : '—'}
            </span>
          }
          hint={
            security.mfaEnabled && security.recoveryCodesRemaining === 0
              ? 'A lost device means a support reset'
              : undefined
          }
        />
        <SecurityTile label="Active sessions" value={security.activeSessions.toLocaleString()} />
        <SecurityTile
          label="Email"
          value={
            security.emailVerified ? (
              <span className="flex items-center gap-1.5 text-success">
                <Check className="size-4" /> Verified
              </span>
            ) : (
              <span className="text-muted-foreground">Unverified</span>
            )
          }
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={onRevokeSessions}
          disabled={security.activeSessions === 0}
        >
          <LogOut className="size-3.5" />
          Revoke all sessions
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={onResetMfa}
          disabled={!security.mfaEnabled}
        >
          <KeyRound className="size-3.5" />
          Reset MFA
        </Button>
        {security.activeSessions === 0 && (
          <span className="text-xs text-muted-foreground">No sessions to revoke.</span>
        )}
        {!security.mfaEnabled && (
          <span className="text-xs text-muted-foreground">
            MFA is off, so there is nothing to reset.
          </span>
        )}
      </div>
    </Card>
  );
}

function SecurityTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1.5 text-sm font-semibold text-foreground">{value}</div>
      {hint && <p className="mt-1 text-xs text-warning">{hint}</p>}
    </div>
  );
}
