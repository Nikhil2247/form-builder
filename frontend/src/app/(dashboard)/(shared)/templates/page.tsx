'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BookTemplate, Search, Layers, Star, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { useTemplates, useCreateFromTemplate } from '@/hooks/use-templates';
import { useUser } from '@/hooks/use-auth';

const CATEGORY_COLORS: Record<string, string> = {
  'Feedback': 'bg-blue-500/10 text-blue-600',
  'Registration': 'bg-emerald-500/10 text-emerald-600',
  'Survey': 'bg-purple-500/10 text-purple-600',
  'Support': 'bg-amber-500/10 text-amber-600',
  'HR': 'bg-sky-500/10 text-sky-600',
  'Marketing': 'bg-pink-500/10 text-pink-600',
};

export default function TemplatesPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [usingId, setUsingId] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const { data: session } = useUser();
  const orgRole = session?.activeOrganization?.role ?? 'VIEWER';
  const canBuild = orgRole === 'ADMIN' || orgRole === 'EDITOR';

  const { data: templatesRes, isLoading } = useTemplates(page, 20);
  const createFromTemplate = useCreateFromTemplate();

  const list = templatesRes?.templates ?? [];
  const total = templatesRes?.pagination?.total ?? list.length;
  
  const filtered = search ? list.filter(t =>
    (t.title || t.name || '').toLowerCase().includes(search.toLowerCase()) ||
    (t.description || '').toLowerCase().includes(search.toLowerCase()) ||
    (t.category || '').toLowerCase().includes(search.toLowerCase())
  ) : list;

  async function handleUseTemplate(templateId: string) {
    setUsingId(templateId);
    try {
      const newForm = await createFromTemplate.mutateAsync(templateId);
      router.push(`/forms/builder?id=${newForm.id}`);
    } finally {
      setUsingId(null);
    }
  }

  return (
    <div className="w-full space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Templates</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Start with a pre-built template and customize it to your needs.
          </p>
        </div>
        {canBuild && (
          <Link href="/forms/builder">
            <Button variant="outline" size="sm" className="gap-2">
              <Layers size={14} /> Blank Form
            </Button>
          </Link>
        )}
      </div>

      {/* Search */}
      <div className="relative w-64">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search templates..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 pl-9 text-sm bg-muted/40"
        />
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-48 rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-20 text-center">
          <BookTemplate size={28} className="mb-3 text-muted-foreground" />
          <h3 className="text-sm font-semibold">No templates found</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {search ? 'Try a different search.' : 'No templates are available yet.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((template) => {
            const catColor = CATEGORY_COLORS[template.category ?? ''] ?? 'bg-muted text-muted-foreground';
            const isUsing = usingId === template.id;

            return (
              <Card key={template.id} className="group flex flex-col justify-between rounded-xl border border-border bg-card p-5 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 min-h-[180px]">
                <div>
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
                      <BookTemplate size={16} />
                    </div>
                    {template.category && (
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${catColor}`}>
                        {template.category}
                      </span>
                    )}
                  </div>
                  <h3 className="text-sm font-semibold text-foreground line-clamp-1">{template.title || template.name}</h3>
                  {template.description && (
                    <p className="mt-1 text-xs text-muted-foreground line-clamp-2 leading-relaxed">{template.description}</p>
                  )}
                  {template.usageCount !== undefined && (
                    <p className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Star size={10} className="text-amber-500" />
                      Used {template.usageCount.toLocaleString()} times
                    </p>
                  )}
                </div>

                {canBuild && (
                  <button
                    onClick={() => handleUseTemplate(template.id)}
                    disabled={isUsing}
                    className="mt-4 w-full rounded-lg border border-border bg-muted/40 py-2 text-xs font-semibold text-foreground transition-all hover:bg-primary hover:text-primary-foreground hover:border-primary group-hover:opacity-100 flex items-center justify-center gap-1.5"
                  >
                    {isUsing ? (
                      <><Loader2 size={12} className="animate-spin" />Creating...</>
                    ) : (
                      'Use Template →'
                    )}
                  </button>
                )}
              </Card>
            );
          })}
        </div>
      )}
      
      {!isLoading && list.length > 0 && (
        <div className="pt-4 border-t border-border">
          {(() => {
            const currentTotal = search ? filtered.length : total;
            const totalPages = Math.ceil(currentTotal / 20);
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
  );
}
