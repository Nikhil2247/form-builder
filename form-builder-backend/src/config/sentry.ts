import * as Sentry from '@sentry/nestjs';

/**
 * Error reporting.
 *
 * ── Why this file exists rather than a call in main.ts ─────────────────────
 * Sentry must be initialised before the modules it instruments are imported, so
 * the call site is `import './config/sentry'`-adjacent and therefore easy to
 * get subtly wrong. Keeping the whole policy — DSN gating, sampling, and the
 * scrubbing below — in one file means the interesting decisions are reviewable
 * in one place instead of spread across two entrypoints.
 *
 * ── No DSN, no Sentry ──────────────────────────────────────────────────────
 * `initSentry()` is a no-op when `SENTRY_DSN` is unset, which is the normal
 * state of this repository. It must stay that way: a monitoring integration that
 * throws, warns, or slows startup when it is not configured is one that gets
 * ripped out of the entrypoint, and then it is not there when someone does
 * configure it.
 *
 * ── The scrubbing is the point ─────────────────────────────────────────────
 * This is a form builder. A single 500 on the submit path can carry a
 * respondent's full answer payload — names, addresses, health information,
 * whatever the form asked for — and shipping that to a third-party error tracker
 * would turn an outage into a data-protection incident. Everything below that
 * looks paranoid is deliberate.
 */

/** Bodies and payloads that must never leave the process. */
const SCRUBBED = '[scrubbed]';

/**
 * Request fields carrying respondent or credential data.
 *
 * Matched case-insensitively against the leaf key name anywhere in the event.
 * `answers` is the big one — it is the entire submission payload.
 */
const SENSITIVE_KEYS = [
  'answers',
  'password',
  'formpassword',
  'token',
  'accesstoken',
  'refreshtoken',
  'refresh_token',
  'secret',
  'apikey',
  'api_key',
  'authorization',
  'cookie',
  'mfasecret',
  'mfa_secret',
  'keyhash',
  'tokenhash',
  'signature',
];

function isSensitiveKey(key: string): boolean {
  const normalised = key.toLowerCase().replace(/[-_]/g, '');
  return SENSITIVE_KEYS.some((s) =>
    normalised.includes(s.replace(/[-_]/g, '')),
  );
}

/**
 * Recursively replace sensitive values.
 *
 * Depth-limited because Sentry events can contain deeply nested or cyclic
 * structures and a scrubber that stack-overflows takes the process with it —
 * turning the error reporter into the outage.
 */
function scrub(value: unknown, depth = 0): unknown {
  if (depth > 8 || value === null || typeof value !== 'object') return value;

  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSensitiveKey(key) ? SCRUBBED : scrub(val, depth + 1);
  }
  return out;
}

export function initSentry(role: string): void {
  const dsn = process.env.SENTRY_DSN;

  // The normal case in this repo. Silent by design — see the note above.
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment:
      process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
    release: process.env.SENTRY_RELEASE,

    // Distinguishes an API pod from a worker pod in the issue stream. Without
    // it, a failure in shared code is unattributable to a deployment.
    initialScope: { tags: { process_role: role } },

    // Performance tracing defaults OFF. It is the expensive half, it is not
    // needed to answer "what is erroring", and Prometheus already covers
    // latency. Opt in per-environment once there is a question tracing answers.
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0'),

    // Never attach IPs, cookies or user identifiers automatically.
    sendDefaultPii: false,

    beforeSend(event) {
      // Request bodies are the highest-risk field and are removed wholesale
      // rather than scrubbed key-by-key: a form's questions are user-defined, so
      // the key names carrying personal data are not knowable in advance and no
      // denylist can be complete.
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        if (event.request.headers) {
          for (const key of Object.keys(event.request.headers)) {
            if (isSensitiveKey(key)) event.request.headers[key] = SCRUBBED;
          }
        }
        // Query strings can carry a form password or an invite token.
        delete event.request.query_string;
      }

      if (event.extra)
        event.extra = scrub(event.extra) as Record<string, unknown>;
      if (event.contexts)
        event.contexts = scrub(event.contexts) as typeof event.contexts;

      return event;
    },
  });
}

/**
 * Report an exception, if Sentry is configured.
 *
 * Safe to call unconditionally: with no DSN, `captureException` is a no-op on an
 * uninitialised client. Callers do not need to know whether monitoring exists.
 */
export function captureException(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  if (!process.env.SENTRY_DSN) return;
  Sentry.captureException(
    error,
    context ? { extra: scrub(context) as Record<string, unknown> } : undefined,
  );
}
