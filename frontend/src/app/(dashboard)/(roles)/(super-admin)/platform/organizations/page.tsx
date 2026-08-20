'use client';

import React, { useState } from 'react';
import {
  Building2,
  MoreHorizontal,
  Pencil,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  PageHeader,
  PageShell,
  DataTable,
  StatusBadge,
  EmptyState,
  Toolbar,
  SearchInput,
  Modal,
  ModalActions,
  ConfirmDialog,
  RelativeTime,
  type DataTableColumn,
} from '@/components/shared';
import { formatBytes } from '@/components/shared/formatters';
import { usePagination } from '@/hooks/use-pagination';
import {
  useAdminOrganizations,
  useSuspendOrganization,
  useActivateOrganization,
  useCreateOrganization,
  useUpdateOrganization,
  useDeleteOrganization,
  type AdminOrganization,
} from '@/hooks/use-admin';

export default function PlatformOrganizationsPage() {
  const pager = usePagination();
  const { data, isLoading, isFetching, error, refetch } = useAdminOrganizations({
    page: pager.page,
    limit: pager.pageSize,
    search: pager.search,
  });

  const suspendOrg = useSuspendOrganization();
  const activateOrg = useActivateOrganization();
  const createOrg = useCreateOrganization();
  const updateOrg = useUpdateOrganization();
  const deleteOrg = useDeleteOrganization();

  const [suspendTarget, setSuspendTarget] = useState<AdminOrganization | null>(null);
  const [activateTarget, setActivateTarget] = useState<AdminOrganization | null>(null);
  const [creating, setCreating] = useState(false);
  const [editTarget, setEditTarget] = useState<AdminOrganization | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminOrganization | null>(null);

  const orgs = data?.items ?? [];
  const total = data?.pagination.total ?? 0;

  const columns: DataTableColumn<AdminOrganization>[] = [
    {
      id: 'name',
      header: 'Organization',
      isRowHeader: true,
      className: 'max-w-0',
      cell: (org) => (
        <div className="flex items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Building2 className="size-4" strokeWidth={1.5} />
          </span>
          <div className="min-w-0">
            <div className="truncate font-medium text-foreground">{org.name}</div>
            <div className="truncate font-mono text-xs text-muted-foreground">{org.slug}</div>
          </div>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      width: 'w-32',
      cell: (org) => (
        <span title={org.suspendReason ?? undefined}>
          <StatusBadge status={org.status} dot />
        </span>
      ),
    },
    {
      id: 'members',
      header: 'Members',
      numeric: true,
      width: 'w-24',
      hideBelow: 'sm',
      cell: (org) => (org._count?.members ?? 0).toLocaleString(),
    },
    {
      id: 'forms',
      header: 'Forms',
      numeric: true,
      width: 'w-24',
      hideBelow: 'sm',
      cell: (org) => (org._count?.forms ?? 0).toLocaleString(),
    },
    {
      id: 'storage',
      header: 'Storage',
      numeric: true,
      width: 'w-28',
      hideBelow: 'lg',
      // BigInt columns arrive as strings; Number() them before formatting.
      cell: (org) => formatBytes(Number(org.storageUsedBytes ?? 0)),
    },
    {
      id: 'createdAt',
      header: 'Created',
      width: 'w-36',
      hideBelow: 'xl',
      cell: (org) => (
        <span className="text-muted-foreground">
          <RelativeTime value={org.createdAt} />
        </span>
      ),
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      width: 'w-12',
      className: 'text-right',
      headerClassName: 'text-right',
      cell: (org) => (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Actions for ${org.name}`}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setEditTarget(org)} className="cursor-pointer">
              <Pencil className="mr-2 size-3.5" /> Edit
            </DropdownMenuItem>
            {org.status === 'SUSPENDED' ? (
              <DropdownMenuItem onClick={() => setActivateTarget(org)} className="cursor-pointer">
                <ShieldCheck className="mr-2 size-3.5" /> Reactivate
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                onClick={() => setSuspendTarget(org)}
                className="cursor-pointer text-destructive focus:bg-destructive/10 focus:text-destructive"
              >
                <ShieldAlert className="mr-2 size-3.5" /> Suspend
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onClick={() => setDeleteTarget(org)}
              className="cursor-pointer text-destructive focus:bg-destructive/10 focus:text-destructive"
            >
              <Trash2 className="mr-2 size-3.5" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <PageShell>
      <PageHeader
        title="Organizations"
        // description="Every tenant on this deployment."
        actions={
          <Button size="sm" className="gap-2" onClick={() => setCreating(true)}>
            <Plus className="size-4" /> New organization
          </Button>
        }
      />

      <Toolbar>
        <SearchInput
          value={pager.search}
          onChange={pager.setSearch}
          placeholder="Search organizations…"
          aria-label="Search organizations"
        />
      </Toolbar>

      <DataTable
        caption="Platform organizations"
        columns={columns}
        data={orgs}
        getRowId={(org) => org.id}
        rowHref={(org) => `/platform/organizations/${org.id}`}
        isLoading={isLoading || isFetching}
        error={error}
        onRetry={() => refetch()}
        pagination={pager.paginationProps(total, 'organizations')}
        empty={
          <EmptyState
            variant="inline"
            icon={Building2}
            title={pager.search ? 'No organizations match' : 'No organizations'}
            description={
              pager.search
                ? 'Try a different search term.'
                : 'Organizations appear here as users sign up.'
            }
          />
        }
      />

      {/* Mounted only while open, so the reason field starts empty each time
          without an effect resetting it. */}
      {suspendTarget && (
        <SuspendModal
          org={suspendTarget}
          onClose={() => setSuspendTarget(null)}
          isPending={suspendOrg.isPending}
          onConfirm={async (reason) => {
            try {
              await suspendOrg.mutateAsync({ orgId: suspendTarget.id, reason });
              toast.success(`${suspendTarget.name} suspended`);
              setSuspendTarget(null);
            } catch {
              // Reported globally; the modal stays open with the reason typed.
            }
          }}
        />
      )}

      <ConfirmDialog
        open={!!activateTarget}
        onOpenChange={(open) => !open && setActivateTarget(null)}
        title="Reactivate organization"
        description={
          <>
            {activateTarget?.name} will regain full access. Their forms will start accepting
            submissions again.
          </>
        }
        confirmLabel="Reactivate"
        variant="default"
        isPending={activateOrg.isPending}
        onConfirm={async () => {
          if (!activateTarget) return;
          try {
            await activateOrg.mutateAsync(activateTarget.id);
            toast.success(`${activateTarget.name} reactivated`);
            setActivateTarget(null);
          } catch {
            // Reported globally.
          }
        }}
      />

      {creating && (
        <CreateOrgModal
          onClose={() => setCreating(false)}
          isPending={createOrg.isPending}
          onConfirm={async (data) => {
            try {
              await createOrg.mutateAsync(data);
              toast.success(`${data.name} created`);
              setCreating(false);
            } catch {
              // Reported globally; the modal stays open with the fields filled in.
            }
          }}
        />
      )}

      {editTarget && (
        <EditOrgModal
          org={editTarget}
          onClose={() => setEditTarget(null)}
          isPending={updateOrg.isPending}
          onConfirm={async (data) => {
            try {
              await updateOrg.mutateAsync({ orgId: editTarget.id, data });
              toast.success(`${data.name || editTarget.name} updated`);
              setEditTarget(null);
            } catch {
              // Reported globally; the modal stays open with the edits typed.
            }
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete organization"
        description={
          <>
            {deleteTarget?.name} and every membership in it will be removed from view immediately.
            Its forms, submissions, and audit trail are retained, not erased.
          </>
        }
        confirmLabel="Delete organization"
        confirmText={deleteTarget?.name}
        isPending={deleteOrg.isPending}
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await deleteOrg.mutateAsync(deleteTarget.id);
            toast.success(`${deleteTarget.name} deleted`);
            setDeleteTarget(null);
          } catch {
            // Reported globally.
          }
        }}
      />
    </PageShell>
  );
}

/** Name + optional slug. Leaving the slug blank generates one, same as signup. */
function CreateOrgModal({
  onClose,
  onConfirm,
  isPending,
}: {
  onClose: () => void;
  onConfirm: (data: { name: string; slug?: string }) => void;
  isPending: boolean;
}) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');

  const valid = name.trim().length >= 2;

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title="New organization"
      description="Creates an empty workspace with no members. Invite someone to it from the organization's own Team settings."
      footer={
        <ModalActions
          onCancel={onClose}
          confirmLabel="Create organization"
          onConfirm={() => onConfirm({ name: name.trim(), slug: slug.trim() || undefined })}
          isPending={isPending}
          disabled={!valid}
        />
      }
    >
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="create-org-name">Name</Label>
          <Input
            id="create-org-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme Foundation"
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="create-org-slug">Slug (optional)</Label>
          <Input
            id="create-org-slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="Generated automatically if left blank"
          />
        </div>
      </div>
    </Modal>
  );
}

/** Identity fields only. Quotas are edited from the organization's own detail page. */
function EditOrgModal({
  org,
  onClose,
  onConfirm,
  isPending,
}: {
  org: AdminOrganization;
  onClose: () => void;
  onConfirm: (data: { name?: string; slug?: string }) => void;
  isPending: boolean;
}) {
  const [name, setName] = useState(org.name);
  const [slug, setSlug] = useState(org.slug);

  const valid = name.trim().length >= 2 && slug.trim().length > 0;
  const dirty = name.trim() !== org.name || slug.trim() !== org.slug;

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title="Edit organization"
      footer={
        <ModalActions
          onCancel={onClose}
          confirmLabel="Save changes"
          onConfirm={() => onConfirm({ name: name.trim(), slug: slug.trim() })}
          isPending={isPending}
          disabled={!valid || !dirty}
        />
      }
    >
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="edit-org-name">Name</Label>
          <Input id="edit-org-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-org-slug">Slug</Label>
          <Input id="edit-org-slug" value={slug} onChange={(e) => setSlug(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}

function SuspendModal({
  org,
  onClose,
  onConfirm,
  isPending,
}: {
  org: AdminOrganization;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  isPending: boolean;
}) {
  const [reason, setReason] = useState('');

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title="Suspend organization"
      description={`${org.name} will lose access immediately and its published forms will stop accepting submissions.`}
      footer={
        <ModalActions
          onCancel={onClose}
          confirmLabel="Suspend organization"
          variant="destructive"
          onConfirm={() => onConfirm(reason.trim())}
          isPending={isPending}
          disabled={reason.trim().length < 5}
        />
      }
    >
      <div className="space-y-1.5">
        <Label htmlFor="suspend-reason">Reason</Label>
        <Textarea
          id="suspend-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="Recorded in the audit log and shown to the organization's admins."
        />
        <p className="text-xs text-muted-foreground">At least 5 characters.</p>
      </div>
    </Modal>
  );
}
