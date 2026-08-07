'use client';

import React, { useState } from 'react';
import { KeyRound, Plus, RefreshCw, Trash2, Webhook } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  PageHeader,
  PageShell,
  DataTable,
  StatusBadge,
  EmptyState,
  Toolbar,
  FilterSelect,
  Modal,
  ModalActions,
  ConfirmDialog,
  CopyField,
  RelativeTime,
  type DataTableColumn,
} from '@/components/shared';
import { RoleGuard } from '@/components/auth/RoleGuard';
import { useForms } from '@/hooks/use-forms';
import {
  useWebhooks,
  useCreateWebhook,
  useDeleteWebhook,
  useRotateWebhookSecret,
  useWebhookDeliveries,
  type Webhook as WebhookRecord,
} from '@/hooks/use-webhooks';

/**
 * Webhook management.
 *
 * Wrapped in its own guard: the route lives in the (editor) group, but the API
 * marks every webhook route `@RequiredRole('ADMIN')`. Without this an editor
 * reached the page and every request on it 403'd with no explanation.
 */
export default function IntegrationsPage() {
  return (
    <RoleGuard
      require="webhook:manage"
      forbiddenTitle="Webhooks are admin-only"
      forbiddenDescription="Webhooks can forward every response to an external URL, so managing them requires the Admin role."
    >
      <IntegrationsContent />
    </RoleGuard>
  );
}

