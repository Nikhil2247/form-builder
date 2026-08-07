'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { bootstrapSession } from '@/lib/api';

/**
 * Restores the session on page load.
 *
 * The access token is held only in memory (see lib/api.ts), so a browser
 * refresh loses it. The HttpOnly `refresh_token` cookie survives, and this
 * provider trades it for a new access token exactly once before any data query
 * is allowed to run.
 *
 * Without this gate, every query on first paint would fire without a token,
 * take a 401, and trigger a refresh — a thundering herd on every reload, plus a
 * visible flash of the signed-out state.
 */

interface SessionBootstrapValue {
  /** True once the refresh attempt has settled, whatever the outcome. */
  ready: boolean;
  /** True when boot produced a usable access token. */
  authenticated: boolean;
}

const SessionBootstrapContext = createContext<SessionBootstrapValue>({
  ready: false,
  authenticated: false,
});

export function useSessionBootstrap() {
  return useContext(SessionBootstrapContext);
}

/**
 * Routes that are meaningful to anonymous visitors and must not pay for a
 * refresh round-trip. `/f/*` is the public form runner — respondents are not
 * users of this app and should never hit /auth/refresh.
 */
function isPublicRoute(pathname: string) {
  return pathname.startsWith('/f/');
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const skip = isPublicRoute(pathname);

  const [state, setState] = useState<SessionBootstrapValue>({
    ready: skip,
    authenticated: false,
  });

  useEffect(() => {
    if (skip) {
      setState({ ready: true, authenticated: false });
      return;
    }

    let cancelled = false;
    bootstrapSession()
      .then((ok) => {
        if (!cancelled) setState({ ready: true, authenticated: ok });
      })
      .catch(() => {
        if (!cancelled) setState({ ready: true, authenticated: false });
      });

    return () => {
      cancelled = true;
    };
    // Deliberately runs once per mount. Re-running on navigation would refresh
    // the token on every route change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SessionBootstrapContext.Provider value={state}>
      {children}
    </SessionBootstrapContext.Provider>
  );
}
