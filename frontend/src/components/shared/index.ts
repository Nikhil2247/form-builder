/**
 * The shared application kit.
 *
 * Import page-level building blocks from here, not from individual files:
 *   import { PageShell, PageHeader, DataTable, StatusBadge } from '@/components/shared';
 *
 * The split is deliberate:
 *   components/ui/      — unstyled-ish primitives (Base UI wrappers). No app
 *                         knowledge; safe to regenerate from shadcn.
 *   components/shared/  — composed, opinionated app components. These encode
 *                         product decisions (what an empty table looks like,
 *                         how a status maps to a colour) and are hand-owned.
 *   components/<domain>/— feature-specific (builder/, layout/, marketing/).
 */

export { PageHeader, PageShell, type PageHeaderProps, type Breadcrumb } from './page-header';
export { StatusBadge, statusBadgeVariants, type StatusTone } from './status-badge';
export { EmptyState, ErrorState, ForbiddenState } from './empty-state';
export { StatCard, StatGrid, type StatCardProps } from './stat-card';
export {
  DataTable,
  type DataTableColumn,
  type DataTableProps,
  type SortState,
} from './data-table';
export { DataTablePagination, buildPageList } from './data-table-pagination';
export { Modal, ModalActions, ConfirmDialog, type ModalProps } from './modal';
export { Toolbar, SearchInput, FilterSelect } from './toolbar';
export { CopyButton, CopyField } from './copy-button';
export { RelativeTime, FormattedDate, Duration } from './formatters';
export { AuditLogTable, type AuditLogTableProps } from './audit-log-table';
export { ButtonLink, ButtonAnchor, type ButtonLinkProps } from './button-link';
