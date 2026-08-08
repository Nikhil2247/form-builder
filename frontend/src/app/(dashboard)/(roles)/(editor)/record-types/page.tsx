'use client';

import React, { useMemo, useState } from 'react';
import { Boxes, Contact, FileBox, MoreHorizontal, Plus, Settings2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ConfirmDialog,
  DataTable,
  EmptyState,
  Modal,
  ModalActions,
  PageHeader,
  PageShell,
  type DataTableColumn,
} from '@/components/shared';
import { DataAppsDisabled } from '@/components/apps/DataAppsGate';
import { humanizeKey } from '@/components/apps/AttributeList';
import { usePermissions } from '@/hooks/use-auth';
import { FEATURES, useFeature } from '@/hooks/use-features';
import { useForm, useForms } from '@/hooks/use-forms';
import {
  useCreateSubjectType,
  useDeleteSubjectType,
  useSubjectTypes,
  useUpdateSubjectType,
  type IdentityConfig,
  type SubjectType,
} from '@/hooks/use-subjects';

/** Sentinel for "not set" — Base UI selects carry a string value, never null. */
const NONE = '__none__';

/**
 * Record types.
 *
 * A record type is the shape of a subject: what a registration submission is
 * projected into. The identity config is the load-bearing part — it names the
 * QUESTION KEYS whose answers become the record's display name, its searchable
 * attributes, and its external id.
 *
 * Keys, not question ids: a form can be re-published with fresh ids for the
 * same logical field, and this configuration has to survive that. The pickers
 * below therefore offer `question.key` and fall back to the id only when a
 * question has never been given one.
 */
