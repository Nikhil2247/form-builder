'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useState } from 'react';
import { ApiError } from '@/lib/api';

export function QueryProvider({ children }: { children: React.ReactNode }) {
  // Setup the query client in state so it doesn't get recreated on every render
  // during React concurrent rendering.
  const [queryClient] = useState(
    () =>
      new QueryClient({
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