function IntegrationsContent() {
  const [formId, setFormId] = useState('');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<WebhookRecord | null>(null);
  const [secretTarget, setSecretTarget] = useState<WebhookRecord | null>(null);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [deliveriesFor, setDeliveriesFor] = useState<WebhookRecord | null>(null);

  // Only published forms can fire webhooks, but drafts are still listed so a
  // hook can be configured ahead of launch.
  const forms = useForms({ page: 1, limit: 100, sort: 'updatedAt', direction: 'desc' });

  const webhooks = useWebhooks(formId || undefined);
  const createWebhook = useCreateWebhook(formId || undefined);
  const deleteWebhook = useDeleteWebhook(formId || undefined);
  const rotateSecret = useRotateWebhookSecret(formId || undefined);

  const formOptions = (forms.data?.forms ?? []).map((form) => ({
    value: form.id,
    label: form.title,
  }));

  const columns: DataTableColumn<WebhookRecord>[] = [
    {
      id: 'url',
      header: 'Endpoint',
      isRowHeader: true,
      className: 'max-w-0',
      cell: (hook) => (
        <div className="min-w-0">
          {hook.name && <div className="truncate font-medium">{hook.name}</div>}
          <div className="truncate font-mono text-xs text-muted-foreground">{hook.url}</div>
        </div>
      ),
    },
    {
      id: "trigger",
      header: "Fires on",
      hideBelow: "md",
      cell: () => (
        <span className="rounded border border-border bg-muted/50 px-1.5 py-0.5 text-xs">
          form.submitted
        </span>
      ),
    },
    {
      id: "status",
      header: 'Status',
      width: 'w-32',
      cell: (hook) => (
        <span
          title={
            hook.isActive
              ? undefined
              : 'Deactivated — the endpoint failed repeatedly or resolved to a blocked address.'
          }
        >
          <StatusBadge status={hook.isActive ? 'ACTIVE' : 'FAILED'} dot />
        </span>
      ),
    },
    {
      id: "deliveries",
      header: "Deliveries",
      numeric: true,
      width: "w-28",
      hideBelow: "lg",
      cell: (hook) => (hook._count?.deliveries ?? 0).toLocaleString(),
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      width: 'w-56',
      className: 'text-right',
      headerClassName: 'text-right',
      cell: (hook) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => setDeliveriesFor(hook)}>
            Deliveries
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Rotate signing secret"
            title="Rotate signing secret"
            onClick={() => setSecretTarget(hook)}
          >
            <RefreshCw className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Delete webhook"
            title="Delete webhook"
            onClick={() => setDeleteTarget(hook)}
            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <PageShell>
      <PageHeader
        title="Integrations"
        description="Forward responses to your own services over signed HTTPS webhooks."
        actions={
          <Button
            size="sm"
            className="gap-2"
            onClick={() => setIsCreateOpen(true)}
            disabled={!formId}
            title={!formId ? 'Choose a form first' : undefined}
          >
            <Plus className="size-4" /> Add webhook
          </Button>
        }
      />

      <Toolbar>
        <FilterSelect
          label="Form"
          value={formId}
          onChange={setFormId}
          options={formOptions}
          placeholder="Choose a form…"
          className="min-w-64"
        />
      </Toolbar>

      <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
        <p className="font-medium">How delivery works</p>
        <ul className="mt-2 space-y-1 text-muted-foreground">
          <li>
            Each request carries an <code className="font-mono text-xs">X-Signature</code> header of
            the form <code className="font-mono text-xs">t=&lt;timestamp&gt;,sha256=&lt;hmac&gt;</code>.
            Verify it against your signing secret and reject stale timestamps.
          </li>
          <li>
            Only public HTTPS endpoints are accepted. Loopback, private, link-local, and cloud
            metadata addresses are rejected at save time and re-checked on every delivery.
          </li>
          <li>Redirects are not followed. Repeated failures deactivate the webhook.</li>
        </ul>
      </div>

      {!formId ? (
        <EmptyState
          icon={Webhook}
          title="Choose a form"
          description="Webhooks are configured per form. Pick one above to see and manage its endpoints."
        />
      ) : (
        <DataTable
          caption="Webhooks for the selected form"
          columns={columns}
          data={webhooks.data}
          getRowId={(hook) => hook.id}
          isLoading={webhooks.isLoading}
          error={webhooks.error}
          onRetry={() => webhooks.refetch()}
          empty={
            <EmptyState
              variant="inline"
              icon={Webhook}
              title="No webhooks for this form"
              description="Add an endpoint to receive a signed POST whenever this form is submitted."
              action={
                <Button size="sm" className="gap-2" onClick={() => setIsCreateOpen(true)}>
                  <Plus className="size-4" /> Add webhook
                </Button>
              }
            />
          }
        />
      )}

      <CreateWebhookModal
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        isPending={createWebhook.isPending}
        onCreate={async (values) => {
          try {
            const created = await createWebhook.mutateAsync(values);
            setIsCreateOpen(false);
            // The secret is returned exactly once. Show it immediately or it is
            // gone — reads never include it.
            if (created?.secret) setRevealedSecret(created.secret);
            toast.success('Webhook created');
          } catch (err: any) {
            toast.error(err?.message ?? 'Could not create this webhook');
          }
        }}
      />

      <Modal
        open={!!revealedSecret}
        onOpenChange={(open) => !open && setRevealedSecret(null)}
        title="Save your signing secret"
        description="This is the only time it will be shown. Store it in your receiving service to verify signatures."
        footer={
          <Button size="sm" onClick={() => setRevealedSecret(null)}>
            I have saved it
          </Button>
        }
      >
        {revealedSecret && <CopyField value={revealedSecret} monospace />}
      </Modal>

      <ConfirmDialog
        open={!!secretTarget}
        onOpenChange={(open) => !open && setSecretTarget(null)}
        title="Rotate signing secret"
        description={
          <>
            A new secret is generated immediately and the old one stops working. Deliveries will
            fail signature verification until you update your receiving service.
          </>
        }
        confirmLabel="Rotate secret"
        variant="default"
        isPending={rotateSecret.isPending}
        onConfirm={async () => {
          if (!secretTarget) return;
          try {
            const result = await rotateSecret.mutateAsync(secretTarget.id);
            setSecretTarget(null);
            if (result?.secret) setRevealedSecret(result.secret);
          } catch (err: any) {
            toast.error(err?.message ?? 'Could not rotate the secret');
          }
        }}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete webhook"
        description={<>Deliveries to {deleteTarget?.url} will stop immediately.</>}
        confirmLabel="Delete webhook"
        isPending={deleteWebhook.isPending}
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await deleteWebhook.mutateAsync(deleteTarget.id);
            toast.success('Webhook deleted');
            setDeleteTarget(null);
          } catch (err: any) {
            toast.error(err?.message ?? 'Could not delete this webhook');
          }
        }}
      />

      <DeliveriesModal
        formId={formId}
        webhook={deliveriesFor}
        onOpenChange={(open) => !open && setDeliveriesFor(null)}
      />
    </PageShell>
  );
}

