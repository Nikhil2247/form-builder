'use client';

import React, { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Edit, Eye, Share2, BarChart2, Settings, Inbox,
  CheckCircle2, Clock, Users, Copy, ExternalLink, Download, Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useForm } from '@/hooks/use-forms';
import { useFormSubmissions } from '@/hooks/use-submissions';
import { formatDistanceToNow, format } from 'date-fns';

export default function FormDetailPage() {
  const params = useParams();
  const router = useRouter();
  const formId = params.formId as string;

  const { data: form, isLoading: formLoading } = useForm(formId);
  const { data: submissionsData, isLoading: subsLoading } = useFormSubmissions(formId);

  const submissions = submissionsData?.submissions ?? [];
  const totalSubmissions = submissionsData?.pagination?.total ?? submissionsData?.total ?? 0;
  const shareUrl = form?.shareUrl ?? `${typeof window !== 'undefined' ? window.location.origin : ''}/f/${form?.slug || formId}`;

  const STATUS_COLORS: Record<string, string> = {
    DRAFT: 'bg-amber-500/10 text-amber-600',
    PUBLISHED: 'bg-emerald-500/10 text-emerald-600',
    CLOSED: 'bg-slate-500/10 text-slate-500',
    ARCHIVED: 'bg-slate-400/10 text-slate-400',
  };

  if (formLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  if (!form) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <h2 className="text-xl font-semibold">Form not found</h2>
        <p className="mt-2 text-muted-foreground">This form may have been deleted or you don&apos;t have access.</p>
        <Button className="mt-4" onClick={() => router.push('/forms')}>Back to Forms</Button>
      </div>
    );
  }

  return (
    <div className="w-full space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between border-b border-border pb-4">
        <div className="flex items-start gap-3">
          <button onClick={() => router.push('/forms')} className="mt-0.5 rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
            <ArrowLeft size={18} />
          </button>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-bold tracking-tight text-foreground">{form.title}</h1>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_COLORS[form.status]}`}>{form.status}</span>
            </div>
            {form.description && <p className="mt-1 text-sm text-muted-foreground">{form.description}</p>}
            <p className="mt-1 text-xs text-muted-foreground">
              Updated {formatDistanceToNow(new Date(form.updatedAt), { addSuffix: true })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 ml-11 sm:ml-0">
          <Link href={`/forms/builder?id=${formId}`}>
            <Button variant="outline" size="sm" className="gap-2"><Edit size={14} />Edit Form</Button>
          </Link>
          <Link href={shareUrl} target="_blank">
            <Button size="sm" className="gap-2"><Eye size={14} />Preview</Button>
          </Link>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Responses" value={totalSubmissions.toString()} icon={Inbox} trend="+12%" positive />
        <StatCard label="Completion Rate" value="86%" icon={CheckCircle2} trend="+2.4%" positive />
        <StatCard label="Avg. Time" value="1m 42s" icon={Clock} trend="-8s" positive />
        <StatCard label="Unique Visitors" value="—" icon={Users} />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="responses" className="space-y-4">
        <TabsList className="bg-muted/50 rounded-xl p-1">
          <TabsTrigger value="responses" className="rounded-lg">
            <Inbox size={14} className="mr-1.5" /> Responses ({totalSubmissions})
          </TabsTrigger>
          <TabsTrigger value="share" className="rounded-lg">
            <Share2 size={14} className="mr-1.5" /> Share
          </TabsTrigger>
          <TabsTrigger value="settings" className="rounded-lg">
            <Settings size={14} className="mr-1.5" /> Settings
          </TabsTrigger>
        </TabsList>

        {/* Responses Tab */}
        <TabsContent value="responses">
          <Card className="rounded-xl border border-border overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h2 className="text-sm font-semibold text-foreground">All Responses</h2>
              <Button variant="outline" size="sm" className="gap-2">
                <Download size={13} /> Export CSV
              </Button>
            </div>
            {subsLoading ? (
              <div className="p-6 space-y-3">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 rounded-lg" />)}
              </div>
            ) : submissions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                  <Inbox size={20} className="text-muted-foreground" />
                </div>
                <h3 className="text-sm font-semibold">No responses yet</h3>
                <p className="mt-1 text-xs text-muted-foreground">Share the form to start collecting responses.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {submissions.map((sub, i) => (
                  <div key={sub.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">
                        {i + 1}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {sub.respondentEmail ?? `Response #${i + 1}`}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(sub.submittedAt), 'MMM dd, yyyy HH:mm')}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {sub.completionTime && (
                        <span className="text-xs text-muted-foreground">{Math.round(sub.completionTime)}s</span>
                      )}
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
                        View
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </TabsContent>

        {/* Share Tab */}
        <TabsContent value="share">
          <Card className="rounded-xl border border-border p-6 space-y-5">
            <div>
              <h2 className="text-sm font-semibold text-foreground mb-1">Public Form Link</h2>
              <p className="text-xs text-muted-foreground mb-3">Share this link with respondents to collect their answers.</p>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={shareUrl}
                  className="flex-1 h-9 rounded-lg border border-border bg-muted/40 px-3 text-sm text-foreground font-mono"
                />
                <Button variant="outline" size="sm" className="gap-2 shrink-0" onClick={() => navigator.clipboard.writeText(shareUrl)}>
                  <Copy size={13} /> Copy
                </Button>
                <Link href={shareUrl} target="_blank">
                  <Button variant="outline" size="sm" className="gap-2 shrink-0">
                    <ExternalLink size={13} /> Open
                  </Button>
                </Link>
              </div>
            </div>
            <div className="border-t border-border pt-5">
              <h3 className="text-sm font-semibold text-foreground mb-2">Embed Code</h3>
              <pre className="rounded-lg bg-muted p-3 text-xs text-muted-foreground overflow-x-auto">
                {`<iframe src="${shareUrl}" width="100%" height="600" frameborder="0"></iframe>`}
              </pre>
            </div>
          </Card>
        </TabsContent>

        {/* Settings Tab */}
        <TabsContent value="settings">
          <Card className="rounded-xl border border-border p-6 space-y-5">
            <div>
              <h2 className="text-sm font-semibold text-foreground mb-4">Form Settings</h2>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Form Title</label>
                  <input defaultValue={form.title} className="w-full h-9 rounded-lg border border-border bg-muted/40 px-3 text-sm text-foreground" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Description</label>
                  <textarea defaultValue={form.description ?? ''} rows={3} className="w-full rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-foreground resize-none" />
                </div>
              </div>
            </div>
            <div className="flex justify-end pt-2 border-t border-border">
              <Button size="sm">Save Changes</Button>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, trend, positive }: { label: string; value: string; icon: React.ElementType; trend?: string; positive?: boolean }) {
  return (
    <Card className="p-5 rounded-xl border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon size={15} />
        </div>
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-2xl font-black text-foreground">{value}</span>
        {trend && (
          <span className={`text-[10px] font-bold rounded-md px-1.5 py-0.5 ${positive ? 'bg-emerald-500/10 text-emerald-600' : 'bg-red-500/10 text-red-500'}`}>
            {trend}
          </span>
        )}
      </div>
    </Card>
  );
}
