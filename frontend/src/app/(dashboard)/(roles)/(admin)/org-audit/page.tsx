'use client';

import React, { useState } from 'react';
import { ClipboardList, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useOrgAudit } from '@/hooks/use-audit';
import { useUser } from '@/hooks/use-auth';
import { format } from 'date-fns';

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

      <Card className="rounded-xl border border-border overflow-hidden">
        <div className="p-4 border-b border-border flex items-center gap-2">
          <ClipboardList size={16} className="text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">Activity Log</span>
        </div>
        <div className="divide-y divide-border">
          {isLoading ? (
            Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-start gap-4 px-4 py-3">
                <Skeleton className="h-8 w-8 rounded-full shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-64 rounded" />
                  <Skeleton className="h-3 w-40 rounded" />
                </div>
              </div>
            ))
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <ClipboardList size={24} className="mb-3 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No audit events found.</p>
            </div>
          ) : (
            logs.map((log: any, i: number) => {
              const action = log.action?.split('.').pop()?.toUpperCase() ?? 'ACTION';
              const actionColor = ACTION_COLORS[action] ?? 'bg-muted text-muted-foreground';
              const actorName = log.actor
                ? `${log.actor.firstName ?? ''} ${log.actor.lastName ?? ''}`.trim() || log.actor.email
                : log.actorId ?? 'System';
              const timestamp = log.createdAt ? format(new Date(log.createdAt), 'MMM dd, yyyy HH:mm:ss') : '—';

              return (
                <div key={log.id ?? i} className="flex items-start gap-4 px-4 py-3 hover:bg-muted/30 transition-colors">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground text-xs font-bold">
                    {actorName.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-foreground">{actorName}</p>
                      <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${actionColor}`}>
                        {action}
                      </span>
                      {log.resource && <span className="text-xs text-muted-foreground truncate">{log.resource}</span>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{log.action ?? log.description ?? '—'}</p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground whitespace-nowrap">{timestamp}</span>
                </div>
              );
            })
          )}
        </div>
        {total > 50 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3">
            <span className="text-xs text-muted-foreground">Page {page} of {Math.ceil(total / 50)}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}><ChevronLeft size={14} /></Button>
              <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page * 50 >= total}><ChevronRight size={14} /></Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
