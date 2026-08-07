'use client';

import React from 'react';
import Link from 'next/link';
import { Plus, LayoutGrid, Search, MessageSquare, Monitor, BarChart2 } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useForms } from '@/hooks/use-forms';
import { useTemplates } from '@/hooks/use-templates';
import { useUser } from '@/hooks/use-auth';
import { formatDistanceToNow, format } from 'date-fns';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { useState } from 'react';

export default function FormSubmissionDashboard() {
  const [page, setPage] = useState(1);
  const { data: session } = useUser();
  const orgRole = session?.activeOrganization?.role ?? 'VIEWER';
  const canBuild = orgRole === 'ADMIN' || orgRole === 'EDITOR';
  
  const { data: formsData, isLoading: formsLoading } = useForms(undefined, page, 5);
  const { data: templatesRes, isLoading: templatesLoading } = useTemplates();

  const forms = formsData?.forms ?? [];
  const quickTemplates = (templatesRes?.templates ?? []).slice(0, 3);
  
  const activeForms = forms.filter(f => f.status === 'PUBLISHED').length;
  const totalSubmissions = forms.reduce((acc: number, f: any) => acc + (f._count?.submissions || f.responseCount || 0), 0);

  return (
    <div className="w-full space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <h1 className="text-xl font-bold text-foreground tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Overview of your organization's forms, templates, and submissions.</p>
        </div>
        <div className="flex items-center gap-3">
          {canBuild && (
            <Link href="/forms/builder" className={buttonVariants({ variant: 'default', className: 'gap-2 shadow-sm' })}>
              <Plus size={16} />
              Create Form
            </Link>
          )}
        </div>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-5 shadow-sm border-border bg-card flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Total Forms</span>
            <div className="w-8 h-8 rounded-xl bg-blue-500/10 text-blue-600 flex items-center justify-center">
              <LayoutGrid size={16} />
            </div>
          </div>
          <div className="mt-4">
            <span className="text-2xl font-black text-foreground">{formsLoading ? <Skeleton className="h-8 w-16" /> : forms.length}</span>
          </div>
        </Card>
        
        <Card className="p-5 shadow-sm border-border bg-card flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Active Published</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
              <Monitor size={16} />
            </div>
          </div>
          <div className="mt-4">
            <span className="text-2xl font-black text-foreground">{formsLoading ? <Skeleton className="h-8 w-16" /> : activeForms}</span>
          </div>
        </Card>

        <Card className="p-5 shadow-sm border-border bg-card flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Total Submissions</span>
            <div className="w-8 h-8 rounded-xl bg-purple-500/10 text-purple-600 flex items-center justify-center">
              <BarChart2 size={16} />
            </div>
          </div>
          <div className="mt-4">
            <span className="text-2xl font-black text-foreground">{formsLoading ? <Skeleton className="h-8 w-16" /> : totalSubmissions}</span>
          </div>
        </Card>
      </div>

      {/* Start New Form Section */}
      {canBuild && (
        <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground tracking-tight">Quick Start Templates</h2>
          <Link href="/templates" className={buttonVariants({ variant: 'link', size: 'sm', className: 'text-muted-foreground hover:text-foreground h-auto p-0 font-medium' })}>
              <LayoutGrid size={14} className="mr-1.5" />
              View all templates
          </Link>
        </div>

        {/* Compact Form Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {templatesLoading ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[140px] rounded-xl" />)
          ) : (
            <>
              {/* Blank Form Card */}
              <Link
                href="/forms/builder"
                className="border border-border border-dashed rounded-xl p-4 flex flex-col items-center justify-center text-center cursor-pointer hover:border-primary hover:bg-accent/50 transition-all duration-300 hover:-translate-y-1 bg-card text-card-foreground min-h-[140px] group shadow-sm"
              >
                <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center text-primary group-hover:scale-105 group-hover:bg-primary group-hover:text-primary-foreground transition-all mb-3">
                  <Plus size={20} />
                </div>
                <h3 className="font-semibold text-sm">Blank Form</h3>
                <p className="text-xs text-muted-foreground mt-1">Create from scratch</p>
              </Link>

              {/* Template Cards */}
              {quickTemplates.map((template) => (
                <Link
                  key={template.id}
                  href={`/templates`}
                  className="border border-border rounded-xl cursor-pointer hover:border-primary/50 hover:shadow-md transition-all duration-300 hover:-translate-y-1 bg-card text-card-foreground flex flex-col justify-between min-h-[140px] group p-4 shadow-sm"
                >
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-semibold text-sm truncate">{template.title}</h3>
                      <Badge variant="secondary" className="text-[10px] uppercase tracking-wider">{template.category || 'Template'}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{template.description}</p>
                  </div>

                  <div className="mt-4 pt-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
                    <span>Template</span>
                    <span className="font-semibold text-primary opacity-0 group-hover:opacity-100 transition-opacity">Use Template →</span>
                  </div>
                </Link>
              ))}
            </>
          )}
        </div>
        </div>
      )}

      {/* Submissions Section */}
      <div className="space-y-4 pt-4 border-t border-border">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <h2 className="text-sm font-semibold text-foreground tracking-tight">Recent Forms</h2>
          <Link href="/forms" className={buttonVariants({ variant: 'outline', size: 'sm', className: 'h-9' })}>
            View All Forms
          </Link>
        </div>

        {/* High-density Table */}
        <div className="rounded-xl border border-border overflow-hidden">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>Form Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Responses</TableHead>
                <TableHead>Last Modified</TableHead>
                <TableHead className="text-right">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {formsLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={`skeleton-${i}`}>
                    <TableCell><Skeleton className="h-4 w-[200px]" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-[80px]" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-[40px]" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-[100px]" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-4 w-[80px] ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : forms.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No forms found. Create your first form above!</TableCell>
                </TableRow>
              ) : (
                forms.map((form: any) => {
                  const isPublished = form.status === 'PUBLISHED';
                  const timeAgo = form.updatedAt ? formatDistanceToNow(new Date(form.updatedAt), { addSuffix: true }) : '—';
                  const createdStr = form.createdAt ? format(new Date(form.createdAt), 'MMM dd, yyyy') : '—';
                  
                  return (
                    <TableRow key={form.id} className="group hover:bg-muted/50 transition-colors">
                      <TableCell className="font-medium">
                        <Link href={`/forms/${form.id}`} className="flex items-center gap-3 hover:underline">
                          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary transition-colors">
                            <MessageSquare size={14} />
                          </div>
                          <span>{form.title}</span>
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`font-normal text-xs ${isPublished ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' : 'bg-muted text-muted-foreground'}`}>
                          {form.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{form._count?.submissions ?? form.responseCount ?? 0}</TableCell>
                      <TableCell className="text-muted-foreground">{timeAgo}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{createdStr}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
          {!formsLoading && forms.length > 0 && (
            <div className="p-4 border-t border-border">
              {(() => {
                const totalItems = formsData?.pagination?.total ?? forms.length;
                const totalPages = Math.ceil(totalItems / 5);
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
    </div>
  );
}
