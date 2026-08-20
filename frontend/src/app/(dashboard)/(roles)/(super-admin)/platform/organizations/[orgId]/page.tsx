'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  Building2,
  FileBox,
  HardDrive,
  MailPlus,
  Pencil,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  PageHeader,
  PageShell,
  DataTable,
  StatCard,
  StatGrid,
  StatusBadge,
  ConfirmDialog,
  CopyField,
  EmptyState,
  ErrorState,
  ButtonLink,
  Modal,
  ModalActions,
  FormattedDate,
  RelativeTime,
  type DataTableColumn,
} from '@/components/shared';
import { formatBytes, formatCompact } from '@/components/shared/formatters';
import { cn } from '@/lib/utils';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import {
  useActivateOrganization,
  useAddOrgMember,
  useAdminOrganization,
  useSuspendOrganization,
  useUpdateOrganization,
  useDeleteOrganization,
  useUpdateOrgQuotas,
  type AdminOrganizationDetail,
  type AdminOrgForm,
  type AdminOrgMember,
  type OrgRole,
} from '@/hooks/use-admin';

/**
 * One tenant, in full.
 *
 * Quotas are the reason this page is editable rather than a read-only drill-in:
 * they are the only lever a platform operator has over a customer short of
 * suspending them, and doing it through the database is how limits end up
 * inconsistent with what support told the customer.
 */

const BYTES_PER_GB = 1024 ** 3;

/**
 * Failures are reported by the global MutationCache handler in query-provider,
 * using the fallback copy each mutation declares in its `meta`. The `catch`
 * blocks below exist only to keep `mutateAsync` from rejecting unhandled and to
 * leave the dialog open — they deliberately do not toast, because doing so here
 * as well would put two toasts on screen for one failure.
 */

