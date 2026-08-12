'use client';

import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useState } from 'react';
import { ApiError } from '@/lib/api';
import { toastError } from '@/lib/errors';

/**
 * Opt-out reporting: any query or mutation that fails surfaces to the user
 * unless it says otherwise.
 *
 * The alternative — every call site remembering to catch and toast — was the
 * status quo, and it did not hold. There were 61 mutations against 5 `onError`
 * handlers, with the rest relying on the caller wrapping `mutateAsync` in a
 * try/catch; the ones that forgot failed silently, and the user's click simply
 * did nothing. Reporting by default means a new mutation is loud by
 * construction and has to be deliberately quietened.
 *
 * Double-reporting is not a concern: `toastError` deduplicates on a stable id
 * derived from status + message, so a call site that still catches and reports
 * itself collapses into the same toast rather than stacking a second one.
 *
 * To opt out, pass `meta: { silent: true }`.
 */
type ErrorMeta = {
  /** Suppress the automatic toast — the caller reports this failure itself. */
  silent?: boolean;
  /** Sentence describing what was being attempted, used when the API's message is uninformative. */
  errorFallback?: string;
};

function metaOf(source: { meta?: Record<string, unknown> } | undefined): ErrorMeta {
  return (source?.meta ?? {}) as ErrorMeta;
}

/**
 * A 401 is already handled end to end: `fetchApi` ends the session and
 * `AuthProvider` shows "your session has expired" and routes to /login. A
 * second toast here would be noise on top of a redirect.
 */
function isSessionExpiry(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  // Setup the query client in state so it doesn't get recreated on every render
  // during React concurrent rendering.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({
          onError: (error, query) => {
            if (isSessionExpiry(error)) return;

            const meta = metaOf(query);
            if (meta.silent) return;

            /**
             * Only report when there is already data on screen.
             *
             * With no data, the page is in its error branch and renders
             * `ErrorState` — a headline, the reason, and a Try again button,
             * which is strictly better than a toast and is wired up at ~20
             * sites. Toasting there would duplicate it.
             *
             * With data present this is a background refetch that failed, the
             * page silently keeps showing stale rows, and nothing else in the
             * app would ever tell the user their view is out of date. That is
             * the case a toast is actually for.
             */
            if (query.state.data === undefined) return;

            toastError(error, meta.errorFallback ?? 'Could not refresh this data');
          },
        }),

        mutationCache: new MutationCache({
          onError: (error, _variables, _context, mutation) => {
            if (isSessionExpiry(error)) return;

            const meta = metaOf(mutation.options);
            if (meta.silent) return;

            toastError(error, meta.errorFallback ?? 'Could not complete that action');
          },
        }),

        defaultOptions: {
          queries: {
            // Was 0, which made every query refetch on every mount — navigating
            // between dashboard pages re-fetched forms, org, and submissions
            // each time. 30s is short enough to feel live while removing the
            // redundant round-trips; individual queries override as needed
            // (useUser caches for 30 min, templates for an hour).
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            retry: (failureCount, error) => {
              // Never retry client errors — a 401/403/404/422 will not fix
              // itself, and retrying just delays the error the user needs.
              if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
                return false;
              }
              return failureCount < 2;
            },
          },
          mutations: {
            retry: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {/* Devtools were previously shipped to production, adding weight and
          exposing query internals to end users. */}
      {process.env.NODE_ENV === 'development' && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}
