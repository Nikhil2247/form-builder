'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { bootstrapSession, onSessionExpired } from '@/lib/api';

/**
 * Session lifecycle for the whole app.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Two jobs, and it is worth being precise about why each exists.
 *
 * ── 1. Recover the session on a cold load ─────────────────────────────────
 * The access token lives in memory only (see lib/api.ts) and dies with the
 * page, so after a reload — or in a second tab — the app starts with nothing.
 * `bootstrapSession()` exchanges the refresh cookie for a token ONCE, and the
 * token it gets back expires when the session already did, so this recovers a
 * session without ever extending one. A user who signed in at 09:00 is signed
 * out at 09:00 the next day however many times they reloaded in between.
 *
 * Nothing else calls it. There is no interval, no refetch, no retry-on-401 —
 * the API is asked about the session exactly once per page load, and only when
 * there is no token in memory to begin with.
 *
 * `ready` gates that: `useUser` holds /auth/me until the exchange settles, so
 * the app makes one call and not two, and never asks with a token it was about
 * to be handed.
 *
 * ── 2. Log the user out the moment the session ends ───────────────────────
 * When a session that WAS valid ends on its own — `exp` reached while the tab
 * sits open, or the API rejects the token — every cached query is dropped and
 * the user is sent to /login with an explanation, from wherever they are.
 * Without this a page with no RoleGuard (profile, notifications) would keep
 * rendering stale, unusable data instead of visibly signing out.
 */

interface SessionBootstrapValue {
  /** False until the one-shot refresh exchange has settled. */
  ready: boolean;
}

const SessionBootstrapContext = createContext<SessionBootstrapValue>({ ready: false });

export function useSessionBootstrap() {
  return useContext(SessionBootstrapContext);
}

/**
 * Public runners: respondents here are not app users. They must never be
 * bounced to a login screen because some previous tab's session expired, and
 * their page load must not cost an auth round trip — these are the highest
 * traffic routes in the product and nothing on them is personalised.
 */
function isPublicRunner(pathname: string) {
  return pathname.startsWith('/f/') || pathname.startsWith('/a/');
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();

  // Seeded from the first pathname this mounts at. A respondent on /f/... is
  // `ready` immediately with no session, which is the correct answer for them.
  const [ready, setReady] = useState(() => isPublicRunner(pathname));

  useEffect(() => {
    if (ready) return;

    let cancelled = false;
    // `bootstrapSession` de-duplicates internally, so a re-run of this effect
    // (StrictMode's double mount, for one) cannot produce a second request.
    bootstrapSession().finally(() => {
      if (!cancelled) setReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [ready]);

  useEffect(() => {
    return onSessionExpired(() => {
      // Wipe everything, not just the user — leaving forms, submissions and
      // member lists cached means whoever signs in next on this tab briefly
      // sees the previous session's data.
      queryClient.clear();

      if (isPublicRunner(pathname) || pathname.startsWith('/login')) return;

      toast.error('Your session has expired', {
        description: 'Please sign in again to continue.',
      });
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    });
    // Re-subscribing when `pathname` changes keeps the closure current
    // without a ref; the listener set is tiny and this effect is cheap.
  }, [queryClient, router, pathname]);

  return (
    <SessionBootstrapContext.Provider value={{ ready }}>
      {children}
    </SessionBootstrapContext.Provider>
  );
}
