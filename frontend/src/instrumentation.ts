import type { Instrumentation } from 'next';

/**
 * Server-side instrumentation entry point.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Next calls `register()` once per server instance and `onRequestError` for
 * every error it catches while rendering or handling a request — including the
 * ones a React error boundary never sees, because they happened on the server
 * before any component mounted.
 *
 * ── Everything here is conditional on a DSN ────────────────────────────────
 * `process.env.NEXT_PUBLIC_SENTRY_DSN` is written as a literal rather than
 * imported from `@/lib/sentry` on purpose: Next substitutes the literal at
 * build time, so with no DSN configured these become `if (!undefined) return`
 * and the Sentry SDK is never imported, never initialised, and never prints a
 * startup line. That is the requirement — this project has no Sentry account,
 * and a build that fails or a console that fills up without one would be worse
 * than having no error reporting at all.
 *
 * ── Deliberately NOT wired: source map upload ──────────────────────────────
 * `withSentryConfig` in `next.config.ts` is what uploads source maps and turns
 * minified production stacks back into real file/line pairs. It needs
 * `SENTRY_ORG`, `SENTRY_PROJECT` and a `SENTRY_AUTH_TOKEN`, none of which
 * exist here, and it fails the build loudly when they are missing. Follow-up
 * for whoever creates the Sentry project: add the wrapper and those three
 * variables together, in one change.
 */

export async function register() {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;

  // Two separate SDK builds: the edge runtime has no Node APIs, so it cannot
  // use the server SDK's transport. `NEXT_RUNTIME` is set by Next.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  } else if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

/**
 * Report a server-side render/route/action failure.
 *
 * `captureRequestError` is Sentry's own handler for this hook: it reads the
 * router kind, route path and render source out of `context` and tags the
 * event with them, which is the difference between "something threw in
 * production" and "the RSC render of /f/[id] threw".
 *
 * The dynamic import is what keeps the no-DSN case free; the awaited call is
 * what keeps the report from being dropped when the process is about to exit,
 * as the Next docs require.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;

  const Sentry = await import('@sentry/nextjs');
  Sentry.captureRequestError(err, request, context);
};
