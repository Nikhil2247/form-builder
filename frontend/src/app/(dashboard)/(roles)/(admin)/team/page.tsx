'use client';

import React, { useState } from 'react';
import { Check, Mail, MoreHorizontal, Plus, Shield, UserCheck, UserX, Users } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  PageHeader,
  PageShell,
  DataTable,
  StatusBadge,
  EmptyState,
  Modal,
  ModalActions,
  ConfirmDialog,
  RelativeTime,
  type DataTableColumn,
} from '@/components/shared';
import { usePagination } from '@/hooks/use-pagination';
import { useUser } from '@/hooks/use-auth';
import {
  useOrganizationMembers,
  useOrganizationInvites,
  useInviteMember,
  useRevokeInvite,
  useUpdateMemberRole,
  useRemoveMember,
  type OrgMember,
  type OrgInvitation,
} from '@/hooks/use-organization';
import { ORG_ROLE_DESCRIPTIONS, ORG_ROLE_LABELS, type OrgRole } from '@/config/roles';

export default function TeamPage() {
  const { data: session } = useUser();
  const currentUserId = session?.user?.id;

  // Two independent pagers on one page — the `prefix` keeps their query params
  // from colliding, which the previous two `useState(1)` counters silently did
  // not do (both tabs shared no URL state at all).
  const membersPager = usePagination({ prefix: 'm' });
  const invitesPager = usePagination({ prefix: 'i' });

  const members = useOrganizationMembers({
    page: membersPager.page,
    limit: membersPager.pageSize,
  });
  const invites = useOrganizationInvites({
    page: invitesPager.page,
    limit: invitesPager.pageSize,
  });

  const inviteMember = useInviteMember();
  const revokeInvite = useRevokeInvite();
  const updateRole = useUpdateMemberRole();
  const removeMember = useRemoveMember();

  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<OrgMember | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<OrgInvitation | null>(null);

  const memberRows = members.data?.items ?? [];
  const memberTotal = members.data?.pagination.total ?? 0;
  const inviteRows = invites.data?.items ?? [];
  const inviteTotal = invites.data?.pagination.total ?? 0;

  // An organization with no admin cannot be administered. Block the last one
  // from demoting or removing themselves — the API rejects it, but only after
  // the UI has already suggested it is possible.
  const adminCount = memberRows.filter((m) => m.role === 'ADMIN').length;

  async function changeRole(member: OrgMember, role: OrgRole) {
    if (member.role === role) return;
    if (member.role === 'ADMIN' && role !== 'ADMIN' && adminCount <= 1) {
      toast.error('Your organization must keep at least one admin.');
      return;
    }
    try {
      await updateRole.mutateAsync({ memberId: member.id, role });
      toast.success(`${member.user.email} is now ${ORG_ROLE_LABELS[role]}`);
    } catch {
      // Reported globally.
    }
  }

  const memberColumns: DataTableColumn<OrgMember>[] = [
    {
      id: 'user',
      header: 'Member',
      isRowHeader: true,
      className: 'max-w-0',
      cell: (member) => {
        const name = [member.user.firstName, member.user.lastName].filter(Boolean).join(' ');
        const initials =
          `${member.user.firstName?.[0] ?? ''}${member.user.lastName?.[0] ?? ''}`.toUpperCase() ||
          member.user.email[0]?.toUpperCase() ||
          '?';

        return (
          <div className="flex items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
              {initials}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate font-medium text-foreground">
                  {name || member.user.email}
                </span>
                {member.user.id === currentUserId && (
                  <span className="text-xs text-muted-foreground">(you)</span>
                )}
              </div>
              <div className="truncate text-xs text-muted-foreground">{member.user.email}</div>
            </div>
          </div>
        );
      },
    },
    {
      id: 'role',
      header: 'Role',
      width: 'w-32',
      cell: (member) => <StatusBadge status={member.role} />,
    },
    {
      id: 'joinedAt',
      header: 'Joined',
      width: 'w-36',
      hideBelow: 'lg',
      cell: (member) => (
        <span className="text-muted-foreground">
          <RelativeTime value={member.joinedAt} />
        </span>
      ),
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      width: 'w-12',
      className: 'text-right',
      headerClassName: 'text-right',
      cell: (member) => {
        if (member.user.id === currentUserId) return null;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={`Actions for ${member.user.email}`}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            {/* `min-w` and `whitespace-nowrap` are doing real work here. The
                menu primitive is `w-auto min-w-[96px]`, so it shrank to the
                widest word rather than the widest label and broke every item
                across two or three lines — "Remove from organization" rendered
                as a three-line paragraph in red. */}
            <DropdownMenuContent align="end" className="min-w-52">
              <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
                Change role
              </DropdownMenuLabel>

              {(['ADMIN', 'EDITOR', 'VIEWER'] as OrgRole[]).map((role) => {
                const isCurrent = member.role === role;
                const Icon = role === 'ADMIN' ? Shield : UserCheck;
                return (
                  <DropdownMenuItem
                    key={role}
                    // The current role stays selectable-looking but inert, and
                    // says WHY with a tick. Disabling it greyed the row out to
                    // look like a permission problem rather than "already set".
                    disabled={isCurrent}
                    onClick={() => changeRole(member, role)}
                    className="cursor-pointer justify-between gap-3 whitespace-nowrap"
                  >
                    <span className="flex items-center gap-2">
                      <Icon className="size-3.5 shrink-0" strokeWidth={1.5} />
                      {ORG_ROLE_LABELS[role]}
                    </span>
                    {isCurrent && (
                      <Check className="size-3.5 shrink-0 text-primary" strokeWidth={2} />
                    )}
                  </DropdownMenuItem>
                );
              })}

              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setRemoveTarget(member)}
                className="cursor-pointer gap-2 whitespace-nowrap text-destructive focus:bg-destructive/10 focus:text-destructive"
              >
                <UserX className="size-3.5 shrink-0" strokeWidth={1.5} />
                Remove from organization
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  const inviteColumns: DataTableColumn<OrgInvitation>[] = [
    {
      id: 'email',
      header: 'Email',
      isRowHeader: true,
      className: 'max-w-0',
      cell: (invite) => (
        <div className="flex items-center gap-2.5">
          <Mail className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.5} />
          <span className="truncate font-medium">{invite.email}</span>
        </div>
      ),
    },
    {
      id: 'role',
      header: 'Role',
      width: 'w-28',
      cell: (invite) => <StatusBadge status={invite.role} />,
    },
    {
      id: 'status',
      header: 'Status',
      width: 'w-28',
      cell: (invite) => <StatusBadge status={invite.status} dot />,
    },
    {
      id: 'createdAt',
      header: 'Sent',
      width: 'w-36',
      hideBelow: 'md',
      cell: (invite) => (
        <span className="text-muted-foreground">
          <RelativeTime value={invite.createdAt} />
        </span>
      ),
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      width: 'w-24',
      className: 'text-right',
      headerClassName: 'text-right',
      cell: (invite) =>
        invite.status === 'PENDING' ? (
          <Button variant="ghost" size="sm" onClick={() => setRevokeTarget(invite)}>
            Revoke
          </Button>
        ) : null,
    },
  ];

  return (
    <PageShell>
      <PageHeader
        title="Team"
        description="Members and pending invitations for your organization."
        actions={
          <Button size="sm" className="gap-2" onClick={() => setIsInviteOpen(true)}>
            <Plus className="size-4" /> Invite member
          </Button>
        }
      />

      <Tabs defaultValue="members" className="space-y-4">
        <TabsList>
          <TabsTrigger value="members" className="gap-1.5">
            <Users className="size-3.5" /> Members
            <span className="tabular ml-1 rounded bg-muted px-1.5 text-xs text-muted-foreground">
              {memberTotal}
            </span>
          </TabsTrigger>
          <TabsTrigger value="invitations" className="gap-1.5">
            <Mail className="size-3.5" /> Invitations
            <span className="tabular ml-1 rounded bg-muted px-1.5 text-xs text-muted-foreground">
              {inviteTotal}
            </span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="members">
          <DataTable
            caption="Organization members"
            columns={memberColumns}
            data={memberRows}
            getRowId={(member) => member.id}
            isLoading={members.isLoading || members.isFetching}
            error={members.error}
            onRetry={() => members.refetch()}
            pagination={membersPager.paginationProps(memberTotal, 'members')}
            empty={
              <EmptyState
                variant="inline"
                icon={Users}
                title="No members"
                description="Invite colleagues to collaborate on forms."
              />
            }
          />
        </TabsContent>

        <TabsContent value="invitations">
          <DataTable
            caption="Pending invitations"
            columns={inviteColumns}
            data={inviteRows}
            getRowId={(invite) => invite.id}
            isLoading={invites.isLoading || invites.isFetching}
            error={invites.error}
            onRetry={() => invites.refetch()}
            pagination={invitesPager.paginationProps(inviteTotal, 'invitations')}
            empty={
              <EmptyState
                variant="inline"
                icon={Mail}
                title="No invitations"
                description="Invitations you send will appear here until they are accepted."
                action={
                  <Button size="sm" className="gap-2" onClick={() => setIsInviteOpen(true)}>
                    <Plus className="size-4" /> Invite member
                  </Button>
                }
              />
            }
          />
        </TabsContent>
      </Tabs>

      <InviteModal
        open={isInviteOpen}
        onOpenChange={setIsInviteOpen}
        isPending={inviteMember.isPending}
        onInvite={async (values) => {
          try {
            await inviteMember.mutateAsync(values);
            toast.success(`Invitation sent to ${values.email}`);
            setIsInviteOpen(false);
          } catch {
            // Reported globally; the dialog stays open with the address typed.
          }
        }}
      />

      <ConfirmDialog
        open={!!removeTarget}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title="Remove member"
        description={
          <>
            {removeTarget?.user.email} will lose access to this organization immediately. Forms
            they created are kept.
          </>
        }
        confirmLabel="Remove member"
        isPending={removeMember.isPending}
        onConfirm={async () => {
          if (!removeTarget) return;
          try {
            await removeMember.mutateAsync(removeTarget.id);
            toast.success('Member removed');
            setRemoveTarget(null);
          } catch {
            // Reported globally.
          }
        }}
      />

      <ConfirmDialog
        open={!!revokeTarget}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        title="Revoke invitation"
        description={<>The invitation link sent to {revokeTarget?.email} will stop working.</>}
        confirmLabel="Revoke invitation"
        isPending={revokeInvite.isPending}
        onConfirm={async () => {
          if (!revokeTarget) return;
          try {
            await revokeInvite.mutateAsync(revokeTarget.id);
            toast.success('Invitation revoked');
            setRevokeTarget(null);
          } catch {
            // Reported globally.
          }
        }}
      />
    </PageShell>
  );
}

function InviteModal({
  open,
  onOpenChange,
  onInvite,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInvite: (values: { email: string; role: OrgRole }) => void;
  isPending: boolean;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrgRole>('VIEWER');

  React.useEffect(() => {
    if (open) {
      setEmail('');
      setRole('VIEWER');
    }
  }, [open]);

  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Invite a team member"
      description="They will receive an email with a link to join this organization."
      footer={
        <ModalActions
          onCancel={() => onOpenChange(false)}
          confirmLabel="Send invitation"
          onConfirm={() => onInvite({ email: email.trim(), role })}
          isPending={isPending}
          disabled={!valid}
        />
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="invite-email">Email address</Label>
          <Input
            id="invite-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && valid && onInvite({ email: email.trim(), role })}
            placeholder="colleague@company.com"
            autoFocus
            aria-invalid={email.length > 0 && !valid}
          />
          {email.length > 0 && !valid && (
            <p className="text-xs text-destructive">Enter a valid email address.</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="invite-role">Role</Label>
          <Select value={role} onValueChange={(value) => value && setRole(value as OrgRole)}>
            <SelectTrigger id="invite-role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(['VIEWER', 'EDITOR', 'ADMIN'] as OrgRole[]).map((option) => (
                <SelectItem key={option} value={option}>
                  {ORG_ROLE_LABELS[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{ORG_ROLE_DESCRIPTIONS[role]}</p>
        </div>
      </div>
    </Modal>
  );
}
