'use client';

import React, { useState } from 'react';
import {
  Check,
  MoreHorizontal,
  Plus,
  ShieldCheck,
  Trash2,
  User,
  UserCheck,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  PageHeader,
  PageShell,
  DataTable,
  StatusBadge,
  EmptyState,
  Toolbar,
  SearchInput,
  ConfirmDialog,
  Modal,
  ModalActions,
  RelativeTime,
  type DataTableColumn,
} from '@/components/shared';
import { usePagination } from '@/hooks/use-pagination';
import {
  useAdminUsers,
  useCreateUser,
  useSetUserSuspended,
  type AdminUser,
  type SystemRole,
} from '@/hooks/use-admin';

export default function PlatformUsersPage() {
  const pager = usePagination();
  const { data, isLoading, isFetching, error, refetch } = useAdminUsers({
    page: pager.page,
    limit: pager.pageSize,
    search: pager.search,
  });

  const setSuspended = useSetUserSuspended();
  const createUser = useCreateUser();
  const [confirmTarget, setConfirmTarget] = useState<{ user: AdminUser; next: boolean } | null>(
    null,
  );
  const [creating, setCreating] = useState(false);

  const users = data?.items ?? [];
  const total = data?.pagination.total ?? 0;

  const columns: DataTableColumn<AdminUser>[] = [
    {
      id: 'user',
      header: 'User',
      isRowHeader: true,
      className: 'max-w-0',
      cell: (user) => {
        const name = [user.firstName, user.lastName].filter(Boolean).join(' ');
        const initials =
          `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`.toUpperCase() ||
          user.email[0]?.toUpperCase() ||
          '?';

        return (
          <div className="flex items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
              {initials}
            </span>
            <div className="min-w-0">
              <div className="truncate font-medium text-foreground">{name || user.email}</div>
              <div className="truncate text-xs text-muted-foreground">{user.email}</div>
            </div>
          </div>
        );
      },
    },
    {
      id: 'systemRole',
      header: 'System role',
      width: 'w-36',
      cell: (user) => <StatusBadge status={user.systemRole} />,
    },
    {
      id: 'status',
      header: 'Status',
      width: 'w-28',
      cell: (user) =>
        user.deletedAt ? (
          <StatusBadge status="SUSPENDED" dot />
        ) : (
          <StatusBadge status="ACTIVE" dot />
        ),
    },
    {
      id: 'organization',
      header: 'Organization',
      width: 'w-52',
      hideBelow: 'md',
      cell: (user) => {
        // The API returns either a single `organization` or a `memberships`
        // array depending on the endpoint version; handle both rather than
        // rendering an empty cell for one of them.
        const membership = user.memberships?.[0];
        const org = user.organization ?? membership?.organization;
        const role = user.organization?.role ?? membership?.role;

        if (!org) return <span className="text-muted-foreground">No organization</span>;
        return (
          <div className="min-w-0">
            <div className="truncate">{org.name}</div>
            {role && <div className="truncate text-xs text-muted-foreground">{role}</div>}
          </div>
        );
      },
    },
    {
      id: 'security',
      header: 'Security',
      width: 'w-32',
      hideBelow: 'lg',
      cell: (user) => (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {user.emailVerified && (
            <span className="flex items-center gap-1" title="Email verified">
              <Check className="size-3 text-success" /> Verified
            </span>
          )}
          {user.mfaEnabled && (
            <span className="flex items-center gap-1" title="Two-factor authentication enabled">
              <ShieldCheck className="size-3 text-success" /> 2FA
            </span>
          )}
          {!user.emailVerified && !user.mfaEnabled && <span>—</span>}
        </div>
      ),
    },
    {
      id: 'createdAt',
      header: 'Joined',
      width: 'w-36',
      hideBelow: 'xl',
      cell: (user) => (
        <span className="text-muted-foreground">
          <RelativeTime value={user.createdAt} />
        </span>
      ),
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      width: 'w-12',
      className: 'text-right',
      headerClassName: 'text-right',
      cell: (user) => (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Actions for ${user.email}`}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {user.deletedAt ? (
              <DropdownMenuItem
                onClick={() => setConfirmTarget({ user, next: false })}
                className="cursor-pointer"
              >
                <UserCheck className="mr-2 size-3.5" /> Reinstate
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                onClick={() => setConfirmTarget({ user, next: true })}
                className="cursor-pointer text-destructive focus:bg-destructive/10 focus:text-destructive"
              >
                <Trash2 className="mr-2 size-3.5" /> Delete
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <PageShell>
      <PageHeader
        title="Users"
        // description="Every registered account on this deployment."
        actions={
          <Button size="sm" className="gap-2" onClick={() => setCreating(true)}>
            <Plus className="size-4" /> New user
          </Button>
        }
      />

      <Toolbar>
        <SearchInput
          value={pager.search}
          onChange={pager.setSearch}
          placeholder="Search by name or email…"
          aria-label="Search users"
        />
      </Toolbar>

      <DataTable
        caption="Platform users"
        columns={columns}
        data={users}
        getRowId={(user) => user.id}
        rowHref={(user) => `/platform/users/${user.id}`}
        isLoading={isLoading || isFetching}
        error={error}
        onRetry={() => refetch()}
        pagination={pager.paginationProps(total, 'users')}
        empty={
          <EmptyState
            variant="inline"
            icon={pager.search ? User : Users}
            title={pager.search ? 'No users match' : 'No users yet'}
            description={
              pager.search ? 'Try a different name or email.' : 'Accounts appear here as people sign up.'
            }
          />
        }
      />

      <ConfirmDialog
        open={confirmTarget !== null}
        onOpenChange={(open) => !open && setConfirmTarget(null)}
        title={confirmTarget?.next ? 'Delete this account' : 'Reinstate this account'}
        description={
          confirmTarget?.next ? (
            <>
              {confirmTarget.user.email} will be signed out of every device and blocked from
              signing in. Their forms, submissions, and audit trail are retained, not erased — the
              account can be reinstated at any time.
            </>
          ) : (
            <>{confirmTarget?.user.email} will be able to sign in again with their existing password.</>
          )
        }
        confirmLabel={confirmTarget?.next ? 'Delete account' : 'Reinstate'}
        confirmText={confirmTarget?.next ? confirmTarget.user.email : undefined}
        variant={confirmTarget?.next ? 'destructive' : 'default'}
        isPending={setSuspended.isPending}
        onConfirm={async () => {
          if (!confirmTarget) return;
          try {
            await setSuspended.mutateAsync({
              userId: confirmTarget.user.id,
              suspended: confirmTarget.next,
            });
            toast.success(
              confirmTarget.next
                ? `${confirmTarget.user.email} deleted`
                : `${confirmTarget.user.email} reinstated`,
            );
            setConfirmTarget(null);
          } catch {
            // Reported globally; the dialog stays open so the operator can retry.
          }
        }}
      />

      {creating && (
        <CreateUserModal
          onClose={() => setCreating(false)}
          isPending={createUser.isPending}
          onConfirm={async (data) => {
            try {
              await createUser.mutateAsync(data);
              toast.success(`${data.email} created — a set-password link has been emailed to them`);
              setCreating(false);
            } catch {
              // Reported globally; the modal stays open with the fields filled in.
            }
          }}
        />
      )}
    </PageShell>
  );
}

function CreateUserModal({
  onClose,
  onConfirm,
  isPending,
}: {
  onClose: () => void;
  onConfirm: (data: {
    email: string;
    firstName: string;
    lastName: string;
    systemRole?: SystemRole;
  }) => void;
  isPending: boolean;
}) {
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [systemRole, setSystemRole] = useState<SystemRole>('USER');

  const valid = /\S+@\S+\.\S+/.test(email) && firstName.trim().length > 0 && lastName.trim().length > 0;

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title="New user"
      description="Creates a standalone account with no organization membership. They receive an email to set their own password."
      footer={
        <ModalActions
          onCancel={onClose}
          confirmLabel="Create user"
          onConfirm={() =>
            onConfirm({
              email: email.trim(),
              firstName: firstName.trim(),
              lastName: lastName.trim(),
              systemRole,
            })
          }
          isPending={isPending}
          disabled={!valid}
        />
      }
    >
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="create-user-email">Email</Label>
          <Input
            id="create-user-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="person@example.org"
            autoFocus
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="create-user-first">First name</Label>
            <Input
              id="create-user-first"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="create-user-last">Last name</Label>
            <Input
              id="create-user-last"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="create-user-role">Platform role</Label>
          <NativeSelect
            className="w-full"
            id="create-user-role"
            value={systemRole}
            onChange={(e) => setSystemRole(e.target.value as SystemRole)}
          >
            <NativeSelectOption value="USER">User</NativeSelectOption>
            <NativeSelectOption value="SUPER_ADMIN">Super admin</NativeSelectOption>
          </NativeSelect>
        </div>
      </div>
    </Modal>
  );
}
