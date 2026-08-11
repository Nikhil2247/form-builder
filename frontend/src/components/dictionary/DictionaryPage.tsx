'use client';

import React from 'react';
import {
  BookMarked,
  Download,
  Globe,
  Layers,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import {
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  PageHeader,
  PageShell,
  RelativeTime,
  SearchInput,
  StatusBadge,
  Toolbar,
  type DataTableColumn,
} from '@/components/shared';
import { cn } from '@/lib/utils';
import {
  useDeleteList,
  useDictionaryItems,
  useDictionaryLists,
  useExportCsv,
  type ChoiceItemRow,
  type ChoiceListSummary,
  type DictionaryScope,
} from '@/hooks/use-dictionary';
import { CsvImportDialog } from './CsvImportDialog';
import { ListFormDialog } from './ListFormDialog';

/**
 * The choice-list dictionary.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Reference data that dropdowns draw from, managed in one place instead of
 * retyped into every form: states, districts, blocks, schools, designations.
 *
 * One component serves two routes. At `scope="platform"` a super admin curates
 * the GLOBAL dictionary — lists with no owning organization, readable by every
 * tenant. At `scope="org"` an admin manages their own, and sees the global ones
 * beside them, read-only, so they can tell what already exists before uploading
 * a duplicate.
 *
 * The master/detail split is deliberate: a district list has 780 items and a
 * school registry tens of thousands, so items are never rendered until a list
 * is chosen, and then only a page at a time.
 */

const PAGE_SIZE = 50;

export interface DictionaryPageProps {
  scope: DictionaryScope;
}

export function DictionaryPage({ scope }: DictionaryPageProps) {
  const { data: lists, isLoading, error, refetch } = useDictionaryLists(scope);
  const exportCsv = useExportCsv(scope);

  const [requestedSlug, setRequestedSlug] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<ChoiceListSummary | null>(null);
  const [isFormOpen, setFormOpen] = React.useState(false);
  const [importing, setImporting] = React.useState<ChoiceListSummary | null>(null);
  const [deleting, setDeleting] = React.useState<ChoiceListSummary | null>(null);

  /**
   * The list on screen, DERIVED rather than synchronised.
   *
   * `requestedSlug` is what the user last clicked; the selection is that list
   * if it still exists, and the first one otherwise. Two cases fall out of this
   * for free that an effect would have had to handle separately — the initial
   * load, where nothing has been clicked yet, and a list being deleted out from
   * under the selection, which would otherwise leave the detail pane querying a
   * slug that 404s.
   */
  const selected =
    lists?.find((list) => list.slug === requestedSlug) ?? lists?.[0] ?? null;

  const isPlatform = scope === 'platform';

  return (
    <PageShell>
      <PageHeader
        title={isPlatform ? 'Global dictionary' : 'Option lists'}
        description={
          isPlatform
            ? 'Reference data every organization can use in their dropdowns. Upload it once here rather than asking each tenant to load their own copy.'
            : 'Named sets of options your forms can draw from. Upload a spreadsheet once and every dropdown bound to the list stays in step.'
        }
        actions={
          <Button onClick={() => { setEditing(null); setFormOpen(true); }}>
            <Plus className="size-4" strokeWidth={1.5} />
            New list
          </Button>
        }
      />

      {error ? (
        <ErrorState title="Could not load the dictionary" error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" strokeWidth={1.5} />
          Loading lists…
        </div>
      ) : !lists?.length ? (
        <EmptyState
          icon={BookMarked}
          title="No lists yet"
          description={
            isPlatform
              ? 'Create a list, then upload a CSV of its options. States and districts are the usual starting point.'
              : 'Create a list, then upload a CSV of its options — or bind a question to one of the platform lists, which are available to you already.'
          }
          action={
            <Button onClick={() => { setEditing(null); setFormOpen(true); }}>
              <Plus className="size-4" strokeWidth={1.5} />
              New list
            </Button>
          }
        />
      ) : (
        // `items-start` is what lets the rail's `sticky` take effect — a grid
        // item stretches to the row height by default, leaving nothing for it
        // to stick within.
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(15rem,19rem)_minmax(0,1fr)]">
          <ListRail
            lists={lists}
            selectedSlug={selected?.slug ?? null}
            onSelect={setRequestedSlug}
          />

          {selected ? (
            <ListDetail
              // Remounted per list, so the search term, page number and
              // "show retired" toggle reset with the list they belonged to
              // rather than being carried onto the next one.
              key={selected.slug}
              scope={scope}
              list={selected}
              onEdit={() => { setEditing(selected); setFormOpen(true); }}
              onImport={() => setImporting(selected)}
              onDelete={() => setDeleting(selected)}
              onExport={() => exportCsv.mutate({ slug: selected.slug, name: selected.name })}
              isExporting={exportCsv.isPending}
              exportError={exportCsv.error}
            />
          ) : null}
        </div>
      )}

      {/* Mounted only while open, and keyed by what it is editing, so its
          fields are initialised from that list on the way in rather than
          reconciled with an effect on the way back. */}
      {isFormOpen && (
        <ListFormDialog
          key={editing?.id ?? 'new'}
          scope={scope}
          open
          onOpenChange={setFormOpen}
          editing={editing}
          lists={lists ?? []}
        />
      )}

      {importing && (
        <CsvImportDialog
          scope={scope}
          list={importing}
          open={!!importing}
          onOpenChange={(open) => !open && setImporting(null)}
        />
      )}

      {deleting && (
        <DeleteListDialog
          scope={scope}
          list={deleting}
          onClose={() => setDeleting(null)}
        />
      )}
    </PageShell>
  );
}

