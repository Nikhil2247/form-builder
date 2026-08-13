'use client';

import React from 'react';
import Link from 'next/link';
import { Bell, Check, FileText, Gauge, Mail, UserPlus, Webhook, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader, PageShell } from '@/components/shared/page-header';
import { EmptyState, ErrorState } from '@/components/shared/empty-state';
import { RelativeTime } from '@/components/shared/formatters';
import { DataTablePagination } from '@/components/shared/data-table-pagination';
import { ButtonLink } from '@/components/shared/button-link';
import { usePagination } from '@/hooks/use-pagination';
import {
  useNotifications,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useDeleteNotification,
  type AppNotification,
} from '@/hooks/use-notifications';

/**
 * Notifications.
 *
 * ── The rule this page was rebuilt under ───────────────────────────────────
 * This page once rendered three hardcoded entries — "Sarah joined your
 * organization as an Editor", a submission on a form that may not exist —
 * presented as if they were real, because there was no notifications API to
 * read from. Fabricated activity is worse than an empty page: a user acts on
 * it. When it was replaced, the replacement was an honest empty state.
 *
 * There is now a real API behind it (`/notifications`), so this reads that.
 * The principle is unchanged and load-bearing: everything below is rendered
 * from rows the server returned. When there are none, the empty state says so
 * plainly and points at the notification channel that does work — nothing is
 * invented to fill the space, and there is no placeholder or demo mode.
 *
 * Loading and error are also kept distinct from empty, for the same reason:
 * "we could not reach the API" must never look like "you have no notifications".
 */

/**
 * Icon per notification type.
 *
 * `type` is a free-form VarChar on the API side, so an unknown value is
 * expected — a notification written by a newer server than this build — and
 * falls back to the bell rather than rendering nothing.
 */
const TYPE_ICONS: Record<string, React.ElementType> = {
  new_submission: FileText,
  member_joined: UserPlus,
  webhook_failed: Webhook,
  quota_warning: Gauge,
};

/** The two types that report a problem get the warning treatment. */
const ALERT_TYPES = new Set(['webhook_failed', 'quota_warning']);

/** `metadata.href` is written by the API as an in-app path. Anything else is ignored. */
function internalHref(notification: AppNotification): string | null {
  const href = notification.metadata?.href;
  // Must be a same-origin absolute path. A `//evil.com` or `https://…` value
  // would be an open redirect if it were passed straight to <Link>.
  if (typeof href !== 'string' || !href.startsWith('/') || href.startsWith('//')) return null;
  return href;
}

