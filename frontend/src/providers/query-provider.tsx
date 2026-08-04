'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useState } from 'react';

export function QueryProvider({ children }: { children: React.ReactNode }) {
  // Setup the query client in state so it doesn't get recreated on every render
  // during React concurrent rendering.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // staleTime: 0 (default) — all queries refetch fresh data on mount.
            // The ONLY exception is useUser() in use-auth.ts which sets its own
            // staleTime: 30 * 60 * 1000 to cache the /auth/me session for 30 minutes.
            staleTime: 0,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
