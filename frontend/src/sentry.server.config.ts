import * as Sentry from '@sentry/nextjs';

import { commonSentryOptions } from '@/lib/sentry';

/**
 * Sentry for the Node.js runtime — server components, route handlers, server
 * actions, and anything `instrumentation.ts` reports through `onRequestError`.
 *
 * This module is only ever reached through a guarded dynamic `import()` in
 * `src/instrumentation.ts`, so its mere existence costs nothing when
 * `NEXT_PUBLIC_SENTRY_DSN` is unset. See `src/lib/sentry.ts` for why the
 * scrubbing in `commonSentryOptions` is not optional on this product.
 *
 * The default integrations are left alone deliberately. Two of them
 * (`requestDataIntegration`, `httpIntegration`) are the ones that would attach
 * bodies and headers, and both already honour `sendDefaultPii: false`;
 * `scrubEvent` is the second gate behind them rather than a replacement.
 */
Sentry.init({
  ...commonSentryOptions,
});
