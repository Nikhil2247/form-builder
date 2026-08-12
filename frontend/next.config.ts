import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === 'development';

/**
 * Where the browser talks to the API. `connect-src 'self'` alone would block
 * every request the app makes, because the API is a separate origin (:3100 by
 * default). Derived from the same env var `src/lib/config.ts` reads, so the two
 * cannot drift.
 */
function apiOrigin(): string {
  try {
    return new URL(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3100/v1').origin;
  } catch {
    return '';
  }
}

/**
 * Security headers.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Helmet covers the API; nothing covered the Next server, so the app and the
 * public form runner were served with no CSP, no Referrer-Policy and no
 * Permissions-Policy at all.
 *
 * ── Honest scope of this CSP ───────────────────────────────────────────────
 * `script-src` carries `'unsafe-inline'`, so this is **not** an XSS mitigation.
 * The strict alternative is a per-request nonce, which Next can only apply
 * while rendering dynamically — adopting it would drop all ~70 prerendered
 * pages to dynamic rendering. What this policy does buy is real but narrower:
 * no script may be loaded from an unlisted origin, `object-src 'none'` kills
 * plugin injection, `base-uri 'self'` blocks <base> hijacking, and
 * `form-action 'self'` stops an injected form from POSTing credentials
 * off-site.
 *
 * The worthwhile follow-up is a nonce-based `script-src` scoped to `/f/*` and
 * `/a/*` only — the two routes that render author-controlled content, and the
 * two that are already dynamic, so nonces would cost them nothing. That needs
 * verifying against a running stack before it goes anywhere near production:
 * if Next misses a script tag, every respondent gets a blank form.
 */
function csp(frameAncestors: string): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
    `frame-ancestors ${frameAncestors}`,
    // 'unsafe-eval' is React's dev-only source-mapping of server error stacks.
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
    // Tailwind is compiled, but the runner sets its theme through inline
    // `style` attributes (CSS custom properties per form), which this covers.
    "style-src 'self' 'unsafe-inline'",
    // Authors paste arbitrary logo and cover-image URLs into the theme panel,
    // so remote images cannot be restricted to a known origin.
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    // `https:` is here for direct-to-S3 presigned uploads, whose bucket host is
    // a backend deployment detail this config cannot know. Narrow it to that
    // origin if you want connect-src to be a real exfiltration control.
    `connect-src 'self' ${apiOrigin()} https: wss:`.replace(/\s+/g, ' ').trim(),
    "media-src 'self' data: blob:",
    "worker-src 'self' blob:",
    "frame-src 'self'",
    // Omitted in dev: it would rewrite http://localhost:3100 to https and
    // break every API call.
    ...(isDev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}

const COMMON_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    // Nothing in the app uses any of these. The signature pad is a plain
    // <canvas>; file upload needs no camera.
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=()',
  },
  // Ignored by browsers over plain http, so it is safe to send in dev too, but
  // there is no reason to.
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
        headers: [...COMMON_HEADERS, { key: 'Content-Security-Policy', value: csp("'none'") }],
      },
      {
        // Embedding a published form in a customer's own site is a product
        // feature — the share dialog hands out an <iframe> snippet — so these
        // two routes, and only these two, may be framed anywhere. Later match
        // wins, so this replaces the CSP above.
        source: '/f/:path*',
        headers: [{ key: 'Content-Security-Policy', value: csp('*') }],
      },
      {
        source: '/a/:path*',
        headers: [{ key: 'Content-Security-Policy', value: csp('*') }],
      },
    ];
  },
};

export default nextConfig;
