import type { ErrorEvent } from '@sentry/nextjs';

/**
 * Sentry options and PII scrubbing, shared by the browser, Node and edge SDKs.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why a form product cannot use Sentry's defaults ────────────────────────
 * Most apps send Sentry a request body and lose, at worst, a settings payload.
 * This one is a form builder: the request body of the call that just threw is
 * a respondent's answers. So is the query string (`/f/<slug>?q_abc=…` is how
 * prefilled links work). So are half the values a component was holding when
 * it crashed. An unconfigured Sentry on this codebase is a pipeline that
 * copies survey responses — which may be health, financial or identifying
 * data the respondent gave to *one* organisation — into a third-party service
 * that neither the author nor the respondent agreed to.
 *
 * Hence `sendDefaultPii: false` and the `beforeSend` below, which is not
 * belt-and-braces: each of them covers a channel the other does not.
 * `sendDefaultPii` is a flag the SDK consults when *collecting* (IP address,
 * cookies, request bodies on the server); `beforeSend` is the last gate before
 * transmission and catches everything the app itself attached.
 *
 * ── No-op by design ────────────────────────────────────────────────────────
 * `NEXT_PUBLIC_SENTRY_DSN` is unset in this project and nothing here runs
 * without it: every entry point checks the literal `process.env` expression
 * before importing the SDK at all, so with no DSN the SDK is never
 * initialised, never bundled into the client, and never logs a word.
 */

/**
 * The DSN, and the only switch.
 *
 * `NEXT_PUBLIC_` because the browser SDK genuinely needs it at runtime — a DSN
 * is a write-only public key, which is why Sentry publishes it in client
 * bundles by design.
 *
 * Callers that guard an `import()` on this must repeat the literal
 * `process.env.NEXT_PUBLIC_SENTRY_DSN` rather than import this constant: Next
 * substitutes the literal expression at build time, which is what lets the
 * minifier see a falsy constant, drop the branch, and leave the SDK out of the
 * bundle entirely. Through a re-exported binding that elimination is no longer
 * guaranteed.
 */
export const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

/**
 * Performance tracing is off unless asked for.
 *
 * Transaction names on this app are URLs, and the URLs carry prefill answers
 * in their query strings. Tracing is also the expensive half of a Sentry plan.
 * Neither is a decision to make silently on the operator's behalf.
 */
const tracesSampleRate = Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? '0');

const REDACTED = '[redacted: sentry beforeSend]';

/**
 * Property names that hold respondent input anywhere in the app.
 *
 * Matched on the whole key, case-insensitively, at every depth of `extra` and
 * `contexts`. Deliberately broad — a false positive costs one redacted debug
 * value, a false negative costs a respondent's answer.
 */
const SENSITIVE_KEY =
  /^(answers?|values?|responses?|submissions?|submission_?data|form_?data|payload|body|prefill|prefilled_?answers|signature|attachments?|files?|email|phone|password|token)$/i;

/** Query strings on this app carry prefilled answers, so they never survive. */
function stripQuery(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : `${url.slice(0, cut)}?${REDACTED}`;
}

/**
 * Recursively rebuild a value with sensitive keys blanked.
 *
 * Rebuilds rather than mutates because the same object may still be live in
 * the running app — `beforeSend` gets the event, not a copy of the app's
 * state. The depth cap stops a cyclic or pathologically nested context from
 * turning error reporting into a hang.
 */
function redactDeep(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactDeep(nested, depth + 1);
  }
  return out;
}

/**
 * The last gate before an event leaves the process.
 *
 * Returns the event so it can be handed straight to `beforeSend`. It mutates
 * the event object, which is safe and intended: the event is Sentry's own
 * short-lived envelope, built for this hook.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  const request = event.request;
  if (request) {
    // The POST body of a submission, and the arguments of a failed server
    // action — the single largest source of answer data in an event.
    delete request.data;
    // Session and refresh cookies. `sendDefaultPii: false` already withholds
    // these server-side; this covers anything the app attached by hand.
    delete request.cookies;
    if (request.query_string) request.query_string = REDACTED;
    if (typeof request.url === 'string') request.url = stripQuery(request.url);
    if (request.headers) {
      // An allowlist, not a denylist: a header we have not thought of is more
      // likely to carry a token than to be worth keeping.
      const { 'user-agent': userAgent, referer } = request.headers;
      request.headers = {
        ...(userAgent ? { 'user-agent': userAgent } : {}),
        ...(referer ? { referer: stripQuery(referer) } : {}),
      };
    }
  }

  if (event.extra) event.extra = redactDeep(event.extra) as typeof event.extra;
  if (event.contexts) event.contexts = redactDeep(event.contexts) as typeof event.contexts;

  // Only the account id, never a name, email or IP. On the public runner there
  // is no user at all and this is already empty.
  if (event.user) {
    event.user = event.user.id === undefined ? {} : { id: event.user.id };
  }

  // Breadcrumbs are the sneaky one: every fetch and XHR the SDK saw is in
  // here with its full URL, and every console call is in here with its
  // arguments — which on this app means whatever a component logged while
  // holding a page of answers.
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((crumb) => {
      if (crumb.category === 'console') {
        return { ...crumb, data: undefined, message: crumb.message ? REDACTED : undefined };
      }
      if (!crumb.data) return crumb;
      const data = redactDeep(crumb.data) as Record<string, unknown>;
      if (typeof data.url === 'string') data.url = stripQuery(data.url);
      return { ...crumb, data };
    });
  }

  return event;
}

/**
 * Options every runtime shares. Spread into `Sentry.init`, never used alone.
 *
 * `environment` falls back to NODE_ENV so a self-hosted deployment that sets
 * nothing still separates its dev noise from production.
 */
export const commonSentryOptions = {
  dsn: SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV,
  /**
   * The SDK's own PII collection: IP addresses, cookies, request bodies,
   * and user headers. Off, permanently. Turning it on would defeat most of
   * `scrubEvent` above and is never the right call on a product that stores
   * other people's survey answers.
   */
  sendDefaultPii: false,
  tracesSampleRate: Number.isFinite(tracesSampleRate) ? tracesSampleRate : 0,
  beforeSend: scrubEvent,
};
