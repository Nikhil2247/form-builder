import * as Sentry from '@sentry/nextjs';

import { commonSentryOptions } from '@/lib/sentry';

/**
 * Sentry for the edge runtime — which in this app means one thing:
 * `src/proxy.ts`, the session gate and the CSP nonce mint. Nothing else runs
 * on the edge here.
 *
 * It is a separate SDK build because the edge runtime has no Node APIs, so it
 * cannot share the server SDK's transport or integrations. Same options, same
 * scrubbing, same "only imported when a DSN exists" guard in
 * `src/instrumentation.ts`.
 */
Sentry.init({
  ...commonSentryOptions,
});
