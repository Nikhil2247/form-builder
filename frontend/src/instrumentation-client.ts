/**
 * Browser-side instrumentation entry point.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Next runs this after the document loads and *before* React hydrates, which
 * is the only window in which an error reporter can catch a failure during
 * hydration itself — the class of bug that produces a blank page with nothing
 * in the boundary.
 *
 * ── Why a dynamic import instead of a top-level one ────────────────────────
 * A static `import * as Sentry from '@sentry/nextjs'` here would put the
 * browser SDK — tens of kilobytes — into the first-load bundle of every page,
 * including `/f/[id]`, the one page whose audience is a respondent on a phone
 * who did not choose to visit this app. With no DSN configured that would be
 * pure dead weight, forever.
 *
 * Guarding on the literal `process.env.NEXT_PUBLIC_SENTRY_DSN` instead lets
 * Next substitute the value at build time, so with no DSN the condition folds
 * to `if (undefined)`, the minifier drops the branch, and the `import()` inside
 * it never becomes a chunk. Set a DSN and the same code loads the SDK in a
 * separate chunk that does not block hydration.
 */

/**
 * Filled in once the SDK has loaded. `onRouterTransitionStart` fires on the
 * very first client navigation, which can easily beat that; missing the first
 * transition's timing is an acceptable trade for not blocking startup on a
 * network fetch, and every later navigation is instrumented normally.
 */
let captureRouterTransitionStart:
  | ((href: string, navigationType: string) => void)
  | undefined;

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  void import('@sentry/nextjs').then(async (Sentry) => {
    const { commonSentryOptions } = await import('@/lib/sentry');

    Sentry.init({
      ...commonSentryOptions,
      /**
       * Session Replay is not enabled and must not be enabled casually on this
       * product: a replay of the form runner is a frame-by-frame recording of
       * a respondent typing their answers, which is precisely the data
       * `beforeSend` exists to keep out of Sentry. If it is ever wanted, it
       * needs `maskAllText` and `blockAllMedia` on, and a decision from
       * whoever owns the privacy policy — not a default.
       */
      integrations: [],
    });

    captureRouterTransitionStart = Sentry.captureRouterTransitionStart;
  });
}

/**
 * Next hands every client-side navigation to this hook. Sentry uses it to open
 * the navigation span, so it has to be a real export even when the SDK never
 * loads — hence the optional call rather than a conditional export.
 */
export function onRouterTransitionStart(
  url: string,
  navigationType: 'push' | 'replace' | 'traverse',
) {
  captureRouterTransitionStart?.(url, navigationType);
}
