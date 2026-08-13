'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { fetchApi, unwrap } from '@/lib/api';
import { API_BASE_URL } from '@/lib/config';
import { useUser } from './use-auth';

/**
 * In-app notifications: the list, the badge, and the live stream.
 *
 * Mirrors `src/modules/notifications` on the API. The row shape here is exactly
 * what both `GET /notifications` and the SSE `notification` event send —
 * deliberately the same object on both paths, because a live push that renders
 * differently from the same row after a refresh is a bug nobody reports and
 * everybody notices.
 */

export interface AppNotification {
  id: string;
  /** e.g. "new_submission" | "member_joined" | "webhook_failed" | "quota_warning" */
  type: string;
  title: string;
  body: string | null;
  /** Deep-link context. `href`, when present, is an in-app path. */
  metadata: Record<string, unknown> | null;
  isRead: boolean;
  createdAt: string;
}

export interface NotificationsPage {
  notifications: AppNotification[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
  unreadCount: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Query keys
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One root so a single `invalidateQueries` covers the list and the badge, and
 * one nested `list` segment so the stream can find just the pages when it needs
 * to prepend without touching the count.
 */
const ROOT_KEY = ['notifications'] as const;
const LIST_KEY = ['notifications', 'list'] as const;
const UNREAD_KEY = ['notifications', 'unread-count'] as const;

interface ListParams {
  page: number;
  limit: number;
  unreadOnly: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

export function useNotifications(params: Partial<ListParams> = {}) {
  const { page = 1, limit = 12, unreadOnly = false } = params;
  const { data: session } = useUser();

  return useQuery<NotificationsPage>({
    queryKey: [...LIST_KEY, { page, limit, unreadOnly }],
    queryFn: async () => {
      const search = new URLSearchParams({ page: String(page), limit: String(limit) });
      // Sent only when true. `unreadOnly=false` is the default server-side, and
      // omitting it keeps the cache key and the request in step.
      if (unreadOnly) search.set('unreadOnly', 'true');

      return unwrap<NotificationsPage>(await fetchApi(`/notifications?${search.toString()}`));
    },
    // Every route here is scoped to the signed-in user, so there is nothing to
    // ask for until there is a session.
    enabled: !!session?.user?.id,
  });
}

/**
 * Just the badge number.
 *
 * `refetchInterval` is the FALLBACK, not the mechanism: the stream is what
 * makes the badge live. It exists because an EventSource can be blocked by a
 * corporate proxy, an ad blocker, or a browser that has hit its per-origin
 * connection limit, and a badge that is permanently wrong in those environments
 * is worse than one that is a minute stale. Two minutes is cheap — it is an
 * indexed COUNT — and `refetchIntervalInBackground` is left off so a
 * backgrounded tab costs nothing.
 */
export function useUnreadNotificationCount() {
  const { data: session } = useUser();

  return useQuery<{ unreadCount: number }>({
    queryKey: UNREAD_KEY,
    queryFn: async () => unwrap<{ unreadCount: number }>(await fetchApi('/notifications/unread-count')),
    enabled: !!session?.user?.id,
    staleTime: 30_000,
    refetchInterval: 120_000,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Each mutation returns the authoritative `unreadCount` from the API, which is
 * written straight into the badge's cache. Recomputing it on the client from
 * the page currently on screen would be wrong the moment the user is on page 2,
 * or has the unread filter on, or has another tab open.
 */
function applyUnreadCount(queryClient: QueryClient, result: unknown) {
  const count = (result as { unreadCount?: number } | null)?.unreadCount;
  if (typeof count === 'number') {
    queryClient.setQueryData(UNREAD_KEY, { unreadCount: count });
  }
  queryClient.invalidateQueries({ queryKey: LIST_KEY });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: { errorFallback: 'Could not mark that notification as read' },
    mutationFn: async (id: string) =>
      unwrap<{ unreadCount: number }>(
        await fetchApi(`/notifications/${id}/read`, { method: 'POST' }),
      ),
    onSuccess: (result) => applyUnreadCount(queryClient, result),
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: { errorFallback: 'Could not mark your notifications as read' },
    mutationFn: async () =>
      unwrap<{ markedRead: number; unreadCount: number }>(
        await fetchApi('/notifications/read-all', { method: 'POST' }),
      ),
    onSuccess: (result) => applyUnreadCount(queryClient, result),
  });
}

export function useDeleteNotification() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: { errorFallback: 'Could not dismiss that notification' },
    mutationFn: async (id: string) =>
      unwrap<{ unreadCount: number }>(await fetchApi(`/notifications/${id}`, { method: 'DELETE' })),
    onSuccess: (result) => applyUnreadCount(queryClient, result),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Live stream
// ─────────────────────────────────────────────────────────────────────────────

/** Backoff bounds for reconnecting. */
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 30_000;

/**
 * Fold a pushed notification into the cache.
 *
 * Prepend AND mark stale, which sounds redundant but is not:
 *
 *  • The prepend is what the user sees. It puts the row at the top of any list
 *    already on screen with no request and no loading state.
 *  • `refetchType: 'none'` marks every notification query stale without
 *    refetching any of them. The prepend is only correct for page 1 — pages 2+
 *    have all shifted down by one row and would show a duplicate at the
 *    boundary — so those pages must not be trusted again without a round trip,
 *    but there is no reason to spend that round trip on a page nobody is
 *    looking at. It happens when they navigate back to it.
 *
 * Refetching everything on each push instead would be simpler and would put a
 * request on the wire for every notification, on every open tab.
 */
function prependNotification(queryClient: QueryClient, push: AppNotification) {
  for (const query of queryClient.getQueryCache().findAll({ queryKey: LIST_KEY })) {
    const params = query.queryKey[2] as ListParams | undefined;
    if (!params || params.page !== 1) continue;

    queryClient.setQueryData<NotificationsPage>(query.queryKey, (previous) => {
      if (!previous) return previous;
      // A push can arrive for a row the list already has — a refetch that
      // landed between the publish and this callback, or a second tab that
      // already reconciled. Keyed on id rather than assuming it is new.
      if (previous.notifications.some((n) => n.id === push.id)) return previous;

      return {
        ...previous,
        notifications: [push, ...previous.notifications].slice(0, previous.pagination.limit),
        pagination: { ...previous.pagination, total: previous.pagination.total + 1 },
        unreadCount: previous.unreadCount + 1,
      };
    });
  }

  queryClient.setQueryData<{ unreadCount: number }>(UNREAD_KEY, (previous) => ({
    unreadCount: (previous?.unreadCount ?? 0) + 1,
  }));

  queryClient.invalidateQueries({ queryKey: ROOT_KEY, refetchType: 'none' });
}

/**
 * Subscribe to the server's notification stream.
 *
 * MOUNT THIS ONCE. It is called from the dashboard header, which renders
 * exactly one instance per app shell. Calling it from a page as well would open
 * a second EventSource for the same user, double every toast, and spend two of
 * the six stream slots the API allows per user.
 *
 * ── Why the connection is re-established by hand ───────────────────────────
 * `EventSource` reconnects on its own, and that is precisely the problem here:
 * it retries THE SAME URL, and this URL carries a single-use ticket that was
 * spent the instant the first connection was accepted. Its built-in retry would
 * therefore loop on 401s forever, at whatever interval it feels like, with no
 * backoff we control. So every error closes the source outright — which is what
 * stops the built-in retry — and a fresh ticket is minted for each attempt.
 *
 * ── Cleanup ────────────────────────────────────────────────────────────────
 * The effect's teardown closes the source and clears the pending retry timer,
 * and `cancelled` guards the async gap between minting a ticket and opening the
 * connection. Without that guard, an unmount during the mint leaves a
 * connection that nothing holds a reference to and nothing will ever close.
 */
export function useNotificationStream() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { data: session } = useUser();
  const userId = session?.user?.id;

  // Held in a ref so navigating does not tear down and rebuild the connection.
  // `useRouter`'s identity is stable in the App Router, but depending on it
  // here would make that an assumption the stream's lifetime rests on.
  const routerRef = useRef(router);
  routerRef.current = router;

  useEffect(() => {
    if (!userId) return;
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;

    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let cancelled = false;

    const scheduleReconnect = () => {
      if (cancelled) return;
      attempt += 1;
      const ceiling = Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), RETRY_MAX_MS);
      // Full jitter. Without it, every client that was connected to a pod when
      // it restarted comes back at the same instant, which is how a routine
      // deploy turns into a thundering herd against the ticket endpoint.
      const delay = Math.round(ceiling * (0.5 + Math.random() * 0.5));
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void connect();
      }, delay);
    };

    const connect = async () => {
      if (cancelled) return;

      let ticket: string;
      try {
        const minted = unwrap<{ ticket: string }>(
          await fetchApi('/notifications/stream-ticket', { method: 'POST' }),
        );
        ticket = minted.ticket;
      } catch {
        // Silent. A failed mint is either "signed out" — in which case
        // AuthProvider is already handling it — or a transient API blip, and a
        // toast on every reconnect attempt would be worse than no live
        // notifications. The list and the polled badge still work.
        scheduleReconnect();
        return;
      }

      if (cancelled) return;

      const opened = new EventSource(
        `${API_BASE_URL}/notifications/stream?ticket=${encodeURIComponent(ticket)}`,
        // Deliberately NOT { withCredentials: true }: the ticket authenticates
        // this connection, so sending cookies would add nothing and would put
        // the stream on the stricter credentialed-CORS path for no benefit.
      );
      source = opened;

      opened.addEventListener('ready', () => {
        // Only a connection the server actually accepted resets the backoff.
        // Resetting on open would restart the ladder on a connection that is
        // about to be rejected, and turn a persistent failure into a tight loop.
        attempt = 0;
      });

      opened.addEventListener('notification', (event) => {
        try {
          const push = JSON.parse((event as MessageEvent).data) as AppNotification;
          prependNotification(queryClient, push);
          toast(push.title, {
            // Keyed on the notification id so the same push arriving twice —
            // two tabs, or a reconnect that overlaps — collapses into one toast
            // instead of stacking.
            id: `notification-${push.id}`,
            description: push.body ?? undefined,
            action: {
              label: 'View',
              onClick: () => routerRef.current.push('/notifications'),
            },
          });
        } catch {
          // A frame we cannot parse is not worth breaking the stream over.
        }
      });

      opened.onerror = () => {
        // Covers both failure and the server ending the stream at its lifetime
        // cap — from here they look identical, and the response to both is the
        // same: close, and come back with a new ticket.
        opened.close();
        if (source === opened) source = null;
        scheduleReconnect();
      };
    };

    void connect();

    return () => {
      cancelled = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      // `close()` is what releases the server's slot: it ends the request, the
      // socket emits 'close', and Nest unsubscribes the observable, which runs
      // the Redis unsubscribe and frees the stream slot. Skipping it here is
      // the classic SSE leak — one abandoned connection per navigation.
      source?.close();
      source = null;
    };
  }, [userId, queryClient]);
}
