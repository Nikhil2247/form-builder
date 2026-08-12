'use client';

import React from 'react';
import Link from 'next/link';
import {
  Boxes,
  ExternalLink,
  LayoutGrid,
  MoreHorizontal,
  Plus,
  Settings2,
  Smartphone,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

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
  ButtonLink,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  PageHeader,
  PageShell,
  StatusBadge,
} from '@/components/shared';
import { Can } from '@/components/auth/RoleGuard';
import { DataAppsDisabled } from '@/components/apps/DataAppsGate';
import { FEATURES, useFeature } from '@/hooks/use-features';
import { usePermissions } from '@/hooks/use-auth';
import { useDeleteFormApp, useFormApps, type FormApp } from '@/hooks/use-form-apps';

/**
 * Every data-entry app in the organization.
 *
 * Cards rather than a table: an app is a destination a field worker opens
 * repeatedly, so it wants a large, recognisable target, not a dense row.
 */
export default function AppsPage() {
  const appsEnabled = useFeature(FEATURES.FORM_APPS);
  const { data: apps, isLoading, error, refetch } = useFormApps({ enabled: appsEnabled });

  const [deleteTarget, setDeleteTarget] = React.useState<FormApp | null>(null);
  const deleteApp = useDeleteFormApp();

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteApp.mutateAsync(deleteTarget.id);
      toast.success(`Deleted "${deleteTarget.name}"`);
      setDeleteTarget(null);
    } catch {
      // Reported globally; the dialog stays open so the action can be retried.
    }
  }

  if (!appsEnabled) return <DataAppsDisabled title="Apps" />;

  return (
    <PageShell>
      <PageHeader
        title="Apps"
        description="Data-entry apps over your record types."
        actions={
          <Can permission="form:create">
            <ButtonLink size="sm" className="gap-2" href="/apps/builder">
              <Plus className="size-4" /> New app
            </ButtonLink>
          </Can>
        }
      />

      {error ? (
        <ErrorState title="Could not load your apps" error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : !apps || apps.length === 0 ? (
        <EmptyState
          icon={LayoutGrid}
          title="No apps yet"
          description="An app bundles a record type with the forms your team fills against it — a registration form and everything that attaches to a record afterwards."
          action={
            <Can
              permission="form:create"
              fallback={
                <span className="text-xs text-muted-foreground">
                  Ask an editor in this organization to set one up.
                </span>
              }
            >
              <ButtonLink size="sm" className="gap-2" href="/apps/builder">
                <Plus className="size-4" /> Create an app
              </ButtonLink>
            </Can>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {apps.map((app) => (
            <AppCard key={app.id} app={app} onDelete={setDeleteTarget} />
          ))}
        </div>
      )}

      {/* Apps have no trash screen — unlike a form, a deleted app cannot be
          restored from the dashboard — so the copy says what actually survives
          rather than implying a recovery path that does not exist. */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete app"
        description={
          <>
            &ldquo;{deleteTarget?.name}&rdquo; will be removed from your apps list and its public
            link will stop working. The records and submissions already collected are kept, and the
            forms behind its steps are not deleted. There is no restore screen for apps.
          </>
        }
        confirmLabel="Delete app"
        onConfirm={handleDelete}
        isPending={deleteApp.isPending}
      />
    </PageShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * The card's overflow menu.
 *
 * Delete is gated on `org:manage` rather than `form:delete`, because the API
 * requires an organization ADMIN for this route. Gating on the editor
 * permission would render a button that always 403s.
 */
function AppActions({ app, onDelete }: { app: FormApp; onDelete: (app: FormApp) => void }) {
  const { can } = usePermissions();

  const canConfigure = can('form:create');
  const canDelete = can('org:manage');
  if (!canConfigure && !canDelete) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Actions for ${app.name}`}
        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canConfigure && (
          // Base UI composes via `render`, not Radix's `asChild`.
          <DropdownMenuItem
            render={<Link href={`/apps/builder?id=${app.id}`} />}
            className="cursor-pointer"
          >
            <Settings2 className="mr-2 size-3.5" /> Configure
          </DropdownMenuItem>
        )}
        {app.publicSlug && app.isPublished && (
          <DropdownMenuItem
            render={<a href={`/a/${app.publicSlug}`} target="_blank" rel="noreferrer" />}
            className="cursor-pointer"
          >
            <ExternalLink className="mr-2 size-3.5" /> Open public link
          </DropdownMenuItem>
        )}
        {canDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onDelete(app)}
              className="cursor-pointer text-destructive focus:bg-destructive/10 focus:text-destructive"
            >
              <Trash2 className="mr-2 size-3.5" /> Delete app
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AppCard({ app, onDelete }: { app: FormApp; onDelete: (app: FormApp) => void }) {
  return (
    <Card className="flex min-h-44 flex-col justify-between p-4 transition-colors hover:border-border-strong">
      <div className="min-w-0">
        <div className="mb-3 flex items-start justify-between gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            {/* `icon` is an author-supplied emoji or short label, not a component. */}
            {app.icon ? (
              <span aria-hidden className="text-sm leading-none">
                {app.icon}
              </span>
            ) : (
              <Smartphone className="size-4" strokeWidth={1.5} />
            )}
          </span>
          <div className="flex items-center gap-1.5">
            <StatusBadge
              status={app.isPublished ? 'PUBLISHED' : 'DRAFT'}
              label={app.isPublished ? 'Live' : 'Draft'}
              dot
            />
            <AppActions app={app} onDelete={onDelete} />
          </div>
        </div>

        <Link href={`/apps/${app.id}`} className="block rounded-sm">
          <h3 className="line-clamp-2 text-sm font-medium text-foreground hover:underline">
            {app.name}
          </h3>
        </Link>
        {app.description && (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{app.description}</p>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
        <span className="flex min-w-0 items-center gap-1.5">
          <Boxes className="size-3 shrink-0" />
          <span className="truncate">{app.subjectType?.name ?? 'No record type'}</span>
        </span>
      </div>
    </Card>
  );
}
