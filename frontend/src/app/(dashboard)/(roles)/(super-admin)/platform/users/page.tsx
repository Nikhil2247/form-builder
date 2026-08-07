'use client';

import React, { useState } from 'react';
import { Search, User, Shield, Building2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { useAdminUsers } from '@/hooks/use-admin';
import { formatDistanceToNow } from 'date-fns';
const SYSTEM_ROLE_COLORS: Record<string, string> = {
  SUPER_ADMIN: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
  ADMIN: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  EDITOR: 'bg-sky-500/10 text-sky-600 border-sky-500/20',
  VIEWER: 'bg-slate-500/10 text-slate-500 border-slate-500/20',
};

export default function PlatformUsersPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useAdminUsers(page, 20, search);
  const users = data?.users ?? [];
  const total = data?.pagination?.total ?? data?.total ?? 0;

  return (
    <div className="w-full space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Users</h1>
          <p className="mt-1 text-sm text-muted-foreground">All registered users on the platform</p>
        </div>
        <span className="text-sm text-muted-foreground">{total} total users</span>
      </div>

      {/* Search */}
      <div className="relative w-64">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search users..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="h-9 pl-9 text-sm bg-muted/40" />
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>System Role</TableHead>
              <TableHead>Organization</TableHead>
              <TableHead>Joined</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 5 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-5 w-full rounded" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-16 text-muted-foreground">No users found.</TableCell>
              </TableRow>
            ) : (
              users.map((user: any) => {
                const roleColor = SYSTEM_ROLE_COLORS[user.systemRole ?? 'VIEWER'] ?? SYSTEM_ROLE_COLORS.VIEWER;
                const initials = `${user.firstName?.charAt(0) ?? ''}${user.lastName?.charAt(0) ?? ''}`.toUpperCase() || 'U';
                const joinedAgo = user.createdAt ? formatDistanceToNow(new Date(user.createdAt), { addSuffix: true }) : '—';
                return (
                  <TableRow key={user.id} className="group hover:bg-muted/30 transition-colors">
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/60 text-primary-foreground text-xs font-bold">
                          {initials}
                        </div>
                        <span className="font-medium text-foreground">
                          {[user.firstName, user.lastName].filter(Boolean).join(' ') || 'Unnamed'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{user.email}</TableCell>
                    <TableCell>
                      <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${roleColor}`}>
                        {user.systemRole ?? 'VIEWER'}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {user.memberships?.[0]?.organization?.name ?? user.organization?.name ?? <span className="text-muted-foreground/50 italic">None</span>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{joinedAgo}</TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
        {!isLoading && users.length > 0 && (
          <div className="p-4 border-t border-border">
            {(() => {
              const totalPages = Math.ceil(total / 20);
              return (
                <Pagination>
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious 
                        href="#" 
                        onClick={(e) => { e.preventDefault(); setPage(Math.max(1, page - 1)); }} 
                        className={page === 1 ? 'pointer-events-none opacity-50' : ''} 
                      />
                    </PaginationItem>
                    <PaginationItem>
                      <span className="text-sm font-medium mx-2">Page {page} of {totalPages || 1}</span>
                    </PaginationItem>
                    <PaginationItem>
                      <PaginationNext 
                        href="#" 
                        onClick={(e) => { e.preventDefault(); setPage(Math.min(totalPages, page + 1)); }} 
                        className={page === totalPages || totalPages === 0 ? 'pointer-events-none opacity-50' : ''} 
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
