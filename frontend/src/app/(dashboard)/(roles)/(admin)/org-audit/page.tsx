'use client';

import React, { useState } from 'react';
import { ClipboardList, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useOrgAudit } from '@/hooks/use-audit';
import { useUser } from '@/hooks/use-auth';
import { format } from 'date-fns';
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

const ACTION_COLORS: Record<string, string> = {
  CREATE: 'bg-emerald-500/10 text-emerald-600',
  UPDATE: 'bg-blue-500/10 text-blue-600',
  DELETE: 'bg-red-500/10 text-red-500',
  PUBLISH: 'bg-purple-500/10 text-purple-600',
  RESTORE: 'bg-amber-500/10 text-amber-600',
  INVITE: 'bg-sky-500/10 text-sky-600',
  LOGIN: 'bg-slate-500/10 text-slate-500',
};

export default function OrgAuditPage() {
  const { data: session } = useUser();
  const orgId = session?.activeOrganization?.id;
  const [page, setPage] = useState(1);

  const { data, isLoading } = useOrgAudit(orgId, page);
  const logs = data?.logs ?? [];
  const total = data?.pagination?.total ?? 0;

  return (
    <div className="w-full space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Audit Logs</h1>
          <p className="mt-1 text-sm text-muted-foreground">Track all actions performed within your organization.</p>
        </div>
        {total > 0 && <span className="text-sm text-muted-foreground">{total} total events</span>}
      </div>

      <div className="rounded-xl border border-border overflow-hidden">
        <div className="p-4 border-b border-border flex items-center gap-2">
          <ClipboardList size={16} className="text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">Activity Log</span>
        </div>
        <div className="rounded-md border-t border-border">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Resource</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Timestamp</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-48" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-4 w-32 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : logs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-16 text-muted-foreground">
                    <div className="flex flex-col items-center justify-center">
                      <ClipboardList size={24} className="mb-3 text-muted-foreground" />
                      <p className="text-sm">No audit events found.</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                logs.map((log: any, i: number) => {
                  const action = log.action?.split('.').pop()?.toUpperCase() ?? 'ACTION';
                  const actionColor = ACTION_COLORS[action] ?? 'bg-muted text-muted-foreground';
                  const actorName = log.actor
                    ? `${log.actor.firstName ?? ''} ${log.actor.lastName ?? ''}`.trim() || log.actor.email
                    : log.actorId ?? 'System';
                  const timestamp = log.createdAt ? format(new Date(log.createdAt), 'MMM dd, yyyy HH:mm:ss') : '—';

                  return (
                    <TableRow key={log.id ?? i} className="hover:bg-muted/30 transition-colors">
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground text-xs font-bold">
                            {actorName.charAt(0).toUpperCase()}
                          </div>
                          <span className="text-sm font-medium text-foreground">{actorName}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${actionColor}`}>
                          {action}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">{log.resource || '—'}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">{log.action ?? log.description ?? '—'}</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground whitespace-nowrap">{timestamp}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
        {!isLoading && logs.length > 0 && (
          <div className="p-4 border-t border-border">
            {(() => {
              const totalPages = Math.ceil(total / 50);
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
