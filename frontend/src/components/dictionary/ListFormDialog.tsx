'use client';

import React from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Modal, ModalActions } from '@/components/shared';
import {
  useCreateList,
  useUpdateList,
  type ChoiceListSummary,
  type DictionaryScope,
} from '@/hooks/use-dictionary';

/**
 * Create or rename a list.
 *
 * The two are one dialog because they differ in exactly two places: whether the
 * id is editable, and which mutation runs. Splitting them would duplicate the
 * cascade picker and the id-derivation rule, and those are the parts most
 * likely to change.
 */

const NO_PARENT = '__none__';

export interface ListFormDialogProps {
  scope: DictionaryScope;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Absent when creating. */
  editing?: ChoiceListSummary | null;
  /** Candidate parents — the lists this one may cascade from. */
  lists: ChoiceListSummary[];
}

export function ListFormDialog({
  scope,
  open,
  onOpenChange,
  editing,
  lists,
}: ListFormDialogProps) {
  const create = useCreateList(scope);
  const update = useUpdateList(scope);
  const isEditing = !!editing;

  // Seeded from `editing` at mount. The parent renders this dialog only while
  // it is open and keys it by what is being edited, so a fresh mount — not an
  // effect reconciling props back into state — is what makes the fields match
  // the list the user clicked.
  const [name, setName] = React.useState(editing?.name ?? '');
  const [slug, setSlug] = React.useState(editing?.slug ?? '');
  const [slugTouched, setSlugTouched] = React.useState(false);
  const [description, setDescription] = React.useState(editing?.description ?? '');
  const [parentSlug, setParentSlug] = React.useState<string>(
    editing?.parentList?.slug ?? NO_PARENT,
  );
  const [error, setError] = React.useState<string | null>(null);

  // The id follows the name until the user edits it directly, which is the
  // behaviour people expect from a slug field and saves them typing it twice.
  const effectiveSlug = isEditing ? editing!.slug : slugTouched ? slug : derive(name);

  // A list may not cascade from itself, nor from anything that already sits
  // under it — the server enforces both, and offering them here would only
  // produce an error the user cannot act on.
  const parentOptions = React.useMemo(
    () => lists.filter((list) => !editing || !isDescendant(list, editing, lists)),
    [lists, editing],
  );

  const isPending = create.isPending || update.isPending;

  const onSubmit = async () => {
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Give the list a name.');
      return;
    }

    const parentListSlug = parentSlug === NO_PARENT ? null : parentSlug;

    try {
      if (isEditing) {
        await update.mutateAsync({
          slug: editing!.slug,
          name: trimmed,
          description: description.trim(),
          parentListSlug,
        });
      } else {
        await create.mutateAsync({
          name: trimmed,
          slug: effectiveSlug || undefined,
          description: description.trim() || undefined,
          parentListSlug: parentListSlug ?? undefined,
        });
      }
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That could not be saved.');
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={isEditing ? `Edit ${editing!.name}` : 'New list'}
      description={
        isEditing
          ? undefined
          : 'A named set of options that any number of dropdowns can draw from — states, districts, schools, cost centres.'
      }
      footer={
        <ModalActions
          onCancel={() => onOpenChange(false)}
          onConfirm={onSubmit}
          confirmLabel={isEditing ? 'Save' : 'Create list'}
          isPending={isPending}
          disabled={!name.trim()}
        />
      }
    >
      <div className="flex flex-col gap-4">
        {error && (
          <p
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
          >
            {error}
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="list-name">Name</Label>
          <Input
            id="list-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Districts"
            maxLength={120}
            autoFocus
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="list-slug">Id</Label>
          <Input
            id="list-slug"
            value={effectiveSlug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value);
            }}
            placeholder="districts"
            maxLength={60}
            disabled={isEditing}
            className="font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground">
            {isEditing
              ? 'The id cannot change — questions are bound to the list by it, and renaming it would empty every dropdown that uses this list.'
              : 'How questions refer to this list. Lowercase letters, numbers and hyphens.'}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="list-description">Description</Label>
          <Textarea
            id="list-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this list holds, and where the data came from."
            rows={2}
            maxLength={500}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="list-parent">Cascades from</Label>
          <Select value={parentSlug} onValueChange={(v) => setParentSlug(v ?? NO_PARENT)}>
            <SelectTrigger id="list-parent" className="h-9">
              <SelectValue placeholder="Nothing — this is a top-level list" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_PARENT}>Nothing — this is a top-level list</SelectItem>
              {parentOptions.map((list) => (
                <SelectItem key={list.slug} value={list.slug}>
                  {list.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Pick a parent to make this a dependent dropdown: choosing a state filters the districts
            on offer. Every item then needs a parent value naming the item it sits under.
          </p>
        </div>
      </div>
    </Modal>
  );
}

/** Mirrors the server's slug rule so the field shows what will be stored. */
function derive(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Whether `candidate` sits anywhere beneath `list` in the cascade. */
function isDescendant(
  candidate: ChoiceListSummary,
  list: ChoiceListSummary,
  all: ChoiceListSummary[],
): boolean {
  const byId = new Map(all.map((entry) => [entry.id, entry]));
  let cursor: ChoiceListSummary | undefined = candidate;
  // Bounded: a ring in existing data must not hang the dialog that could fix it.
  for (let step = 0; cursor && step < 64; step++) {
    if (cursor.id === list.id) return true;
    cursor = cursor.parentListId ? byId.get(cursor.parentListId) : undefined;
  }
  return false;
}
