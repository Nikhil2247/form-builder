'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Plus,
  Search,
  FileBox,
  LayoutGrid,
  List,
  MoreHorizontal,
  Edit,
  Copy,
  Trash2,
  Eye,
  BarChart2,
  Clock,
  Inbox,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useForms, useCreateForm, useDeleteForm, useCloneForm, type Form } from '@/hooks/use-forms';
import { formatDistanceToNow } from 'date-fns';
import { DataTablePagination } from '@/components/ui/data-table-pagination';

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  PUBLISHED: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  CLOSED: 'bg-slate-500/10 text-slate-500 border-slate-500/20',
  ARCHIVED: 'bg-slate-400/10 text-slate-400 border-slate-400/20',
};

export default function FormsListPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [page, setPage] = useState(1);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newFormTitle, setNewFormTitle] = useState('');
  const [newFormDesc, setNewFormDesc] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Form | null>(null);

  const { data, isLoading } = useForms(statusFilter === 'ALL' ? undefined : statusFilter);
  const createForm = useCreateForm();
  const deleteForm = useDeleteForm();
  const cloneForm = useCloneForm();

  const forms: Form[] = data?.forms ?? [];
  const filtered = forms.filter((f) => f.title.toLowerCase().includes(search.toLowerCase()));
  const total = filtered.length;
  const paginatedForms = filtered.slice((page - 1) * 20, page * 20);

  async function handleCreate() {
    if (!newFormTitle.trim()) return;
    const created = await createForm.mutateAsync({ title: newFormTitle, description: newFormDesc });
    setIsCreateOpen(false);
    setNewFormTitle('');
    setNewFormDesc('');
    router.push(`/forms/builder?id=${created.id}`);
  }

  return (
    <div className="w-full space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">My Forms</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isLoading ? 'Loading...' : `${forms.length} form${forms.length !== 1 ? 's' : ''} in your organization`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button className="gap-2" onClick={() => setIsCreateOpen(true)}>
            <Plus size={16} /> Create Form
          </Button>
          <Link href="/templates">
            <Button variant="outline" size="sm" className="gap-2">
              <FileBox size={15} /> Browse Templates
            </Button>
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search forms..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="h-9 pl-9 w-52 text-sm bg-muted/40" />
          </div>
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v ?? 'ALL'); setPage(1); }}>
            <SelectTrigger className="h-9 w-36 text-sm bg-muted/40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Status</SelectItem>
              <SelectItem value="DRAFT">Draft</SelectItem>
              <SelectItem value="PUBLISHED">Published</SelectItem>
              <SelectItem value="CLOSED">Closed</SelectItem>
              <SelectItem value="ARCHIVED">Archived</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border p-1">
          <button onClick={() => setViewMode('grid')} className={`rounded-md p-1.5 transition-colors ${viewMode === 'grid' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'}`}><LayoutGrid size={15} /></button>
          <button onClick={() => setViewMode('list')} className={`rounded-md p-1.5 transition-colors ${viewMode === 'list' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'}`}><List size={15} /></button>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className={viewMode === 'grid' ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4' : 'space-y-3'}>
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-20 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted"><FileBox size={24} className="text-muted-foreground" /></div>
          <h3 className="text-base font-semibold">No forms found</h3>
          <p className="mt-1 text-sm text-muted-foreground">{search ? 'Try adjusting your search.' : 'Create your first form to get started.'}</p>
          {!search && <Button className="mt-4 gap-2" onClick={() => setIsCreateOpen(true)}><Plus size={15} />Create Form</Button>}
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          <button onClick={() => setIsCreateOpen(true)} className="group flex min-h-[160px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card p-6 text-center transition-all hover:border-primary hover:bg-primary/5 hover:-translate-y-0.5 shadow-sm">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary transition-all group-hover:bg-primary group-hover:text-primary-foreground group-hover:scale-110"><Plus size={20} /></div>
            <span className="text-sm font-semibold">New Form</span>
            <span className="mt-1 text-xs text-muted-foreground">Create from scratch</span>
          </button>
          {filtered.map((form) => (
            <FormCard key={form.id} form={form} onDelete={() => setDeleteTarget(form)} onClone={() => cloneForm.mutate(form.id)} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Form Name</th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Responses</th>
                <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Last Updated</th>
                <th className="px-4 py-3 text-right font-semibold text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-card">
              {paginatedForms.map((form) => (
                <FormRow key={form.id} form={form} onDelete={() => setDeleteTarget(form)} onClone={() => cloneForm.mutate(form.id)} />
              ))}
            </tbody>
          </table>
          <DataTablePagination
            page={page}
            total={total}
            pageSize={20}
            onPageChange={setPage}
          />
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Form</DialogTitle>
            <DialogDescription>Give your form a name to get started in the builder.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Form Title</label>
              <Input placeholder="e.g. Customer Feedback Survey" value={newFormTitle} onChange={(e) => setNewFormTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleCreate()} autoFocus />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Description (optional)</label>
              <Input placeholder="Brief description..." value={newFormDesc} onChange={(e) => setNewFormDesc(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!newFormTitle.trim() || createForm.isPending}>
              {createForm.isPending ? 'Creating...' : 'Create & Open Builder'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Form</DialogTitle>
            <DialogDescription>Are you sure you want to delete &quot;{deleteTarget?.title}&quot;? It will be moved to trash.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={async () => { if (deleteTarget) { await deleteForm.mutateAsync(deleteTarget.id); setDeleteTarget(null); } }} disabled={deleteForm.isPending}>
              {deleteForm.isPending ? 'Deleting...' : 'Delete Form'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FormCard({ form, onDelete, onClone }: { form: Form; onDelete: () => void; onClone: () => void }) {
  const router = useRouter();
  const timeAgo = formatDistanceToNow(new Date(form.updatedAt), { addSuffix: true });
  return (
    <Card className="group relative flex flex-col justify-between overflow-hidden rounded-xl border border-border bg-card p-5 shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 min-h-[160px]">
      <div>
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><FileBox size={16} /></div>
          <div className="flex items-center gap-1.5">
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${STATUS_COLORS[form.status] ?? ''}`}>{form.status}</span>
            <DropdownMenu>
              <DropdownMenuTrigger className="rounded-md p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-accent hover:text-foreground transition-all">
                <MoreHorizontal size={15} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => router.push(`/forms/builder?id=${form.id}`)}><Edit size={14} className="mr-2" />Edit</DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push(`/forms/${form.id}`)}><Eye size={14} className="mr-2" />View Responses</DropdownMenuItem>
                <DropdownMenuItem onClick={onClone}><Copy size={14} className="mr-2" />Clone</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive focus:bg-destructive/10"><Trash2 size={14} className="mr-2" />Delete</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <h3 className="mt-2 text-sm font-semibold text-foreground line-clamp-2">{form.title}</h3>
        {form.description && <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{form.description}</p>}
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><Inbox size={11} />{form._count?.submissions ?? form.totalSubmissions ?? form.responseCount ?? 0} responses</span>
        <span className="flex items-center gap-1"><Clock size={11} />{timeAgo}</span>
      </div>
    </Card>
  );
}

function FormRow({ form, onDelete, onClone }: { form: Form; onDelete: () => void; onClone: () => void }) {
  const router = useRouter();
  const timeAgo = formatDistanceToNow(new Date(form.updatedAt), { addSuffix: true });
  return (
    <tr className="group transition-colors hover:bg-muted/30">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><FileBox size={14} /></div>
          <div>
            <Link href={`/forms/${form.id}`} className="font-medium text-foreground hover:text-primary transition-colors">{form.title}</Link>
            {form.description && <p className="text-xs text-muted-foreground truncate max-w-xs">{form.description}</p>}
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${STATUS_COLORS[form.status] ?? ''}`}>{form.status}</span>
      </td>
      <td className="px-4 py-3 text-muted-foreground">{form._count?.submissions ?? form.totalSubmissions ?? form.responseCount ?? 0}</td>
      <td className="px-4 py-3 text-muted-foreground">{timeAgo}</td>
      <td className="px-4 py-3 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
            <MoreHorizontal size={15} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => router.push(`/forms/builder?id=${form.id}`)}><Edit size={14} className="mr-2" />Edit in Builder</DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push(`/forms/${form.id}`)}><Eye size={14} className="mr-2" />View Responses</DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push(`/analytics?formId=${form.id}`)}><BarChart2 size={14} className="mr-2" />Analytics</DropdownMenuItem>
            <DropdownMenuItem onClick={onClone}><Copy size={14} className="mr-2" />Clone Form</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive focus:bg-destructive/10"><Trash2 size={14} className="mr-2" />Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}
