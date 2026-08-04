'use client';

import React, { useState } from 'react';
import {
  Building2, Users, FileBox, Activity, TrendingUp, Globe,
  Search, MoreHorizontal, ShieldAlert, ShieldCheck, Settings2, ChevronRight
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAdminOrganizations, useSuspendOrganization, useActivateOrganization } from '@/hooks/use-admin';
import { formatDistanceToNow } from 'date-fns';
import { DataTablePagination } from '@/components/ui/data-table-pagination';

const ORG_STATUS: Record<string, { label: string; color: string }> = {
  ACTIVE: { label: 'Active', color: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' },
  SUSPENDED: { label: 'Suspended', color: 'bg-red-500/10 text-red-500 border-red-500/20' },
  PENDING: { label: 'Pending', color: 'bg-amber-500/10 text-amber-600 border-amber-500/20' },
};

export default function PlatformOrganizationsPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [suspendTarget, setSuspendTarget] = useState<any>(null);
  const [suspendReason, setSuspendReason] = useState('');
  const [quotaTarget, setQuotaTarget] = useState<any>(null);

  const { data, isLoading } = useAdminOrganizations(page, 20, search);
  const suspendOrg = useSuspendOrganization();
  const activateOrg = useActivateOrganization();

  // Robust unwrapping: handles { organizations }, { data: { organizations } }, or array
  const raw = data?.organizations ?? (data as any)?.data?.organizations ?? (Array.isArray(data) ? data : null) ?? [];
  const rawOrgs: any[] = Array.isArray(raw) ? raw : [];
  // Normalize backend fields: isActive + suspendedAt → status string
  const orgs = rawOrgs.filter(Boolean).map((org: any) => ({
    ...org,
    status: org.status ?? (org.suspendedAt ? 'SUSPENDED' : org.isActive === false ? 'INACTIVE' : 'ACTIVE'),
  }));
  const total = data?.pagination?.total ?? (data as any)?.data?.pagination?.total ?? data?.total ?? 0;

  return (
    <div className="w-full space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Organizations</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage all organizations on the platform
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{total} total</span>
        </div>
      </div>

      {/* Filters */}
      <div className="relative w-64">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search organizations..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="h-9 pl-9 text-sm bg-muted/40"
        />
      </div>

      {/* Table */}
      <Card className="rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Organization</th>
              <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Slug</th>
              <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Status</th>
              <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Members</th>
              <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Forms</th>
              <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Created</th>
              <th className="px-4 py-3 text-right font-semibold text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-card">
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} className="px-4 py-3"><Skeleton className="h-5 w-full rounded" /></td>
                  ))}
                </tr>
              ))
            ) : orgs.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-16 text-center text-muted-foreground">
                  No organizations found.
                </td>
              </tr>
            ) : (
              orgs.map((org: any) => {
                const statusInfo = ORG_STATUS[org.status ?? 'ACTIVE'] ?? ORG_STATUS.ACTIVE;
                const createdAgo = org.createdAt ? formatDistanceToNow(new Date(org.createdAt), { addSuffix: true }) : '—';
                return (
                  <tr key={org.id} className="group hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary font-bold text-sm">
                          {org.name?.charAt(0)?.toUpperCase() ?? 'O'}
                        </div>
                        <span className="font-medium text-foreground">{org.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{org.slug}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${statusInfo.color}`}>
                        {statusInfo.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{org._count?.members ?? org.memberCount ?? '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground">{org._count?.forms ?? org.formCount ?? '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{createdAgo}</td>
                    <td className="px-4 py-3 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
                          <MoreHorizontal size={15} />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setQuotaTarget(org)}>
                            <Settings2 size={14} className="mr-2" /> Edit Quotas
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {org.status === 'SUSPENDED' || org.suspendedAt ? (
                            <DropdownMenuItem onClick={() => activateOrg.mutate(org.id)} className="text-emerald-600 focus:text-emerald-600 focus:bg-emerald-50">
                              <ShieldCheck size={14} className="mr-2" /> Activate
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onClick={() => setSuspendTarget(org)} className="text-red-500 focus:text-red-600 focus:bg-red-50">
                              <ShieldAlert size={14} className="mr-2" /> Suspend
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        {/* Pagination */}
        {/* Pagination */}
        <DataTablePagination
          page={page}
          total={total}
          pageSize={20}
          onPageChange={setPage}
        />
      </Card>

      {/* Suspend Dialog */}
      <Dialog open={!!suspendTarget} onOpenChange={() => setSuspendTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Suspend Organization</DialogTitle>
            <DialogDescription>Provide a reason for suspending &quot;{suspendTarget?.name}&quot;.</DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Input placeholder="Reason for suspension..." value={suspendReason} onChange={(e) => setSuspendReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSuspendTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={async () => {
              // Capture target before any state changes to avoid null access
              const target = suspendTarget;
              if (!target?.id) return;
              setSuspendTarget(null);
              setSuspendReason('');
              await suspendOrg.mutateAsync({ orgId: target.id, reason: suspendReason || 'Suspended by administrator' });
            }} disabled={suspendOrg.isPending}>
              {suspendOrg.isPending ? 'Suspending...' : 'Suspend'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
