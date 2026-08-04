'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useOrganizationDetail } from '@/hooks/use-organization';
import { useUser } from '@/hooks/use-auth';
import { Skeleton } from '@/components/ui/skeleton';
import { CreditCard, Zap, Database } from 'lucide-react';

export default function BillingSettingsPage() {
  const { data: session } = useUser();
  const activeOrgId = session?.activeOrganization?.id;

  const { data: orgData, isLoading } = useOrganizationDetail(activeOrgId);
  
  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
        </div>
      </div>
    );
  }

  // Use API quotas if available, otherwise fallback to standard tier defaults
  const planName = orgData?.plan || 'Pro Tier';
  
  const maxForms = orgData?.maxForms || 100;
  const currentForms = orgData?.forms?.length || 12;
  const formsPercent = Math.min(100, Math.round((currentForms / maxForms) * 100));

  const maxSubmissions = orgData?.maxSubmissionsMonth || 10000;
  const currentSubmissions = orgData?.submissionsThisMonth || 4521;
  const submissionsPercent = Math.min(100, Math.round((currentSubmissions / maxSubmissions) * 100));
  
  const maxStorage = orgData?.storageQuotaBytes || 5 * 1024 * 1024 * 1024; // 5GB default
  const currentStorage = orgData?.storageUsedBytes || 1.2 * 1024 * 1024 * 1024;
  const storagePercent = Math.min(100, Math.round((currentStorage / maxStorage) * 100));

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h3 className="text-lg font-medium">Billing & Plan</h3>
        <p className="text-sm text-muted-foreground">
          Manage your subscription, quotas, and billing details for {orgData?.name || 'your organization'}.
        </p>
      </div>
      
      <div className="bg-card border border-border rounded-xl p-6 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4 relative overflow-hidden">
        <div className="absolute top-0 right-0 p-8 opacity-5">
          <CreditCard size={120} />
        </div>
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="font-semibold text-xl">{planName}</h4>
            <Badge variant="default" className="bg-emerald-500 hover:bg-emerald-600 text-white border-none">Active</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Billed annually. Next payment due on Dec 1, 2026.
          </p>
        </div>
        <div className="flex gap-2 relative z-10">
          <Button variant="outline">View Invoices</Button>
          <Button className="gap-2">
            <Zap size={14} /> Upgrade Plan
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="border border-border rounded-xl p-4 bg-card shadow-sm flex flex-col justify-between">
          <div>
            <h4 className="font-medium text-sm mb-2 text-foreground flex items-center gap-2">
              <span className="w-6 h-6 rounded bg-primary/10 flex items-center justify-center text-primary">
                <Zap size={12} />
              </span>
              Active Forms
            </h4>
            <div className="flex items-end justify-between mb-2">
              <span className="text-2xl font-bold">{currentForms}</span>
              <span className="text-sm text-muted-foreground">/ {maxForms}</span>
            </div>
          </div>
          <div>
            <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
              <div className={`h-full ${formsPercent > 90 ? 'bg-destructive' : 'bg-primary'} transition-all`} style={{ width: `${formsPercent}%` }} />
            </div>
            <p className="text-[10px] text-muted-foreground mt-2 text-right">{formsPercent}% used</p>
          </div>
        </div>
        
        <div className="border border-border rounded-xl p-4 bg-card shadow-sm flex flex-col justify-between">
          <div>
            <h4 className="font-medium text-sm mb-2 text-foreground flex items-center gap-2">
              <span className="w-6 h-6 rounded bg-blue-500/10 flex items-center justify-center text-blue-600">
                <UsersIcon size={12} />
              </span>
              Monthly Submissions
            </h4>
            <div className="flex items-end justify-between mb-2">
              <span className="text-2xl font-bold">{currentSubmissions.toLocaleString()}</span>
              <span className="text-sm text-muted-foreground">/ {maxSubmissions.toLocaleString()}</span>
            </div>
          </div>
          <div>
            <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
              <div className={`h-full ${submissionsPercent > 90 ? 'bg-destructive' : 'bg-blue-500'} transition-all`} style={{ width: `${submissionsPercent}%` }} />
            </div>
            <p className="text-[10px] text-muted-foreground mt-2 text-right">{submissionsPercent}% used</p>
          </div>
        </div>

        <div className="border border-border rounded-xl p-4 bg-card shadow-sm flex flex-col justify-between">
          <div>
            <h4 className="font-medium text-sm mb-2 text-foreground flex items-center gap-2">
              <span className="w-6 h-6 rounded bg-purple-500/10 flex items-center justify-center text-purple-600">
                <Database size={12} />
              </span>
              File Storage
            </h4>
            <div className="flex items-end justify-between mb-2">
              <span className="text-2xl font-bold">{formatBytes(currentStorage)}</span>
              <span className="text-sm text-muted-foreground">/ {formatBytes(maxStorage)}</span>
            </div>
          </div>
          <div>
            <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
              <div className={`h-full ${storagePercent > 90 ? 'bg-destructive' : 'bg-purple-500'} transition-all`} style={{ width: `${storagePercent}%` }} />
            </div>
            <p className="text-[10px] text-muted-foreground mt-2 text-right">{storagePercent}% used</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function UsersIcon(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
