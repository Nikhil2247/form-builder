'use client';

import React, { useState } from 'react';
import {
  Users, Mail, Plus, Trash2, ChevronDown, MoreHorizontal,
  Clock, Shield, UserCheck, UserX, RefreshCcw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  useOrganizationMembers, useOrganizationInvites, useInviteMember,
  useRevokeInvite, useUpdateMemberRole, useRemoveMember,
} from '@/hooks/use-organization';
import { useUser } from '@/hooks/use-auth';
import { formatDistanceToNow } from 'date-fns';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';

const ROLE_BADGE: Record<string, string> = {
  ADMIN: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  EDITOR: 'bg-sky-500/10 text-sky-600 border-sky-500/20',
  VIEWER: 'bg-slate-500/10 text-slate-500 border-slate-500/20',
};

const INVITE_STATUS: Record<string, string> = {
  PENDING: 'bg-amber-500/10 text-amber-600',
  ACCEPTED: 'bg-emerald-500/10 text-emerald-600',
  EXPIRED: 'bg-slate-400/10 text-slate-400',
};

export default function TeamPage() {
  const { data: session } = useUser();
  const orgId = session?.activeOrganization?.id;
  const currentUserId = session?.user?.id;

  const [membersPage, setMembersPage] = useState(1);
  const [invitesPage, setInvitesPage] = useState(1);

  const { data: membersData, isLoading: membersLoading } = useOrganizationMembers(orgId, membersPage, 20);
  const { data: invitesData, isLoading: invitesLoading } = useOrganizationInvites(orgId, invitesPage, 20);
  const inviteMember = useInviteMember(orgId);
  const revokeInvite = useRevokeInvite(orgId);
  const updateRole = useUpdateMemberRole(orgId);
  const removeMember = useRemoveMember(orgId);

  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('VIEWER');
  const [removeTarget, setRemoveTarget] = useState<any>(null);

  const members = Array.isArray(membersData) ? membersData : (membersData as any)?.members ?? membersData ?? [];
  const membersTotal = (membersData as any)?.pagination?.total ?? members.length;

  const invites = Array.isArray(invitesData) ? invitesData : (invitesData as any)?.invitations ?? (invitesData as any)?.invites ?? invitesData ?? [];
  const invitesTotal = (invitesData as any)?.pagination?.total ?? invites.length;

  async function handleInvite() {
    if (!inviteEmail.trim()) return;
    await inviteMember.mutateAsync({ email: inviteEmail, role: inviteRole });
    setIsInviteOpen(false);
    setInviteEmail('');
    setInviteRole('VIEWER');
  }

  return (
    <div className="w-full space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Team</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage members and invitations for your organization
          </p>
        </div>
        <Button className="gap-2" onClick={() => setIsInviteOpen(true)}>
          <Plus size={15} /> Invite Member
        </Button>
      </div>

      <Tabs defaultValue="members" className="space-y-4">
        <TabsList className="bg-muted/50 rounded-xl p-1">
          <TabsTrigger value="members" className="rounded-lg">
            <Users size={14} className="mr-1.5" /> Members ({membersTotal})
          </TabsTrigger>
          <TabsTrigger value="invitations" className="rounded-lg">
            <Mail size={14} className="mr-1.5" /> Invitations ({invitesTotal})
          </TabsTrigger>
        </TabsList>

        {/* Members Tab */}
        <TabsContent value="members">
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="p-4 border-b border-border">
              <h2 className="text-sm font-semibold text-foreground">Organization Members</h2>
            </div>
            <div className="divide-y divide-border">
              {membersLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-4 px-4 py-3">
                    <Skeleton className="h-9 w-9 rounded-full shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-4 w-40 rounded" />
                      <Skeleton className="h-3 w-56 rounded" />
                    </div>
                    <Skeleton className="h-6 w-16 rounded-full" />
                  </div>
                ))
              ) : members.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Users size={24} className="mb-3 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">No members found.</p>
                </div>
              ) : (
                members.map((member: any) => {
                  const isCurrentUser = member.userId === currentUserId || member.user?.id === currentUserId;
                  const user = member.user ?? member;
                  const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email;
                  const initials = `${user.firstName?.charAt(0) ?? ''}${user.lastName?.charAt(0) ?? ''}`.toUpperCase() || 'U';
                  const roleBadge = ROLE_BADGE[member.role ?? 'VIEWER'] ?? ROLE_BADGE.VIEWER;

                  return (
                    <div key={member.id} className="group flex items-center gap-4 px-4 py-3 hover:bg-muted/30 transition-colors">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/60 text-primary-foreground text-sm font-bold">
                        {initials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-foreground truncate">{name}</p>
                          {isCurrentUser && <span className="text-[10px] text-muted-foreground">(you)</span>}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                      </div>
                      <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${roleBadge}`}>
                        {member.role}
                      </span>
                      {!isCurrentUser && (
                        <DropdownMenu>
                          <DropdownMenuTrigger className="rounded-md p-1.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-accent hover:text-foreground transition-all">
                            <MoreHorizontal size={15} />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => updateRole.mutate({ userId: member.id, role: 'ADMIN' })}>
                              <Shield size={13} className="mr-2" /> Make Admin
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => updateRole.mutate({ userId: member.id, role: 'EDITOR' })}>
                              <UserCheck size={13} className="mr-2" /> Make Editor
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => updateRole.mutate({ userId: member.id, role: 'VIEWER' })}>
                              <UserCheck size={13} className="mr-2" /> Make Viewer
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => setRemoveTarget(member)} className="text-destructive focus:text-destructive focus:bg-destructive/10">
                              <UserX size={13} className="mr-2" /> Remove
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {!membersLoading && members.length > 0 && (
              <div className="p-4 border-t border-border">
                {(() => {
                  const totalPages = Math.ceil(membersTotal / 20);
                  return (
                    <Pagination>
                      <PaginationContent>
                        <PaginationItem>
                          <PaginationPrevious 
                            href="#" 
                            onClick={(e) => { e.preventDefault(); setMembersPage(Math.max(1, membersPage - 1)); }} 
                            className={membersPage === 1 ? 'pointer-events-none opacity-50' : ''} 
                          />
                        </PaginationItem>
                        <PaginationItem>
                          <span className="text-sm font-medium mx-2">Page {membersPage} of {totalPages || 1}</span>
                        </PaginationItem>
                        <PaginationItem>
                          <PaginationNext 
                            href="#" 
                            onClick={(e) => { e.preventDefault(); setMembersPage(Math.min(totalPages, membersPage + 1)); }} 
                            className={membersPage === totalPages || totalPages === 0 ? 'pointer-events-none opacity-50' : ''} 
                          />
                        </PaginationItem>
                      </PaginationContent>
                    </Pagination>
                  );
                })()}
              </div>
            )}
          </div>
        </TabsContent>

        {/* Invitations Tab */}
        <TabsContent value="invitations">
          <div className="rounded-xl border border-border overflow-hidden">
            <div className="p-4 border-b border-border">
              <h2 className="text-sm font-semibold text-foreground">Pending Invitations</h2>
            </div>
            <div className="divide-y divide-border">
              {invitesLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-4 px-4 py-3">
                    <Skeleton className="h-4 w-48 rounded" />
                    <Skeleton className="h-4 w-20 rounded" />
                  </div>
                ))
              ) : invites.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Mail size={24} className="mb-3 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">No pending invitations.</p>
                  <Button variant="outline" size="sm" className="mt-3 gap-2" onClick={() => setIsInviteOpen(true)}>
                    <Plus size={13} /> Send Invitation
                  </Button>
                </div>
              ) : (
                invites.map((invite: any) => {
                  const statusColor = INVITE_STATUS[invite.status ?? 'PENDING'] ?? INVITE_STATUS.PENDING;
                  const sentAgo = invite.createdAt ? formatDistanceToNow(new Date(invite.createdAt), { addSuffix: true }) : '—';
                  return (
                    <div key={invite.id} className="group flex items-center gap-4 px-4 py-3 hover:bg-muted/30 transition-colors">
                      <Mail size={16} className="shrink-0 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">{invite.email}</p>
                        <p className="text-xs text-muted-foreground">Sent {sentAgo}</p>
                      </div>
                      <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${ROLE_BADGE[invite.role ?? 'VIEWER'] ?? ''}`}>
                        {invite.role}
                      </span>
                      <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${statusColor}`}>
                        {invite.status ?? 'PENDING'}
                      </span>
                      {invite.status === 'PENDING' && (
                        <button
                          onClick={() => revokeInvite.mutate(invite.id)}
                          className="rounded-md p-1.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-red-100 hover:text-red-500 transition-all"
                          title="Revoke invite"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {!invitesLoading && invites.length > 0 && (
              <div className="p-4 border-t border-border">
                {(() => {
                  const totalPages = Math.ceil(invitesTotal / 20);
                  return (
                    <Pagination>
                      <PaginationContent>
                        <PaginationItem>
                          <PaginationPrevious 
                            href="#" 
                            onClick={(e) => { e.preventDefault(); setInvitesPage(Math.max(1, invitesPage - 1)); }} 
                            className={invitesPage === 1 ? 'pointer-events-none opacity-50' : ''} 
                          />
                        </PaginationItem>
                        <PaginationItem>
                          <span className="text-sm font-medium mx-2">Page {invitesPage} of {totalPages || 1}</span>
                        </PaginationItem>
                        <PaginationItem>
                          <PaginationNext 
                            href="#" 
                            onClick={(e) => { e.preventDefault(); setInvitesPage(Math.min(totalPages, invitesPage + 1)); }} 
                            className={invitesPage === totalPages || totalPages === 0 ? 'pointer-events-none opacity-50' : ''} 
                          />
                        </PaginationItem>
                      </PaginationContent>
                    </Pagination>
                  );
                })()}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Invite Dialog */}
      <Dialog open={isInviteOpen} onOpenChange={setIsInviteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Invite Team Member</DialogTitle>
            <DialogDescription>Send an invitation to add someone to your organization.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Email Address</label>
              <Input placeholder="colleague@company.com" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleInvite()} autoFocus />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Role</label>
              <Select value={inviteRole} onValueChange={(v) => setInviteRole(v ?? 'VIEWER')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="VIEWER">Viewer — can view forms and responses</SelectItem>
                  <SelectItem value="EDITOR">Editor — can create and edit forms</SelectItem>
                  <SelectItem value="ADMIN">Admin — full organization access</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsInviteOpen(false)}>Cancel</Button>
            <Button onClick={handleInvite} disabled={!inviteEmail.trim() || inviteMember.isPending}>
              {inviteMember.isPending ? 'Sending...' : 'Send Invitation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove Member Dialog */}
      <Dialog open={!!removeTarget} onOpenChange={() => setRemoveTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove Member</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove {removeTarget?.user?.email ?? removeTarget?.email} from your organization?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemoveTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={async () => {
              await removeMember.mutateAsync(removeTarget.id);
              setRemoveTarget(null);
            }} disabled={removeMember.isPending}>
              {removeMember.isPending ? 'Removing...' : 'Remove Member'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
