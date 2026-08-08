'use client';

import React from 'react';
import { Check, ShieldCheck, User, Users } from 'lucide-react';

import {
  PageHeader,
  PageShell,
  DataTable,
  StatusBadge,
  EmptyState,
  Toolbar,
  SearchInput,
  RelativeTime,
  type DataTableColumn,
} from '@/components/shared';
import { usePagination } from '@/hooks/use-pagination';
import { useAdminUsers, type AdminUser } from '@/hooks/use-admin';

export default function PlatformUsersPage() {
  const pager = usePagination();
  const { data, isLoading, isFetching, error, refetch } = useAdminUsers({
    page: pager.page,
    limit: pager.pageSize,
    search: pager.search,
  });

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
  ];

  return (
    <PageShell>
      <PageHeader
        title="Users"
        description="Every registered account on this deployment."
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
    </PageShell>
  );
}