export default function RecordTypesPage() {
  const appsEnabled = useFeature(FEATURES.FORM_APPS);
  const { can } = usePermissions();

  const { data: types, isLoading, isFetching, error, refetch } = useSubjectTypes({
    enabled: appsEnabled,
  });

  const [isCreateOpen, setCreateOpen] = useState(false);
  /**
   * Bumped every time the create dialog opens.
   *
   * Both dialogs below reset by *remounting* — a `key` change — rather than by
   * clearing their fields from an effect. An effect that calls setState on open
   * renders the dialog once with the previous values before correcting itself,
   * which is both a wasted render and, briefly, the last record type's name
   * sitting in a "create" form.
   */
  const [createNonce, setCreateNonce] = useState(0);
  /**
   * `editTarget` is kept after the dialog closes so the content does not vanish
   * mid exit-animation; `isEditOpen` is what actually opens it.
   */
  const [editTarget, setEditTarget] = useState<SubjectType | null>(null);
  const [isEditOpen, setEditOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SubjectType | null>(null);

  const createType = useCreateSubjectType();
  const deleteType = useDeleteSubjectType();

  if (!appsEnabled) return <DataAppsDisabled title="Record types" />;

  function openCreate() {
    setCreateNonce((nonce) => nonce + 1);
    setCreateOpen(true);
  }

  function openEdit(type: SubjectType) {
    setEditTarget(type);
    setEditOpen(true);
  }

  async function handleCreate(values: { name: string; slug?: string; icon?: string }) {
    try {
      await createType.mutateAsync(values);
      toast.success(`Created "${values.name}"`);
      setCreateOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create this record type');
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteType.mutateAsync(deleteTarget.id);
      toast.success('Record type deleted');
      setDeleteTarget(null);
    } catch (err) {
      // The API refuses while records still exist, and says how many.
      toast.error(err instanceof Error ? err.message : 'Could not delete this record type');
    }
  }

  const columns: DataTableColumn<SubjectType>[] = [
    {
      id: 'name',
      header: 'Record type',
      isRowHeader: true,
      className: 'max-w-0',
      cell: (type) => (
        <div className="flex items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            {type.icon ? (
              <span aria-hidden className="text-sm leading-none">
                {type.icon}
              </span>
            ) : (
              <Boxes className="size-4" strokeWidth={1.5} />
            )}
          </span>
          <div className="min-w-0">
            <div className="truncate font-medium text-foreground">{type.name}</div>
            <div className="truncate font-mono text-xs text-muted-foreground">{type.slug}</div>
          </div>
        </div>
      ),
    },
    {
      id: 'registration',
      header: 'Registration form',
      hideBelow: 'md',
      className: 'max-w-0',
      cell: (type) =>
        type.registrationFormId ? (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <FileBox className="size-3.5 shrink-0" />
            <span className="truncate">Bound</span>
          </span>
        ) : (
          <span className="text-muted-foreground">Not set</span>
        ),
    },
    {
      id: 'identity',
      header: 'Display name from',
      hideBelow: 'lg',
      className: 'max-w-0',
      cell: (type) => {
        const keys = type.identityConfig?.displayName ?? [];
        return keys.length > 0 ? (
          <span className="truncate text-xs text-muted-foreground">
            {keys.map(humanizeKey).join(' + ')}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        );
      },
    },
    {
      id: 'subjects',
      header: 'Records',
      numeric: true,
      width: 'w-24',
      cell: (type) => (type._count?.subjects ?? 0).toLocaleString(),
    },
    {
      id: 'forms',
      header: 'Forms',
      numeric: true,
      width: 'w-24',
      hideBelow: 'sm',
      cell: (type) => (type._count?.forms ?? 0).toLocaleString(),
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      width: 'w-12',
      className: 'text-right',
      headerClassName: 'text-right',
      cell: (type) => (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Actions for ${type.name}`}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => openEdit(type)} className="cursor-pointer">
              <Settings2 className="mr-2 size-3.5" /> Identity settings
            </DropdownMenuItem>
            {/* Deleting a type is @RequiredRole('ADMIN') on the API — offering it
                to an editor would only produce a 403. */}
            {can('org:manage') && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setDeleteTarget(type)}
                  className="cursor-pointer text-destructive focus:bg-destructive/10 focus:text-destructive"
                >
                  <Trash2 className="mr-2 size-3.5" /> Delete
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <PageShell>
      <PageHeader
        title="Record types"
        description="The shape of a subject record, and which registration answers identify it."
        actions={
          <Button size="sm" className="gap-2" onClick={openCreate}>
            <Plus className="size-4" /> New record type
          </Button>
        }
      />

      <DataTable
        caption="Record types in your organization"
        columns={columns}
        data={types}
        getRowId={(type) => type.id}
        isLoading={isLoading || isFetching}
        error={error}
        onRetry={() => refetch()}
        onRowClick={openEdit}
        skeletonRows={5}
        empty={
          <EmptyState
            variant="inline"
            icon={Boxes}
            title="No record types yet"
            description="Create one for each kind of thing you track over time — a patient, a household, a piece of equipment."
            action={
              <Button size="sm" className="gap-2" onClick={openCreate}>
                <Plus className="size-4" /> New record type
              </Button>
            }
          />
        }
      />

      <CreateRecordTypeModal
        key={`create-${createNonce}`}
        open={isCreateOpen}
        onOpenChange={setCreateOpen}
        isPending={createType.isPending}
        onCreate={handleCreate}
      />

      {editTarget && (
        <IdentitySettingsModal
          key={editTarget.id}
          subjectType={editTarget}
          open={isEditOpen}
          onOpenChange={setEditOpen}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete this record type"
        description={
          <>
            &ldquo;{deleteTarget?.name}&rdquo; will be removed. This is refused while it still has
            records — delete or migrate those first.
          </>
        }
        confirmLabel="Delete record type"
        onConfirm={handleDelete}
        isPending={deleteType.isPending}
      />
    </PageShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function CreateRecordTypeModal({
  open,
  onOpenChange,
  onCreate,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (values: { name: string; slug?: string; icon?: string }) => void;
  isPending: boolean;
}) {
  // Fresh on every open: the parent remounts this component with a new key
  // rather than clearing the fields from an effect.
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');

  const submit = () => {
    if (!name.trim()) return;
    onCreate({ name: name.trim(), icon: icon.trim() || undefined });
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Create a record type"
      description="You can bind a registration form and configure identity afterwards."
      footer={
        <ModalActions
          onCancel={() => onOpenChange(false)}
          confirmLabel="Create"
          onConfirm={submit}
          isPending={isPending}
          disabled={!name.trim()}
        />
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="record-type-name">Name</Label>
          <Input
            id="record-type-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="Household"
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            The id is generated from the name and cannot be changed later.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="record-type-icon">Icon (optional)</Label>
          <Input
            id="record-type-icon"
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="🏠"
            maxLength={4}
          />
        </div>
      </div>
    </Modal>
  );
}

/** A question as the identity pickers need it. */
interface QuestionKey {
  key: string;
  label: string;
}

/**
 * Mounted per record type and keyed on its id, so the fields below can seed
 * straight from props in `useState` — no effect, and therefore no render where
 * the previous record type's identity is briefly on screen under this one's
 * title.
 */
function IdentitySettingsModal({
  subjectType,
  open,
  onOpenChange,
}: {
  subjectType: SubjectType;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const identity: IdentityConfig = subjectType.identityConfig ?? {};

  const [name, setName] = useState(subjectType.name);
  const [icon, setIcon] = useState(subjectType.icon ?? '');
  const [registrationFormId, setRegistrationFormId] = useState<string>(
    subjectType.registrationFormId ?? NONE,
  );
  const [displayName, setDisplayName] = useState<string[]>(identity.displayName ?? []);
  const [attributes, setAttributes] = useState<string[]>(identity.attributes ?? []);
  const [externalId, setExternalId] = useState<string>(identity.externalId ?? NONE);

  const updateType = useUpdateSubjectType();

  // Published forms only: an unpublished form has no immutable version for the
  // submission worker to project answers from.
  const forms = useForms({ limit: 100, status: 'PUBLISHED' });
  const registrationForm = useForm(
    registrationFormId !== NONE ? registrationFormId : undefined,
  );

  const questionKeys = useMemo<QuestionKey[]>(() => {
    const questions = registrationForm.data?.questionsJson ?? [];
    return questions
      .filter((question) => question.type !== 'SECTION_HEADER')
      .map((question) => {
        // `key` is a stable authoring alias; older questions have only an id.
        const alias = (question as { key?: string }).key;
        return {
          key: alias && alias.length > 0 ? alias : question.id,
          label: question.label || 'Untitled question',
        };
      });
  }, [registrationForm.data]);

  const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

  async function submit() {
    if (!name.trim()) return;
    try {
      await updateType.mutateAsync({
        subjectTypeId: subjectType.id,
        name: name.trim(),
        icon: icon.trim(),
        registrationFormId: registrationFormId === NONE ? null : registrationFormId,
        identityConfig: {
          displayName,
          attributes,
          ...(externalId !== NONE ? { externalId } : {}),
        },
      });
      toast.success('Identity settings saved');
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save these settings');
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={`${subjectType.name} — identity`}
      description="Which registration answers identify a record, and which are promoted for search."
      footer={
        <ModalActions
          onCancel={() => onOpenChange(false)}
          confirmLabel="Save settings"
          onConfirm={submit}
          isPending={updateType.isPending}
          disabled={!name.trim()}
        />
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_6rem]">
          <div className="space-y-1.5">
            <Label htmlFor="identity-name">Name</Label>
            <Input
              id="identity-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Household"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="identity-icon">Icon</Label>
            <Input
              id="identity-icon"
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              placeholder="🏠"
              maxLength={4}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Registration form</Label>
          <Select
            value={registrationFormId}
            onValueChange={(value) => {
              const next = (value as string) ?? NONE;
              if (next === registrationFormId) return;
              setRegistrationFormId(next);
              // Keys from the previous form do not exist on the new one; keeping
              // them would silently produce records named "Unnamed record".
              setDisplayName([]);
              setAttributes([]);
              setExternalId(NONE);
            }}
          >
            <SelectTrigger className="w-full" aria-label="Registration form">
              <SelectValue placeholder="Choose a published form" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>No registration form</SelectItem>
              {(forms.data?.forms ?? []).map((form) => (
                <SelectItem key={form.id} value={form.id}>
                  {form.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Binding a form marks it as the one that creates records of this type.
          </p>
        </div>

        {registrationFormId === NONE ? (
          <EmptyState
            variant="inline"
            icon={FileBox}
            title="Choose a registration form first"
            description="Identity is defined in terms of that form's questions, so there is nothing to pick from until one is bound."
          />
        ) : registrationForm.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8" />
            ))}
          </div>
        ) : questionKeys.length === 0 ? (
          <EmptyState
            variant="inline"
            icon={FileBox}
            title="This form has no questions"
            description="Add questions to the form, publish it, and come back."
          />
        ) : (
          <>
            <KeyPicker
              title="Display name"
              description="Joined in the order you select them. This is what appears in every record list."
              questionKeys={questionKeys}
              selected={displayName}
              onToggle={(key) => setDisplayName((current) => toggle(current, key))}
              ordered
            />

            <KeyPicker
              title="Searchable attributes"
              description="Promoted onto the record so they can be shown on its header and used to prefill later forms."
              questionKeys={questionKeys}
              selected={attributes}
              onToggle={(key) => setAttributes((current) => toggle(current, key))}
            />

            <div className="space-y-1.5">
              <Label>External id</Label>
              <Select
                value={externalId}
                onValueChange={(value) => setExternalId((value as string) ?? NONE)}
              >
                <SelectTrigger className="w-full" aria-label="External id question">
                  <SelectValue placeholder="No external id" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No external id</SelectItem>
                  {questionKeys.map((question) => (
                    <SelectItem key={question.key} value={question.key}>
                      {question.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                A stable id from your own system — a patient number, an asset tag. Used for
                duplicate detection alongside the display name.
              </p>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function KeyPicker({
  title,
  description,
  questionKeys,
  selected,
  onToggle,
  ordered,
}: {
  title: string;
  description: string;
  questionKeys: QuestionKey[];
  selected: string[];
  onToggle: (key: string) => void;
  ordered?: boolean;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-foreground">{title}</legend>
      <p className="text-xs text-muted-foreground">{description}</p>

      <div className="max-h-52 space-y-0.5 overflow-y-auto rounded-lg border border-border p-1">
        {questionKeys.map((question) => {
          const index = selected.indexOf(question.key);
          const isSelected = index !== -1;

          return (
            <label
              key={question.key}
              className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted/60"
            >
              <Checkbox
                checked={isSelected}
                onCheckedChange={() => onToggle(question.key)}
                aria-label={question.label}
              />
              <span className="min-w-0 flex-1 truncate">{question.label}</span>
              {ordered && isSelected && (
                <span className="tabular shrink-0 rounded bg-muted px-1.5 text-xs text-muted-foreground">
                  {index + 1}
                </span>
              )}
            </label>
          );
        })}
      </div>

      {selected.length > 0 && (
        <p className="text-xs text-muted-foreground">
          <Contact className="mr-1 inline size-3" />
          {selected.map(humanizeKey).join(ordered ? ' + ' : ', ')}
        </p>
      )}
    </fieldset>
  );
}