function CreateWebhookModal({
  open,
  onOpenChange,
  onCreate,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (values: { url: string; name?: string }) => void;
  isPending: boolean;
}) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');

  React.useEffect(() => {
    if (open) {
      setUrl('');
      setName('');
    }
  }, [open]);

  // Mirror the API's rule so the user is told before the round-trip, not after.
  const urlError = (() => {
    if (!url.trim()) return null;
    try {
      const parsed = new URL(url.trim());
      if (parsed.protocol !== 'https:') return 'The endpoint must use HTTPS.';
      if (parsed.username || parsed.password) return 'The URL must not contain credentials.';
      return null;
    } catch {
      return 'Enter a full URL, including https://';
    }
  })();

  const valid = url.trim().length > 0 && !urlError;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Add a webhook"
      description="We will POST a signed JSON payload to this endpoint."
      footer={
        <ModalActions
          onCancel={() => onOpenChange(false)}
          confirmLabel="Create webhook"
          onConfirm={() => onCreate({ url: url.trim(), name: name.trim() || undefined })}
          isPending={isPending}
          disabled={!valid}
        />
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="webhook-url">Endpoint URL</Label>
          <Input
            id="webhook-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://api.example.com/hooks/forms"
            autoFocus
            aria-invalid={!!urlError}
            aria-describedby={urlError ? 'webhook-url-error' : undefined}
          />
          {urlError && (
            <p id="webhook-url-error" className="text-xs text-destructive">
              {urlError}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="webhook-name">Label (optional)</Label>
          <Input
            id="webhook-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Slack notifications"
          />
        </div>

        {/* No event picker: FormWebhook has no per-hook event selection — every
            webhook fires on submission. The previous checkbox group offered
            four events and discarded the choice, because the API never accepted
            an `events` field. */}
        <p className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          This endpoint receives a POST for every response submitted to this form.
        </p>
      </div>
    </Modal>
  );
}

function DeliveriesModal({
  formId,
  webhook,
  onOpenChange,
}: {
  formId: string;
  webhook: WebhookRecord | null;
  onOpenChange: (open: boolean) => void;
}) {
  const deliveries = useWebhookDeliveries(formId || undefined, webhook?.id);

  const columns: DataTableColumn<NonNullable<typeof deliveries.data>[number]>[] = [
    {
      id: 'deliveredAt',
      header: 'When',
      width: 'w-40',
      isRowHeader: true,
      cell: (delivery) => <RelativeTime value={delivery.deliveredAt} />,
    },
    {
      id: 'result',
      header: 'Result',
      width: 'w-36',
      cell: (delivery) => (
        <StatusBadge
          status={delivery.success ? 'SUCCESS' : 'FAILED'}
          // A null status code means the request never completed — DNS failure,
          // timeout, or a destination the SSRF guard rejected at delivery time.
          label={
            delivery.statusCode
              ? `${delivery.success ? 'Delivered' : 'Failed'} ${delivery.statusCode}`
              : 'No response'
          }
          dot
        />
      ),
    },
    {
      id: 'attempt',
      header: 'Attempt',
      numeric: true,
      width: 'w-24',
      hideBelow: 'sm',
      cell: (delivery) => delivery.attempt,
    },
    {
      id: 'responseBody',
      header: 'Response',
      className: 'max-w-0',
      cell: (delivery) => (
        <span
          className="block truncate font-mono text-xs text-muted-foreground"
          title={delivery.responseBody ?? ''}
        >
          {delivery.responseBody || '—'}
        </span>
      ),
    },
  ];

  return (
    <Modal
      open={!!webhook}
      onOpenChange={onOpenChange}
      size="lg"
      padded={false}
      title="Recent deliveries"
      description={webhook?.url}
      footer={
        <Button size="sm" onClick={() => onOpenChange(false)}>
          Close
        </Button>
      }
    >
      <DataTable
        caption="Webhook delivery history"
        columns={columns}
        data={deliveries.data}
        getRowId={(delivery) => delivery.id}
        isLoading={deliveries.isLoading}
        error={deliveries.error}
        onRetry={() => deliveries.refetch()}
        skeletonRows={5}
        className="rounded-none border-0 shadow-none"
        empty={
          <EmptyState
            variant="inline"
            icon={KeyRound}
            title="No deliveries yet"
            description="Delivery attempts appear here once this form receives a response."
          />
        }
      />
    </Modal>
  );
}