export default function PlatformOrganizationDetailPage() {
  const params = useParams<{ orgId: string }>();
  const orgId = params.orgId;
  const router = useRouter();

  const { data: org, isLoading, error, refetch } = useAdminOrganization(orgId);

  const suspendOrg = useSuspendOrganization();
  const activateOrg = useActivateOrganization();
  const updateOrg = useUpdateOrganization();
  const deleteOrg = useDeleteOrganization();

  const [suspending, setSuspending] = useState(false);
  const [activating, setActivating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (error) {
    return (
      <PageShell>
        <ErrorState
          title="Could not load this organization"
          error={error}
          onRetry={() => refetch()}
        />
      </PageShell>
    );
  }

  if (!isLoading && !org) {
    return (
      <PageShell>
        <EmptyState
          icon={Building2}
          title="Organization not found"
          description="It may have been deleted, or the identifier in the URL is not an organization."
          action={
            <ButtonLink size="sm" href="/platform/organizations">
              Back to organizations
            </ButtonLink>
          }
        />
      </PageShell>
    );
  }

  const members = org?.members ?? [];
  const memberCount = org?._count?.members ?? members.length;
  const formCount = org?._count?.forms ?? 0;
  const invitationCount = org?._count?.invitations ?? 0;

  const storageUsed = Number(org?.storageUsedBytes ?? 0);
  const storageQuota = Number(org?.storageQuotaBytes ?? 0);
  const storagePercent =
    storageQuota > 0 ? Math.min(100, Math.round((storageUsed / storageQuota) * 100)) : 0;

  async function handleSuspend(reason: string) {
    if (!org) return;
    try {
      await suspendOrg.mutateAsync({ orgId: org.id, reason });
      toast.success(`${org.name} suspended`);
      setSuspending(false);
    } catch {
      // Reported globally; the dialog stays open so the reason is not lost.
    }
  }

  async function handleActivate() {
    if (!org) return;
    try {
      await activateOrg.mutateAsync(org.id);
      toast.success(`${org.name} reactivated`);
      setActivating(false);
    } catch {
      // Reported globally.
    }
  }

  return (
    <PageShell>
      <PageHeader
        isLoading={isLoading}
        back="/platform/organizations"
        breadcrumbs={[
          { label: 'Organizations', href: '/platform/organizations' },
          { label: org?.name ?? '' },
        ]}
        title={org?.name ?? ''}
        description={org ? <span className="font-mono text-xs">{org.slug}</span> : undefined}
        badge={org ? <StatusBadge status={org.status} dot /> : undefined}
        actions={
          org ? (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="gap-2" onClick={() => setEditing(true)}>
                <Pencil className="size-4" /> Edit
              </Button>
              {org.status === 'ACTIVE' ? (
                <Button
                  variant="destructive"
                  size="sm"
                  className="gap-2"
                  onClick={() => setSuspending(true)}
                >
                  <ShieldAlert className="size-4" /> Suspend
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => setActivating(true)}
                >
                  <ShieldCheck className="size-4" /> Reactivate
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="gap-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setDeleting(true)}
              >
                <Trash2 className="size-4" /> Delete
              </Button>
            </div>
          ) : undefined
        }
      />

      {org && org.status !== 'ACTIVE' && (
        <div className="flex flex-wrap items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0">
            <p className="font-medium">
              {org.status === 'SUSPENDED' ? 'This organization is suspended.' : 'This organization is inactive.'}{' '}
              Its published forms are not accepting submissions.
            </p>
            {org.suspendReason && <p className="mt-0.5 text-xs">Reason: {org.suspendReason}</p>}
            {org.suspendedAt && (
              <p className="mt-0.5 text-xs">
                Suspended <RelativeTime value={org.suspendedAt} />
              </p>
            )}
          </div>
        </div>
      )}

      <StatGrid>
        <StatCard
          label="Members"
          icon={Users}
          isLoading={isLoading}
          value={formatCompact(memberCount)}
          hint={org ? `Limit ${org.maxMembers.toLocaleString()}` : undefined}
        />
        <StatCard
          label="Forms"
          icon={FileBox}
          isLoading={isLoading}
          value={formatCompact(formCount)}
          hint={org ? `Limit ${org.maxForms.toLocaleString()}` : undefined}
        />
        <StatCard
          label="Pending invitations"
          icon={MailPlus}
          isLoading={isLoading}
          value={formatCompact(invitationCount)}
        />
        <StatCard
          label="Storage used"
          icon={HardDrive}
          isLoading={isLoading}
          value={formatBytes(storageUsed)}
          hint={org ? `${storagePercent}% of ${formatBytes(storageQuota)}` : undefined}
        />
      </StatGrid>

      {isLoading || !org ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-72 animate-pulse rounded-xl border border-border bg-card" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <SummaryCard
              org={org}
              storageUsed={storageUsed}
              storageQuota={storageQuota}
              storagePercent={storagePercent}
            />
            <QuotasCard
              // Remount whenever the server's numbers change, so the inputs are
              // seeded from props without an effect writing state.
              key={`${org.id}:${org.maxForms}:${org.maxSubmissionsMonth}:${org.maxMembers}:${org.storageQuotaBytes}`}
              org={org}
            />
          </div>

          <MembersSection orgId={orgId} members={members} />

          <FormsSection forms={org.forms} formCount={formCount} />
        </>
      )}

      {/* Mounted only while open, so the reason field starts empty each time
          without an effect resetting it. */}
      {suspending && org && (
        <SuspendModal
          org={org}
          onClose={() => setSuspending(false)}
          isPending={suspendOrg.isPending}
          onConfirm={handleSuspend}
        />
      )}

      <ConfirmDialog
        open={activating}
        onOpenChange={setActivating}
        title="Reactivate organization"
        description={
          <>
            {org?.name} will regain full access and its published forms will start accepting
            submissions again.
          </>
        }
        confirmLabel="Reactivate"
        variant="default"
        isPending={activateOrg.isPending}
        onConfirm={handleActivate}
      />

      {editing && org && (
        <EditOrgModal
          org={org}
          onClose={() => setEditing(false)}
          isPending={updateOrg.isPending}
          onConfirm={async (data) => {
            try {
              await updateOrg.mutateAsync({ orgId: org.id, data });
              toast.success('Organization updated');
              setEditing(false);
            } catch {
              // Reported globally; the modal stays open with the edits typed.
            }
          }}
        />
      )}

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete organization"
        description={
          <>
            {org?.name} and every membership in it will be removed from view immediately. Its
            forms, submissions, and audit trail are retained, not erased.
          </>
        }
        confirmLabel="Delete organization"
        confirmText={org?.name}
        isPending={deleteOrg.isPending}
        onConfirm={async () => {
          if (!org) return;
          try {
            await deleteOrg.mutateAsync(org.id);
            toast.success(`${org.name} deleted`);
            router.push('/platform/organizations');
          } catch {
            // Reported globally.
          }
        }}
      />
    </PageShell>
  );
}

/** Identity fields only. Quotas are edited in QuotasCard below. */
function EditOrgModal({
  org,
  onClose,
  onConfirm,
  isPending,
}: {
  org: AdminOrganizationDetail;
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

// ─────────────────────────────────────────────────────────────────────────────

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-2 last:border-0">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right text-sm text-foreground">{value}</dd>
    </div>
  );
}

function SummaryCard({
  org,
  storageUsed,
  storageQuota,
  storagePercent,
}: {
  org: AdminOrganizationDetail;
  storageUsed: number;
  storageQuota: number;
  storagePercent: number;
}) {
  return (
    <Card className="gap-4 p-5">
      <h2 className="text-sm font-semibold">Summary</h2>

      <dl>
        <Fact label="Name" value={org.name} />
        <Fact label="Slug" value={<span className="font-mono text-xs">{org.slug}</span>} />
        <Fact label="Status" value={<StatusBadge status={org.status} dot />} />
        <Fact label="Created" value={<FormattedDate value={org.createdAt} />} />
        <Fact label="Last updated" value={<RelativeTime value={org.updatedAt} />} />
      </dl>

      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-2 text-xs">
          <span className="text-muted-foreground">Storage</span>
          <span className="tabular text-foreground">
            {formatBytes(storageUsed)} of {formatBytes(storageQuota)}
          </span>
        </div>
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="img"
          aria-label={`${storagePercent}% of storage quota used`}
        >
          <div
            className={cn(
              'h-full rounded-full transition-all',
              storagePercent >= 90 ? 'bg-destructive' : storagePercent >= 75 ? 'bg-warning' : 'bg-primary',
            )}
            style={{ width: `${storagePercent}%` }}
          />
        </div>
      </div>

      <CopyField label="Organization ID" value={org.id} />
    </Card>
  );
}

interface QuotaDraft {
  maxForms: string;
  maxSubmissionsMonth: string;
  maxMembers: string;
  storageQuotaGb: string;
}

function toDraft(org: AdminOrganizationDetail): QuotaDraft {
  const quotaBytes = Number(org.storageQuotaBytes ?? 0);
  return {
    maxForms: String(org.maxForms ?? 0),
    maxSubmissionsMonth: String(org.maxSubmissionsMonth ?? 0),
    maxMembers: String(org.maxMembers ?? 0),
    // Round-trips cleanly for the defaults, which are whole gigabytes.
    storageQuotaGb: String(Math.round((quotaBytes / BYTES_PER_GB) * 100) / 100),
  };
}

function isPositiveInteger(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0;
}

function QuotasCard({ org }: { org: AdminOrganizationDetail }) {
  const initial = toDraft(org);
  const [draft, setDraft] = useState<QuotaDraft>(initial);
  const updateQuotas = useUpdateOrgQuotas();

  const storageGb = Number(draft.storageQuotaGb);
  const storageValid = Number.isFinite(storageGb) && storageGb > 0;

  const valid =
    isPositiveInteger(draft.maxForms) &&
    isPositiveInteger(draft.maxSubmissionsMonth) &&
    isPositiveInteger(draft.maxMembers) &&
    storageValid;

  const dirty =
    draft.maxForms !== initial.maxForms ||
    draft.maxSubmissionsMonth !== initial.maxSubmissionsMonth ||
    draft.maxMembers !== initial.maxMembers ||
    draft.storageQuotaGb !== initial.storageQuotaGb;

  const set = (field: keyof QuotaDraft) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setDraft((current) => ({ ...current, [field]: event.target.value }));

  async function save() {
    if (!valid) return;
    try {
      await updateQuotas.mutateAsync({
        orgId: org.id,
        quotas: {
          maxForms: Number(draft.maxForms),
          maxSubmissionsMonth: Number(draft.maxSubmissionsMonth),
          maxMembers: Number(draft.maxMembers),
          // BigInt column — the API parses a decimal string, so never send a
          // float or a value that has been through Number's precision limit.
          storageQuotaBytes: String(Math.round(storageGb * BYTES_PER_GB)),
        },
      });
      toast.success('Quotas updated');
    } catch {
      // Reported globally; the edited values stay on screen for a retry.
    }
  }

  return (
    <Card className="gap-4 p-5">
      <div>
        <h2 className="text-sm font-semibold">Quotas</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Limits are enforced when the organization creates a form, invites a member, or receives a
          submission. Lowering one below current usage does not delete anything.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <QuotaField
          id="quota-max-forms"
          label="Maximum forms"
          value={draft.maxForms}
          onChange={set('maxForms')}
          invalid={!isPositiveInteger(draft.maxForms)}
          hint={`${(org._count?.forms ?? 0).toLocaleString()} in use`}
        />
        <QuotaField
          id="quota-max-members"
          label="Maximum members"
          value={draft.maxMembers}
          onChange={set('maxMembers')}
          invalid={!isPositiveInteger(draft.maxMembers)}
          hint={`${org.members.length.toLocaleString()} in use`}
        />
        <QuotaField
          id="quota-max-submissions"
          label="Submissions per month"
          value={draft.maxSubmissionsMonth}
          onChange={set('maxSubmissionsMonth')}
          invalid={!isPositiveInteger(draft.maxSubmissionsMonth)}
        />
        <QuotaField
          id="quota-storage"
          label="Storage quota (GB)"
          value={draft.storageQuotaGb}
          onChange={set('storageQuotaGb')}
          invalid={!storageValid}
          step="0.5"
          hint={formatBytes(Number(org.storageUsedBytes ?? 0)) + ' in use'}
        />
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <Button size="sm" disabled={!dirty || !valid || updateQuotas.isPending} onClick={save}>
          {updateQuotas.isPending ? 'Saving…' : 'Save quotas'}
        </Button>
        {dirty && (
          <Button variant="ghost" size="sm" onClick={() => setDraft(initial)}>
            Reset
          </Button>
        )}
        {!valid && (
          <span className="text-xs text-destructive">
            Every quota must be a positive number.
          </span>
        )}
      </div>
    </Card>
  );
}

function QuotaField({
  id,
  label,
  value,
  onChange,
  invalid,
  hint,
  step,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  invalid: boolean;
  hint?: string;
  step?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min="1"
        step={step ?? '1'}
        inputMode="decimal"
        value={value}
        onChange={onChange}
        aria-invalid={invalid || undefined}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function MembersSection({ orgId, members }: { orgId: string; members: AdminOrgMember[] }) {
  const addMember = useAddOrgMember();
  const [adding, setAdding] = useState(false);

  const columns: DataTableColumn<AdminOrgMember>[] = [
    {
      id: 'user',
      header: 'Member',
      isRowHeader: true,
      className: 'max-w-0',
      cell: (member) => {
        const name = [member.user.firstName, member.user.lastName].filter(Boolean).join(' ');
        const initials =
          `${member.user.firstName?.[0] ?? ''}${member.user.lastName?.[0] ?? ''}`.toUpperCase() ||
          member.user.email[0]?.toUpperCase() ||
          '?';

        return (
          <div className="flex items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
              {initials}
            </span>
            <div className="min-w-0">
              <Link
                href={`/platform/users/${member.user.id}`}
                className="truncate font-medium text-foreground hover:underline"
              >
                {name || member.user.email}
              </Link>
              <div className="truncate text-xs text-muted-foreground">{member.user.email}</div>
            </div>
          </div>
        );
      },
    },
    {
      id: 'role',
      header: 'Org role',
      width: 'w-32',
      cell: (member) => <StatusBadge status={member.role} />,
    },
    {
      id: 'systemRole',
      header: 'Platform role',
      width: 'w-36',
      hideBelow: 'md',
      cell: (member) =>
        member.user.systemRole === 'SUPER_ADMIN' ? (
          <StatusBadge status="SUPER_ADMIN" />
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: 'joinedAt',
      header: 'Joined',
      width: 'w-40',
      hideBelow: 'lg',
      cell: (member) => (
        <span className="text-muted-foreground">
          <RelativeTime value={member.joinedAt} />
        </span>
      ),
    },
  ];

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Members</h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            Change a role from the member’s own page.
          </span>
          <Button size="sm" variant="outline" className="gap-2" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" /> Add member
          </Button>
        </div>
      </div>

      <DataTable
        caption="Organization members"
        columns={columns}
        data={members}
        getRowId={(member) => member.id}
        rowHref={(member) => `/platform/users/${member.user.id}`}
        empty={
          <EmptyState
            variant="inline"
            icon={Users}
            title="No members"
            description="Nobody belongs to this organization, so nobody can sign in to it."
            action={
              <Button size="sm" className="gap-2" onClick={() => setAdding(true)}>
                <Plus className="size-3.5" /> Add member
              </Button>
            }
          />
        }
      />

      {adding && (
        <AddMemberModal
          onClose={() => setAdding(false)}
          isPending={addMember.isPending}
          onConfirm={async (data) => {
            try {
              await addMember.mutateAsync({ orgId, ...data });
              toast.success(`${data.email} added to this organization`);
              setAdding(false);
            } catch {
              // Reported globally; the modal stays open with the fields filled in.
            }
          }}
        />
      )}
    </section>
  );
}

function AddMemberModal({
  onClose,
  onConfirm,
  isPending,
}: {
  onClose: () => void;
  onConfirm: (data: { email: string; role: OrgRole }) => void;
  isPending: boolean;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrgRole>('VIEWER');

  const valid = /\S+@\S+\.\S+/.test(email);

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title="Add member"
      description="The account must already exist. This grants membership immediately — no invitation email is sent."
      footer={
        <ModalActions
          onCancel={onClose}
          confirmLabel="Add member"
          onConfirm={() => onConfirm({ email: email.trim(), role })}
          isPending={isPending}
          disabled={!valid}
        />
      }
    >
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="add-member-email">Email</Label>
          <Input
            id="add-member-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="person@example.org"
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="add-member-role">Role</Label>
          <NativeSelect
            className="w-full"
            id="add-member-role"
            value={role}
            onChange={(e) => setRole(e.target.value as OrgRole)}
          >
            <NativeSelectOption value="ADMIN">Admin</NativeSelectOption>
            <NativeSelectOption value="EDITOR">Editor</NativeSelectOption>
            <NativeSelectOption value="VIEWER">Viewer</NativeSelectOption>
          </NativeSelect>
        </div>
      </div>
    </Modal>
  );
}

/**
 * The platform organization endpoint returns counts, not the form records
 * themselves. Rather than render an empty table that reads as "this tenant has
 * no forms", the section says which of the two situations it is.
 */
function FormsSection({ forms, formCount }: { forms?: AdminOrgForm[]; formCount: number }) {
  const columns: DataTableColumn<AdminOrgForm>[] = [
    {
      id: 'title',
      header: 'Form',
      isRowHeader: true,
      className: 'max-w-0',
      cell: (form) => (
        <div className="truncate font-medium text-foreground">
          {form.title ?? form.name ?? form.id}
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      width: 'w-32',
      cell: (form) => <StatusBadge status={form.status} dot />,
    },
    {
      id: 'submissions',
      header: 'Responses',
      numeric: true,
      width: 'w-28',
      hideBelow: 'md',
      cell: (form) => (form._count?.submissions ?? 0).toLocaleString(),
    },
    {
      id: 'createdAt',
      header: 'Created',
      width: 'w-40',
      hideBelow: 'lg',
      cell: (form) => (
        <span className="text-muted-foreground">
          <RelativeTime value={form.createdAt} />
        </span>
      ),
    },
  ];

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold">Forms</h2>

      {forms && forms.length > 0 ? (
        <DataTable
          caption="Recent forms in this organization"
          columns={columns}
          data={forms}
          getRowId={(form) => form.id}
        />
      ) : formCount > 0 ? (
        <EmptyState
          icon={FileBox}
          title={`${formCount.toLocaleString()} form${formCount === 1 ? '' : 's'} in this organization`}
          description="The platform API reports the count but not the individual forms. Their activity is visible in the audit log."
          action={
            <ButtonLink variant="outline" size="sm" href="/platform/audit-logs">
              Open audit logs
            </ButtonLink>
          }
        />
      ) : (
        <EmptyState
          icon={FileBox}
          title="No forms yet"
          description="Nobody in this organization has built a form."
        />
      )}
    </section>
  );
}

/** Matching the list page: suspension records a reason, so it needs an input. */
function SuspendModal({
  org,
  onClose,
  onConfirm,
  isPending,
}: {
  org: AdminOrganizationDetail;
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
        <Label htmlFor="org-suspend-reason">Reason</Label>
        <Textarea
          id="org-suspend-reason"
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
