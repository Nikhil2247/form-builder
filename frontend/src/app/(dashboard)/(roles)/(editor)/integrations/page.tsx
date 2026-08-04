'use client';

import React, { useState } from 'react';
import { Plus, Webhook, Trash2, Check, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useWebhooks, useCreateWebhook, useDeleteWebhook, WEBHOOK_EVENTS } from '@/hooks/use-webhooks';
import { useForms } from '@/hooks/use-forms';
import { formatDistanceToNow } from 'date-fns';

export default function IntegrationsPage() {
  const [selectedFormId, setSelectedFormId] = useState<string>('');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [newName, setNewName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const { data: formsData } = useForms();
  const forms = formsData?.forms ?? [];

  const { data: webhooks, isLoading } = useWebhooks(selectedFormId || undefined);
  const createWebhook = useCreateWebhook(selectedFormId || undefined);
  const deleteWebhook = useDeleteWebhook(selectedFormId || undefined);

  const list = webhooks ?? [];

  async function handleCreate() {
    if (!newUrl.trim() || !selectedFormId) return;
    await createWebhook.mutateAsync({ url: newUrl, name: newName || 'Webhook' });
    setIsCreateOpen(false);
    setNewUrl('');
    setNewName('');
  }

  return (
    <div className="w-full space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Integrations</h1>
          <p className="mt-1 text-sm text-muted-foreground">Connect your forms to external services via webhooks.</p>
        </div>
        <Button className="gap-2" onClick={() => setIsCreateOpen(true)} disabled={!selectedFormId}>
          <Plus size={15} /> Add Webhook
        </Button>
      </div>

      {/* Form selector */}
      <div className="flex items-center gap-3">
        <Filter size={15} className="text-muted-foreground shrink-0" />
        <Select value={selectedFormId} onValueChange={setSelectedFormId}>
          <SelectTrigger className="w-72 bg-muted/40 h-9">
            <SelectValue placeholder="Select a form to manage webhooks..." />
          </SelectTrigger>
          <SelectContent>
            {forms.map((f: any) => (
              <SelectItem key={f.id} value={f.id}>{f.title}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedFormId && (
          <span className="text-xs text-muted-foreground">
            {isLoading ? 'Loading...' : `${list.length} webhook${list.length !== 1 ? 's' : ''}`}
          </span>
        )}
      </div>

      {/* Webhook info banner */}
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 flex items-start gap-3">
        <Webhook size={18} className="text-primary mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-medium text-foreground">How webhooks work</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Webhooks are per-form. Select a form above and we&apos;ll send a POST request to your endpoint whenever that form receives a submission.
          </p>
        </div>
      </div>

      {/* No form selected */}
      {!selectedFormId ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-16 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Webhook size={22} className="text-muted-foreground" />
          </div>
          <h3 className="text-sm font-semibold">Select a form to get started</h3>
          <p className="mt-1 text-xs text-muted-foreground">Webhooks are scoped per form. Choose a form from the dropdown above.</p>
        </div>
      ) : isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-16 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Webhook size={22} className="text-muted-foreground" />
          </div>
          <h3 className="text-sm font-semibold">No webhooks configured</h3>
          <p className="mt-1 text-xs text-muted-foreground">Add a webhook to receive real-time events for this form.</p>
          <Button className="mt-4 gap-2" size="sm" onClick={() => setIsCreateOpen(true)}>
            <Plus size={13} /> Add First Webhook
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((webhook) => (
            <WebhookCard
              key={webhook.id}
              webhook={webhook}
              onDelete={() => setDeleteTarget(webhook.id)}
            />
          ))}
        </div>
      )}

      {/* Create Webhook Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Webhook</DialogTitle>
            <DialogDescription>Configure a webhook endpoint to receive submission events for the selected form.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Webhook Name (optional)</label>
              <Input
                placeholder="e.g. Slack Notifications"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Endpoint URL</label>
              <Input
                placeholder="https://your-server.com/webhook"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                type="url"
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!newUrl.trim() || createWebhook.isPending}>
              {createWebhook.isPending ? 'Creating...' : 'Create Webhook'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Webhook</DialogTitle>
            <DialogDescription>This will permanently delete the webhook and stop sending events to this endpoint.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={async () => {
              if (deleteTarget) { await deleteWebhook.mutateAsync(deleteTarget); setDeleteTarget(null); }
            }} disabled={deleteWebhook.isPending}>
              {deleteWebhook.isPending ? 'Deleting...' : 'Delete Webhook'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function WebhookCard({ webhook, onDelete }: { webhook: any; onDelete: () => void }) {
  const updatedAgo = webhook.updatedAt ? formatDistanceToNow(new Date(webhook.updatedAt), { addSuffix: true }) : '—';
  return (
    <Card className="rounded-xl border border-border bg-card p-4 space-y-3 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${webhook.isActive ? 'bg-emerald-500/10 text-emerald-600' : 'bg-muted text-muted-foreground'}`}>
            <Webhook size={15} />
          </div>
          <div className="min-w-0">
            {webhook.name && <p className="text-xs font-semibold text-muted-foreground mb-0.5">{webhook.name}</p>}
            <p className="text-sm font-medium text-foreground truncate font-mono">{webhook.url}</p>
            <p className="text-xs text-muted-foreground">Updated {updatedAgo}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${webhook.isActive ? 'bg-emerald-500/10 text-emerald-600' : 'bg-muted text-muted-foreground'}`}>
            {webhook.isActive ? 'Active' : 'Inactive'}
          </span>
          <button onClick={onDelete} className="rounded-md p-1.5 text-muted-foreground hover:bg-red-100 hover:text-red-500 transition-colors">
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </Card>
  );
}