export default function NotificationsPage() {
  const pager = usePagination({ filterKeys: ['filter'] });
  const unreadOnly = pager.filters.filter === 'unread';

  const { data, isLoading, isFetching, error, refetch } = useNotifications({
    page: pager.page,
    limit: pager.pageSize,
    unreadOnly,
  });

  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const dismiss = useDeleteNotification();

  const notifications = data?.notifications ?? [];
  const unreadCount = data?.unreadCount ?? 0;
  const total = data?.pagination?.total ?? 0;

  return (
    <PageShell width="narrow">
      <PageHeader
        title="Notifications"
        description="Alerts about your forms and organization."
        actions={
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            // Disabled on zero rather than hidden: a button that appears and
            // disappears as the count changes moves the rest of the header.
            disabled={unreadCount === 0 || markAllRead.isPending}
            onClick={() => markAllRead.mutate()}
          >
            <Check className="size-3.5" strokeWidth={1.5} />
            {markAllRead.isPending ? 'Marking…' : 'Mark all read'}
          </Button>
        }
      >
        <div className="flex items-center gap-1.5" role="group" aria-label="Filter notifications">
          <FilterTab
            active={!unreadOnly}
            onClick={() => pager.setFilter('filter', null)}
            label="All"
          />
          <FilterTab
            active={unreadOnly}
            onClick={() => pager.setFilter('filter', 'unread')}
            label={unreadCount > 0 ? `Unread (${unreadCount})` : 'Unread'}
          />
        </div>
      </PageHeader>

      {error ? (
        <ErrorState
          title="Could not load your notifications"
          error={error}
          onRetry={() => refetch()}
        />
      ) : isLoading ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading notifications">
          {[0, 1, 2].map((row) => (
            <Card key={row} className="flex items-start gap-3 p-4">
              <Skeleton className="size-8 shrink-0 rounded-md" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </Card>
          ))}
        </div>
      ) : notifications.length === 0 ? (
        // Genuinely empty. Two different empty states, because "you have read
        // everything" and "nothing has ever happened" call for different words
        // and different actions.
        unreadOnly ? (
          <EmptyState
            icon={Check}
            title="You are all caught up"
            description="Every notification has been read."
            action={
              <Button variant="outline" size="sm" onClick={() => pager.setFilter('filter', null)}>
                Show all notifications
              </Button>
            }
          />
        ) : (
          <>
            <EmptyState
              icon={Bell}
              title="No notifications yet"
              description="You will be notified here when a form receives a response, when someone joins your organization, when a webhook stops delivering, and when your monthly submission allowance runs low."
            />

            <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
              <div className="flex items-start gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <Mail className="size-4" strokeWidth={1.5} />
                </span>
                <div>
                  <h2 className="text-sm font-medium">Email notifications</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Each form can also email a list of recipients whenever it receives a response.
                    Configure the recipients in that form&apos;s settings.
                  </p>
                </div>
              </div>
              <ButtonLink variant="outline" size="sm" href="/forms">
                Go to forms
              </ButtonLink>
            </Card>
          </>
        )
      ) : (
        <>
          <ul className={cn('space-y-2', isFetching && 'opacity-70 transition-opacity')}>
            {notifications.map((notification) => (
              <NotificationRow
                key={notification.id}
                notification={notification}
                onMarkRead={() => markRead.mutate(notification.id)}
                onDismiss={() => dismiss.mutate(notification.id)}
                isDismissing={dismiss.isPending && dismiss.variables === notification.id}
              />
            ))}
          </ul>

          <DataTablePagination
            page={pager.page}
            pageSize={pager.pageSize}
            total={total}
            itemLabel="notifications"
            isLoading={isFetching}
            onPageChange={pager.setPage}
            onPageSizeChange={pager.setPageSize}
          />
        </>
      )}
    </PageShell>
  );
}

function FilterTab({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-md px-2.5 py-1 text-sm transition-colors',
        active
          ? 'bg-muted font-medium text-foreground'
          : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
      )}
    >
      {label}
    </button>
  );
}

function NotificationRow({
  notification,
  onMarkRead,
  onDismiss,
  isDismissing,
}: {
  notification: AppNotification;
  onMarkRead: () => void;
  onDismiss: () => void;
  isDismissing: boolean;
}) {
  const Icon = TYPE_ICONS[notification.type] ?? Bell;
  const isAlert = ALERT_TYPES.has(notification.type);
  const href = internalHref(notification);

  const title = href ? (
    <Link
      href={href}
      // Following the link is the user acting on the notification, so it is
      // also the moment it stops being unread.
      onClick={() => {
        if (!notification.isRead) onMarkRead();
      }}
      className="rounded-sm hover:underline"
    >
      {notification.title}
    </Link>
  ) : (
    notification.title
  );

  return (
    <li>
      <Card
        className={cn(
          'flex items-start gap-3 p-4',
          // Unread is carried by a background tint AND the dot below, never by
          // colour alone.
          !notification.isRead && 'bg-accent/40',
        )}
      >
        <span
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-md',
            isAlert ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground',
          )}
        >
          <Icon className="size-4" strokeWidth={1.5} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <h2 className="text-sm font-medium text-foreground">{title}</h2>
            {!notification.isRead && (
              <span
                className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary"
                aria-label="Unread"
              />
            )}
          </div>
          {notification.body && (
            <p className="mt-1 text-sm text-muted-foreground">{notification.body}</p>
          )}
          <RelativeTime value={notification.createdAt} className="mt-1.5 block text-xs text-muted-foreground" />
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {!notification.isRead && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Mark as read"
              title="Mark as read"
              onClick={onMarkRead}
            >
              <Check className="size-3.5" strokeWidth={1.5} />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Dismiss"
            title="Dismiss"
            disabled={isDismissing}
            onClick={onDismiss}
          >
            <X className="size-3.5" strokeWidth={1.5} />
          </Button>
        </div>
      </Card>
    </li>
  );
}
