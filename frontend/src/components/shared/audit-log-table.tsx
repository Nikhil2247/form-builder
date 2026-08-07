'use client';

import React from 'react';
import { ClipboardList } from 'lucide-react';
import { DataTable, type DataTableColumn } from './data-table';
import { EmptyState } from './empty-state';
import { StatusBadge, type StatusTone } from './status-badge';
import { FormattedDate } from './formatters';
import type { AuditLog } from '@/hooks/use-audit';

/**
 * Shared audit log table.
 *
 * The organization and platform audit pages were near-identical copies that had
 * drifted: one rendered `metadata` with `JSON.stringify` inline (blowing the
 * row height out to 40 lines for a bulk operation), the other omitted the actor
 * entirely so every entry read as if it had happened by itself.
 */

/** Tone by action verb, so destructive events stand out in a long list. */
function toneForAction(action: string): StatusTone {
  const verb = action.toLowerCase();
  if (/(delete|remove|revoke|suspend|purge|fail)/.test(verb)) return 'danger';
  if (/(create|invite|publish|activate|restore|accept)/.test(verb)) return 'success';
  if (/(update|change|rotate|edit)/.test(verb)) return 'info';
  return 'neutral';
}

function actorName(log: AuditLog): string {
  const user = (log as any).user ?? (log as any).actor;
  if (!user) return 'System';
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ');
  return name || user.email || 'Unknown user';
}

export interface AuditLogTableProps {
  logs: AuditLog[] | undefined;
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  pagination?: React.ComponentProps<typeof DataTable>['pagination'];
  /** Adds the organization column — platform-level views only. */
  showOrganization?: boolean;
  toolbar?: React.ReactNode;
}

export function AuditLogTable({
  logs,
  isLoading,
  error,
  onRetry,
  pagination,
  showOrganization,
  toolbar,
}: AuditLogTableProps) {
  const columns: DataTableColumn<AuditLog>[] = [
    {
      id: 'createdAt',
      header: 'When',
      width: 'w-44',
      cell: (log) => (
        <span className="text-muted-foreground">
          <FormattedDate value={log.createdAt} pattern="d MMM yyyy, HH:mm:ss" />
        </span>
      ),
    },
    {
      id: 'action',
      header: 'Action',
      width: 'w-52',
      isRowHeader: true,
      cell: (log) => <StatusBadge status={log.action} tone={toneForAction(log.action)} />,
    },
    {
      id: 'actor',
      header: 'By',
      width: 'w-48',
      hideBelow: 'md',
      cell: (log) => <span className="truncate">{actorName(log)}</span>,
    },
    ...(showOrganization
      ? [
          {
            id: 'organization',
            header: 'Organization',
            width: 'w-48',
            hideBelow: 'lg',
            cell: (log: AuditLog) => (
              <span className="truncate text-muted-foreground">
                {log.organization?.name ?? '—'}
              </span>
            ),
          } satisfies DataTableColumn<AuditLog>,
        ]
      : []),
    {
      id: 'resource',
      header: 'Resource',
      className: 'max-w-0',
      cell: (log) => (
        <div className="min-w-0">
          <div className="truncate">{log.resource}</div>
          {log.resourceId && (
            <div className="truncate font-mono text-xs text-muted-foreground">{log.resourceId}</div>
          )}
        </div>
      ),
    },
    {
      id: 'metadata',
      header: 'Details',
      className: 'max-w-0',
      hideBelow: 'xl',
      cell: (log) => <MetadataCell metadata={log.metadata} />,
    },
  ];

  return (
    <DataTable
      caption="Audit log"
      columns={columns}
      data={logs}
      getRowId={(log) => log.id}
      isLoading={isLoading}
      error={error}
      onRetry={onRetry}
      pagination={pagination}
      toolbar={toolbar}
      empty={
        <EmptyState
          variant="inline"
          icon={ClipboardList}
          title="No activity recorded"
          description="Actions taken in this workspace will be logged here."
        />
      }
    />
  );
}

/**
 * Metadata is free-form JSON. Rendering it raw made rows unreadable; this shows
 * the first few key/value pairs and keeps the rest in the title attribute.
 */
function MetadataCell({ metadata }: { metadata: unknown }) {
  if (!metadata || typeof metadata !== 'object') {
    return <span className="text-muted-foreground">—</span>;
  }

  const entries = Object.entries(metadata as Record<string, unknown>);
  if (entries.length === 0) return <span className="text-muted-foreground">—</span>;

  const shown = entries.slice(0, 3);

  return (
    <span
      className="flex flex-wrap gap-1"
      title={JSON.stringify(metadata, null, 2)}
    >
      {shown.map(([key, value]) => (
        <span
          key={key}
          className="max-w-40 truncate rounded border border-border bg-muted/50 px-1.5 py-0.5 text-xs"
        >
          <span className="text-muted-foreground">{key}:</span>{' '}
          {typeof value === 'object' ? '…' : String(value)}
        </span>
      ))}
      {entries.length > shown.length && (
        <span className="text-xs text-muted-foreground">+{entries.length - shown.length}</span>
      )}
    </span>
  );
}
