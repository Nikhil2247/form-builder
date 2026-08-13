import type React from 'react';

/**
 * The two ways a client-side error reaches Sentry.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Both live here rather than at the call sites so the DSN guard is written
 * once. That guard is the whole trick: `process.env.NEXT_PUBLIC_SENTRY_DSN` is
 * substituted by Next at build time, so with no DSN configured — which is this
 * project's normal state — the condition folds to a constant, the minifier
 * drops the branch, and the `import('@sentry/nextjs')` inside it never becomes
 * a chunk anyone downloads. Neither call site changes behaviour: they still
 * log to the console exactly as before, and the UI they render is untouched.
 *
 * Everything is fire-and-forget. An error boundary is already the bad path;
 * awaiting a network round trip inside one would turn a recoverable render
 * failure into a visibly stalled UI.
 */

/**
 * A crash caught by a React error boundary.
 *
 * `captureReactException` is used rather than a plain `captureException`
 * because it attaches the component stack, which is the only thing that says
 * *where* in the tree the throw came from — a React stack trace on its own
 * points at the reconciler.
 */
export function captureBoundaryError(error: Error, info: React.ErrorInfo): void {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;

  void import('@sentry/nextjs').then((Sentry) => {
    Sentry.captureReactException(error, info);
  });
}

/**
 * A crash caught by an App Router `error.tsx` segment.
 *
 * The `digest` is the hash Next assigns to a server-side error before
 * replacing its message with a generic one. Tagging with it is what lets
 * someone paste the "Error ID" a user read off the screen into Sentry search
 * and land on the server event that actually has the message and stack.
 */
export function captureSegmentError(error: Error & { digest?: string }): void {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;

  void import('@sentry/nextjs').then((Sentry) => {
    Sentry.captureException(error, {
      tags: { 'next.digest': error.digest ?? 'none' },
    });
  });
}
