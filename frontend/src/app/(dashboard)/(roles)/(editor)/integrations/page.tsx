'use client';

import React, { useState } from 'react';
import { AlertTriangle, KeyRound, Plus, RefreshCw, Trash2, Webhook } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
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
import {
  useApiKeys,
  useCreateApiKey,
  useRevokeApiKey,
  API_KEY_SCOPES,
  API_KEY_SCOPE_LABELS,
  type ApiKey,
  type ApiKeyScope,
} from '@/hooks/use-api-keys';

/**
 * Outbound and inbound integrations: webhooks we push, API keys others pull
 * with.
 *
 * Wrapped in its own guard: the route lives in the (editor) group, but the API
 * marks every webhook route AND every API-key route `@RequiredRole('ADMIN')`.
 * Without this an editor reached the page and every request on it 403'd with no
 * explanation.
 *
 * Both sections gate on `webhook:manage` rather than a second permission. They
 * are the same authority — an ADMIN-only capability to move every response in
 * the organization to somewhere outside it — and splitting them would let the
 * page render with half its content silently 403-ing.
 */
export default function IntegrationsPage() {
  return (
    <RoleGuard
      require="webhook:manage"
      forbiddenTitle="Integrations are admin-only"
      forbiddenDescription="Webhooks and API keys can both move every response in this organization to an external system, so managing them requires the Admin role."
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

  const [isCreateKeyOpen, setIsCreateKeyOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<ApiKey | null>(null);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);

  // Only published forms can fire webhooks, but drafts are still listed so a
  // hook can be configured ahead of launch.
  const forms = useForms({ page: 1, limit: 100, sort: 'updatedAt', direction: 'desc' });

  const webhooks = useWebhooks(formId || undefined);
  const createWebhook = useCreateWebhook(formId || undefined);
  const deleteWebhook = useDeleteWebhook(formId || undefined);
  const rotateSecret = useRotateWebhookSecret(formId || undefined);

  // API keys are org-scoped, not form-scoped — no dependency on the form
  // selector above, and the list loads on mount rather than waiting for a
  // choice the user has no reason to make for this section.
  const apiKeys = useApiKeys();
  const createApiKey = useCreateApiKey();
  const revokeApiKey = useRevokeApiKey();

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
      hideBelow: 'sm',
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

  const keyColumns: DataTableColumn<ApiKey>[] = [
    {
      id: 'name',
      header: 'Key',
      isRowHeader: true,
      className: 'max-w-0',
      cell: (key) => (
        // Revoked keys stay in the list for the audit trail, so they need to
        // read as inert at a glance rather than only via the status column.
        <div className={key.revokedAt ? 'min-w-0 opacity-60' : 'min-w-0'}>
          <div className="truncate font-medium">{key.name}</div>
          {/* The fingerprint is 8 hex characters of the key's SHA-256, not the
              tail of the key itself — the plaintext is never stored, so there
              is no suffix to show. It exists to tell two keys apart. */}
          <div
            className="truncate font-mono text-xs text-muted-foreground"
            title="First 8 characters of this key's SHA-256 hash"
          >
            {key.fingerprint}…
          </div>
        </div>
      ),
    },
    {
      id: 'scopes',
      header: 'Scopes',
      hideBelow: 'md',
      cell: (key) => (
        <div className="flex flex-wrap gap-1">
          {key.scopes.map((scope) => (
            <span
              key={scope}
              className="rounded border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-xs"
            >
              {scope}
            </span>
          ))}
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      width: 'w-32',
      cell: (key) => {
        const status = keyStatus(key);
        return (
          <span title={KEY_STATUS_HINTS[status]}>
            <StatusBadge status={status} dot />
          </span>
        );
      },
    },
    {
      id: 'lastUsedAt',
      header: 'Last used',
      width: 'w-36',
      hideBelow: 'lg',
      // Accurate to within a minute by design — the API throttles the write so
      // that authenticating a read does not become a database write.
      cell: (key) => <RelativeTime value={key.lastUsedAt} fallback="Never used" />,
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      width: 'w-24',
      className: 'text-right',
      headerClassName: 'text-right',
      cell: (key) => (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Revoke ${key.name}`}
            title={key.revokedAt ? 'Already revoked' : 'Revoke key'}
            disabled={!!key.revokedAt}
            onClick={() => setRevokeTarget(key)}
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
        description="Push responses to your own services over signed HTTPS webhooks, or let them pull with an API key."
      />

      <SectionHeader
        title="Webhooks"
        description="We POST a signed JSON payload to your endpoint whenever the selected form is submitted."
        action={
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

      <SectionHeader
        title="API keys"
        description="Machine-to-machine credentials for pulling forms and responses out of this organization."
        action={
          <Button size="sm" className="gap-2" onClick={() => setIsCreateKeyOpen(true)}>
            <Plus className="size-4" /> Create API key
          </Button>
        }
      />

      <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
        <p className="font-medium">How keys work</p>
        <ul className="mt-2 space-y-1 text-muted-foreground">
          <li>
            Send the key in an <code className="font-mono text-xs">X-API-Key</code> header. It works
            only on this organization&apos;s routes — a key for one organization cannot read
            another&apos;s.
          </li>
          <li>
            A key can do only what its scopes allow, and never more than the member who created it.
            Removing that member from the organization stops their keys working.
          </li>
          <li>
            Keys are read-only credentials: they cannot create, edit, or delete anything, and they
            cannot manage keys or webhooks.
          </li>
          <li>Revoking is immediate and permanent. Revoked keys stay listed for the audit trail.</li>
        </ul>
      </div>

      <DataTable
        caption="API keys for this organization"
        columns={keyColumns}
        data={apiKeys.data}
        getRowId={(key) => key.id}
        isLoading={apiKeys.isLoading}
        error={apiKeys.error}
        onRetry={() => apiKeys.refetch()}
        empty={
          <EmptyState
            variant="inline"
            icon={KeyRound}
            title="No API keys yet"
            description="Create a key to let a script, a CLI, or an integration read this organization's forms and responses."
            action={
              <Button size="sm" className="gap-2" onClick={() => setIsCreateKeyOpen(true)}>
                <Plus className="size-4" /> Create API key
              </Button>
            }
          />
        }
      />

      <CreateApiKeyModal
        open={isCreateKeyOpen}
        onOpenChange={setIsCreateKeyOpen}
        isPending={createApiKey.isPending}
        onCreate={async (values) => {
          try {
            const created = await createApiKey.mutateAsync(values);
            setIsCreateKeyOpen(false);
            // The raw key exists in this response and nowhere else, ever. If it
            // is not shown now it is unrecoverable and the user has to create
            // another one.
            setRevealedKey(created.key);
          } catch {
            // Reported globally; the dialog stays open with the name typed.
          }
        }}
      />

      <RevealApiKeyModal value={revealedKey} onDismiss={() => setRevealedKey(null)} />

      <ConfirmDialog
        open={!!revokeTarget}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        title="Revoke API key"
        description={
          <>
            Anything still using <strong>{revokeTarget?.name}</strong> stops working immediately and
            this cannot be undone — a revoked key can never be reactivated. The key stays in the list,
            greyed out, so you can still see what it was scoped to and when it was last used.
          </>
        }
        confirmLabel="Revoke key"
        // Typing the name is the brake. Unlike a webhook, a revoked key cannot
        // be recreated: whatever is holding the old secret has to be found and
        // given a new one, which may be a deployment somebody else owns.
        confirmText={revokeTarget?.name}
        isPending={revokeApiKey.isPending}
        onConfirm={async () => {
          if (!revokeTarget) return;
          try {
            await revokeApiKey.mutateAsync(revokeTarget.id);
            toast.success('API key revoked');
            setRevokeTarget(null);
          } catch {
            // Reported globally; the confirm dialog stays open.
          }
        }}
      />

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
          } catch {
            // Reported globally; the dialog stays open with the URL typed.
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
          } catch {
            // Reported globally; the confirm dialog stays open.
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
          } catch {
            // Reported globally.
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

/**
 * A heading for one integration type.
 *
 * The page has two independent sections now, so the create action can no longer
 * live in the PageHeader — a single button up there would have to mean "add
 * webhook" or "create key" and could only ever mean one of them.
 */
function SectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3">
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

/**
 * Which of the three states a key is in.
 *
 * Expiry is derived on the client because the API returns the timestamp, not a
 * verdict — and a key that lapsed a second ago must read as EXPIRED without
 * waiting for a refetch. REVOKED wins over EXPIRED: it is the deliberate act
 * and the one an admin is looking for.
 */
function keyStatus(key: ApiKey): 'REVOKED' | 'EXPIRED' | 'ACTIVE' {
  if (key.revokedAt) return 'REVOKED';
  if (key.expiresAt && new Date(key.expiresAt).getTime() <= Date.now()) return 'EXPIRED';
  return 'ACTIVE';
}

const KEY_STATUS_HINTS: Record<ReturnType<typeof keyStatus>, string> = {
  ACTIVE: 'This key authenticates requests.',
  EXPIRED: 'Past its expiry date — requests using it are rejected.',
  REVOKED: 'Revoked. Kept in the list so the audit trail survives.',
};

function CreateApiKeyModal({
  open,
  onOpenChange,
  onCreate,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (values: { name: string; scopes: string[]; expiresAt?: string | null }) => void;
  isPending: boolean;
}) {
  const [name, setName] = useState('');
  // Read-only by default, matching the API's column default. A credential that
  // lives in someone else's CI for a year should start with the least it can do.
  const [scopes, setScopes] = useState<ApiKeyScope[]>(['forms:read', 'submissions:read']);
  const [expiresAt, setExpiresAt] = useState('');

  React.useEffect(() => {
    if (open) {
      setName('');
      setScopes(['forms:read', 'submissions:read']);
      setExpiresAt('');
    }
  }, [open]);

  // Mirror the API's rules so the user is told before the round-trip. The API
  // re-checks both; this only saves a rejected request.
  const expiryError = (() => {
    if (!expiresAt) return null;
    const when = new Date(expiresAt);
    if (Number.isNaN(when.getTime())) return 'Enter a valid date.';
    if (when.getTime() <= Date.now()) return 'The expiry date must be in the future.';
    return null;
  })();

  const valid = name.trim().length > 0 && scopes.length > 0 && !expiryError;

  const toggleScope = (scope: ApiKeyScope, checked: boolean) =>
    setScopes((current) =>
      checked ? [...current, scope] : current.filter((held) => held !== scope),
    );

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Create an API key"
      description="The key is shown once, immediately after it is created."
      footer={
        <ModalActions
          onCancel={() => onOpenChange(false)}
          confirmLabel="Create key"
          onConfirm={() =>
            onCreate({
              name: name.trim(),
              scopes,
              // An empty input means "never expires", which the API expresses
              // as null rather than as a missing field.
              expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
            })
          }
          isPending={isPending}
          disabled={!valid}
        />
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="api-key-name">Label</Label>
          <Input
            id="api-key-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nightly export script"
            maxLength={100}
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            Name it after what will hold it. It is the only way to tell keys apart later.
          </p>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-foreground">Scopes</legend>
          <p className="text-xs text-muted-foreground">
            Grant the least this key needs. Scopes cannot be changed afterwards — a key that needs
            more is a new key.
          </p>
          <div className="space-y-2 pt-1">
            {API_KEY_SCOPES.map((scope) => (
              <label
                key={scope}
                htmlFor={`scope-${scope}`}
                className="flex cursor-pointer items-start gap-2.5 text-sm"
              >
                <Checkbox
                  id={`scope-${scope}`}
                  checked={scopes.includes(scope)}
                  onCheckedChange={(checked) => toggleScope(scope, checked === true)}
                  className="mt-0.5"
                />
                <span className="min-w-0">
                  <span className="font-mono text-xs">{scope}</span>
                  <span className="block text-xs text-muted-foreground">
                    {API_KEY_SCOPE_LABELS[scope]}
                  </span>
                </span>
              </label>
            ))}
          </div>
          {scopes.length === 0 && (
            <p className="text-xs text-destructive">Choose at least one scope.</p>
          )}
        </fieldset>

        <div className="space-y-1.5">
          <Label htmlFor="api-key-expiry">Expires (optional)</Label>
          <Input
            id="api-key-expiry"
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            aria-invalid={!!expiryError}
            aria-describedby={expiryError ? 'api-key-expiry-error' : undefined}
          />
          {expiryError ? (
            <p id="api-key-expiry-error" className="text-xs text-destructive">
              {expiryError}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Leave empty for a key that never expires.
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}

/**
 * The one-time reveal.
 *
 * Everything here exists to stop the user closing this dialog without the key.
 * It cannot be dismissed by clicking away or pressing Escape, the confirm
 * button says what it is confirming, and the warning states the consequence in
 * full rather than the usual "make sure to save this" — because the consequence
 * is not "you will be inconvenienced", it is "this key is gone and you must
 * create another one".
 */
function RevealApiKeyModal({
  value,
  onDismiss,
}: {
  value: string | null;
  onDismiss: () => void;
}) {
  return (
    <Modal
      open={!!value}
      // Only the explicit button closes this. `onOpenChange` fires for the
      // overlay click and for Escape too, and losing an unrecoverable secret to
      // a stray click is exactly the accident worth designing out.
      onOpenChange={() => {}}
      showCloseButton={false}
      title="Copy your API key now"
      description="This is the only time it will ever be shown."
      footer={
        <Button size="sm" onClick={onDismiss}>
          I have copied it
        </Button>
      }
    >
      <div className="space-y-3">
        <div className="flex items-start gap-2.5 rounded-md border border-warning/25 bg-warning/10 p-3 text-xs text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>
            We store only a hash of this key, so we cannot show it again — not on this page, not
            through the API, not to support. Close this dialog without copying it and the key is
            unusable; you will have to create a new one and revoke this.
          </p>
        </div>

        {value && <CopyField value={value} monospace />}

        <p className="text-xs text-muted-foreground">
          Put it somewhere your integration reads it from — a secret manager or a CI secret. Treat it
          like a password: anyone holding it can read this organization&apos;s responses.
        </p>
      </div>
    </Modal>
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
