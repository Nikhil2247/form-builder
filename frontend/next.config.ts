import type { NextConfig } from "next";

import { baselineCsp } from './src/lib/csp';

const isDev = process.env.NODE_ENV === 'development';

/**
 * Security headers.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Helmet covers the API; nothing covered the Next server, so the app and the
 * public form runner were served with no CSP, no Referrer-Policy and no
 * Permissions-Policy at all.
 *
 * The CSP itself is built in `src/lib/csp.ts`, shared with `src/proxy.ts`.
 * Read the header comment there for the honest scope of what this baseline
 * policy does and does not protect against, and for the opt-in nonce policy
 * the proxy layers on top of it for `/f/*` and `/a/*`.
 *
 * ── How this interacts with the proxy's policy ─────────────────────────────
 * Measured against a production build rather than assumed, because Next
 * documents no ordering between a header set here and one set on a proxy
 * response:
 *
 *   • strict mode 'enforce' — the proxy sets `Content-Security-Policy` too,
 *     and its value REPLACES the one below. `curl -sI /f/<slug>` returns
 *     exactly one such header, carrying the nonce. So the entries below are
 *     not the effective policy on those two routes; they are the fallback if
 *     the proxy is ever bypassed or fails to run, which is worth keeping —
 *     without them `/f/*` would fall through to the `frame-ancestors 'none'`
 *     rule and stop being embeddable.
 *   • strict mode 'report' — the header names differ, so both are sent and
 *     both apply: this policy enforces, the proxy's only reports.
 *   • strict mode 'off' (the default) — the proxy sets no CSP at all and
 *     these are the only policy, exactly as before.
 */

const COMMON_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    // The signature pad is a plain <canvas>; file upload needs no camera —
    // those stay denied. `geolocation=(self)` is what the GPS_LOCATION
    // question type needs to call `navigator.geolocation` at all: this
    // header previously denied it outright, so the button silently failed
    // everywhere, including the builder's own preview (same origin, no
    // iframe involved). `(self)` rather than `*`: a form embedded via
    // <iframe> on a third-party site still needs that iframe tag to carry
    // `allow="geolocation"` for capture to work there — this header cannot
    // grant across an origin boundary, only within one.
    value: 'camera=(), microphone=(), geolocation=(self), payment=(), usb=(), magnetometer=()',
  },
  // Ignored by browsers over plain http, so it is safe to send in dev too, but
  // there is no reason to.
  //
  // Deliberately no `preload`: that submits the domain to a list baked into
  // browser binaries, and getting off it takes months. Not this config's call
  // to make on the operator's behalf. `includeSubDomains` IS set, which is the
  // right default but does mean every subdomain must be https — check that
  // before pointing this build at a domain with an http-only internal host on it.
  ...(isDev
    ? []
    : [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]),
];

const nextConfig: NextConfig = {
  reactCompiler: true,
  allowedDevOrigins: ['192.168.1.11'],

  async headers() {
    return [
      {
        // Clickjacking is controlled by `frame-ancestors` alone rather than
        // X-Frame-Options, because the two public runners below must stay
        // embeddable and a header set here could only be overridden, never
        // removed. Every browser that supports CSP honours frame-ancestors and
        // gives it precedence over X-Frame-Options.
        source: '/:path*',
        headers: [
          ...COMMON_HEADERS,
          { key: 'Content-Security-Policy', value: baselineCsp("'none'") },
        ],
      },
      {
        // Embedding a published form in a customer's own site is a product
        // feature — the share dialog hands out an <iframe> snippet — so these
        // two routes, and only these two, may be framed anywhere. Later match
        // wins, so this replaces the CSP above.
        source: '/f/:path*',
        headers: [{ key: 'Content-Security-Policy', value: baselineCsp('*') }],
      },
      {
        source: '/a/:path*',
        headers: [{ key: 'Content-Security-Policy', value: baselineCsp('*') }],
      },
    ];
  },
};

export default nextConfig;