// ── Master ───────────────────────────────────────────────────────────────────

function ListRail({
  lists,
  selectedSlug,
  onSelect,
}: {
  lists: ChoiceListSummary[];
  selectedSlug: string | null;
  onSelect: (slug: string) => void;
}) {
  const [query, setQuery] = React.useState('');

  const filtered = React.useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return lists;
    return lists.filter(
      (list) =>
        list.name.toLowerCase().includes(term) || list.slug.toLowerCase().includes(term),
    );
  }, [lists, query]);

  return (
    // Sticky, not scrolling with the page. The rail is a navigation control and
    // the item table is the content; letting the rail scroll away meant picking
    // a different list from halfway down a 780-row district table required
    // scrolling back to the top first.
    <div className="flex flex-col gap-3 lg:sticky lg:top-6 lg:max-h-[calc(100dvh-6rem)]">
      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder="Find a list…"
        aria-label="Find a list"
      />

      {filtered.length === 0 ? (
        <p className="px-1 py-6 text-center text-sm text-muted-foreground">
          No list matches “{query}”.
        </p>
      ) : (
        <nav
          className="-mx-1 flex flex-col gap-1.5 overflow-y-auto px-1 pb-1"
          aria-label="Option lists"
        >
          {filtered.map((list) => {
            const isSelected = list.slug === selectedSlug;
            return (
              <button
                key={list.id}
                type="button"
                onClick={() => onSelect(list.slug)}
                aria-current={isSelected ? 'true' : undefined}
                className={cn(
                  'flex flex-col gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors',
                  // Every card carries a visible border and surface, not just
                  // the selected one. With `border-transparent` on the rest the
                  // rail read as loose text on the page background — there was
                  // nothing to tell the eye these were separate, clickable
                  // objects, so the list looked flat and unresponsive.
                  isSelected
                    ? 'border-primary bg-primary/10 shadow-sm'
                    : 'border-border bg-card hover:border-border-strong hover:bg-muted/50',
                )}
              >
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                    {list.name}
                  </span>
                  {list.isGlobal && (
                    <Globe
                      className="size-3.5 shrink-0 text-muted-foreground"
                      strokeWidth={1.5}
                      aria-label="Provided by the platform"
                    />
                  )}
                </span>

                {/* Wraps rather than truncating mid-word: at this width the
                    parent name was being cut to "under India — States and
                    Union T…", which is exactly the part that identifies it. */}
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                  <span className="tabular-nums">{list.itemCount.toLocaleString()} options</span>
                  {list.parentList && (
                    <>
                      <span aria-hidden>·</span>
                      <span className="inline-flex min-w-0 items-center gap-1">
                        <Layers className="size-3 shrink-0" strokeWidth={1.5} />
                        <span className="truncate">under {list.parentList.name}</span>
                      </span>
                    </>
                  )}
                </span>
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
}

// ── Detail ───────────────────────────────────────────────────────────────────

function ListDetail({
  scope,
  list,
  onEdit,
  onImport,
  onDelete,
  onExport,
  isExporting,
  exportError,
}: {
  scope: DictionaryScope;
  list: ChoiceListSummary;
  onEdit: () => void;
  onImport: () => void;
  onDelete: () => void;
  onExport: () => void;
  isExporting: boolean;
  exportError: Error | null;
}) {
  const [query, setQuery] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [includeInactive, setIncludeInactive] = React.useState(false);

  // A search or a filter change makes the current page number meaningless —
  // page 7 of the old result set is very rarely page 7 of the new one, and
  // landing past the end shows an empty table that reads as "no results". Reset
  // it where the change happens rather than in an effect watching for it.
  const search = (next: string) => {
    setQuery(next);
    setPage(1);
  };

  const toggleRetired = (next: boolean) => {
    setIncludeInactive(next);
    setPage(1);
  };

  const { data, isLoading, isFetching, error, refetch } = useDictionaryItems(scope, list.slug, {
    q: query || undefined,
    page,
    limit: PAGE_SIZE,
    includeInactive,
  });

  /**
   * The list's own metadata columns, plus any key that actually appears on the
   * rows on screen.
   *
   * A dictionary imported before its schema was declared still carries the data
   * — showing only the declared columns would hide it, and the usual reason
   * someone opens this table is to check exactly that.
   */
  const metadataKeys = React.useMemo(() => {
    const keys = new Set((data?.metadataSchema ?? []).map((column) => column.key));
    for (const item of data?.items ?? []) {
      for (const key of Object.keys(item.metadata ?? {})) keys.add(key);
    }
    return [...keys].slice(0, 8);
  }, [data]);

  const columns = React.useMemo<DataTableColumn<ChoiceItemRow>[]>(() => {
    const base: DataTableColumn<ChoiceItemRow>[] = [
      {
        id: 'label',
        header: 'Label',
        isRowHeader: true,
        cell: (row) => (
          <span className={cn('flex items-center gap-2', !row.isActive && 'text-muted-foreground')}>
            <span className="truncate">{row.label}</span>
            {!row.isActive && <StatusBadge status="ARCHIVED" />}
          </span>
        ),
      },
      {
        id: 'value',
        header: 'Value',
        width: 'w-52',
        // Truncated on one line with the full text on hover, not wrapped. A
        // generated value like `NL-kohima-chiephobozou-ghs-botsa` broke across
        // three lines and tripled every row's height, which made a 50-row page
        // unreadable — and the useful part of these values is the start.
        cell: (row) => (
          <code
            title={row.value}
            className="block max-w-full truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs"
          >
            {row.value}
          </code>
        ),
      },
    ];

    if (data?.cascades) {
      base.push({
        id: 'parent',
        header: 'Parent',
        width: 'w-40',
        hideBelow: 'md',
        cell: (row) =>
          row.parentValue ? (
            <code
              title={row.parentValue}
              className="block max-w-full truncate font-mono text-xs text-muted-foreground"
            >
              {row.parentValue}
            </code>
          ) : (
            <span className="text-xs text-destructive">missing</span>
          ),
      });
    }

    for (const key of metadataKeys) {
      base.push({
        id: `meta:${key}`,
        header: key,
        hideBelow: 'lg',
        cell: (row) => {
          const text = formatCell(row.metadata?.[key]);
          return (
            <span
              title={text}
              className="block max-w-40 truncate text-xs text-muted-foreground"
            >
              {text}
            </span>
          );
        },
      });
    }

    return base;
  }, [data?.cascades, metadataKeys]);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* ── Header card ──────────────────────────────────────────────────── */}
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-sm font-semibold text-foreground">{list.name}</h2>
              {list.isGlobal && (
                <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  <Globe className="size-3" strokeWidth={1.5} />
                  Platform list
                </span>
              )}
            </div>
            {list.description && (
              <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{list.description}</p>
            )}
            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <code className="rounded bg-muted px-1.5 py-0.5">{list.slug}</code>
              <span className="tabular-nums">{list.itemCount.toLocaleString()} active options</span>
              {list.parentList && <span>cascades from {list.parentList.name}</span>}
              <span>
                updated <RelativeTime value={list.updatedAt} />
              </span>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={onExport} disabled={isExporting}>
              {isExporting ? (
                <Loader2 className="size-4 animate-spin" strokeWidth={1.5} />
              ) : (
                <Download className="size-4" strokeWidth={1.5} />
              )}
              Export
            </Button>

            {/* Platform lists are read-only from an organization: the API
                refuses the write, so offering the button would only produce an
                error the user cannot act on. */}
            {!list.isGlobal || scope === 'platform' ? (
              <>
                <Button variant="outline" size="sm" onClick={onEdit}>
                  <Pencil className="size-4" strokeWidth={1.5} />
                  Edit
                </Button>
                <Button size="sm" onClick={onImport}>
                  <Upload className="size-4" strokeWidth={1.5} />
                  Upload CSV
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onDelete}
                  aria-label={`Delete ${list.name}`}
                >
                  <Trash2 className="size-4 text-destructive" strokeWidth={1.5} />
                </Button>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Provided by the platform — read-only here.
              </p>
            )}
          </div>
        </div>

        {exportError && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {exportError.message || 'The export failed.'}
          </p>
        )}
      </Card>

      {/* ── Items ────────────────────────────────────────────────────────── */}
      <Toolbar
        end={
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch
              checked={includeInactive}
              onCheckedChange={toggleRetired}
              aria-label="Show retired options"
            />
            Show retired
          </label>
        }
      >
        <SearchInput
          value={query}
          onChange={search}
          placeholder="Search options…"
          aria-label="Search options in this list"
          className="w-full sm:w-72"
        />
        {isFetching && !isLoading && (
          <Loader2 className="size-4 animate-spin text-muted-foreground" strokeWidth={1.5} />
        )}
      </Toolbar>

      <DataTable
        columns={columns}
        data={data?.items}
        getRowId={(row) => row.id}
        isLoading={isLoading}
        error={error}
        onRetry={() => refetch()}
        caption={`Options in ${list.name}`}
        empty={
          <EmptyState
            icon={BookMarked}
            variant="inline"
            title={query ? `Nothing matches “${query}”` : 'This list is empty'}
            description={
              query
                ? 'Try a shorter search term, or check whether the option was retired.'
                : 'Upload a CSV to fill it. Until then, any dropdown bound to this list will render empty.'
            }
          />
        }
        pagination={{
          page,
          pageSize: PAGE_SIZE,
          total: data?.total ?? 0,
          onPageChange: setPage,
          itemLabel: 'options',
        }}
      />
    </div>
  );
}

function DeleteListDialog({
  scope,
  list,
  onClose,
}: {
  scope: DictionaryScope;
  list: ChoiceListSummary;
  onClose: () => void;
}) {
  const remove = useDeleteList(scope);
  const [error, setError] = React.useState<string | null>(null);

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Delete ${list.name}?`}
      confirmLabel="Delete list"
      isPending={remove.isPending}
      confirmText={list.slug}
      description={
        <>
          Any question drawing its options from{' '}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{list.slug}</code> will
          render an empty dropdown, and saving that form will start failing until the binding is
          changed. Responses already collected keep their stored values but will show bare codes
          instead of labels.
          {error && (
            <span role="alert" className="mt-3 block text-destructive">
              {error}
            </span>
          )}
        </>
      }
      onConfirm={async () => {
        setError(null);
        try {
          await remove.mutateAsync(list.slug);
          onClose();
        } catch (err) {
          setError(err instanceof Error ? err.message : 'That list could not be deleted.');
        }
      }}
    />
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
