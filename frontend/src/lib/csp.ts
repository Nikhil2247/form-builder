/**
 * Content-Security-Policy construction.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Two callers, one policy shape:
 *
 *  • `next.config.ts` emits the **baseline** policy as a static response header
 *    for every route. It carries `script-src 'unsafe-inline'`, because a static
 *    header cannot contain a per-request nonce and the ~70 prerendered
 *    marketing/docs pages must stay prerendered.
 *
 *  • `src/proxy.ts` emits the **nonce** policy, and only for `/f/*` and `/a/*`
 *    — the two routes that render author-controlled content (form titles,
 *    question labels, descriptions, theme values) to anonymous visitors, and
 *    the two that are already rendered per request so a nonce costs them
 *    nothing.
 *
 * They live in one module so the ~10 directives they share cannot drift; only
 * `script-src` differs. Note that `next.config.ts` imports this file by
 * relative path (`./src/lib/csp`) — the `@/` alias is a tsconfig path that the
 * config loader does not resolve.
 */

/**
 * Where the browser talks to the API. `connect-src 'self'` alone would block
 * every request the app makes, because the API is a separate origin (:3100 by
 * default). Derived from the same env var `src/lib/config.ts` reads, so the two
 * cannot drift.
 */
export function apiOrigin(): string {
  try {
    return new URL(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3100/v1').origin;
  } catch {
    return '';
  }
}

const isDev = process.env.NODE_ENV === 'development';

/**
 * `upgrade-insecure-requests` — opt-in, never inferred from NODE_ENV.
 * ───────────────────────────────────────────────────────────────────────────
 * This directive tells the browser to silently rewrite every http:// URL on
 * the page to https://, including the ones `connect-src` allows. That is the
 * right default for a site whose entire topology is TLS end to end — and a
 * total, production-only outage for one where it is not: if the API is reached
 * over plain http (a sidecar, an internal load balancer, a bare-IP staging
 * box, a LAN deployment on `http://192.168.x.x`), every single API call is
 * rewritten to a scheme the API does not answer on, and the app fails with
 * network errors that never appear in dev.
 *
 * It used to be gated on `NODE_ENV === 'production'`, which is not a statement
 * about the deployment's TLS topology — it is a statement about how the bundle
 * was compiled. Those are unrelated, and conflating them meant the failure
 * could only ever be discovered in production.
 *
 * BEFORE SETTING THIS, the operator must confirm all three:
 *   1. the app itself is served over https;
 *   2. `NEXT_PUBLIC_API_URL` (and `API_URL_INTERNAL`, if the browser ever sees
 *      an address derived from it) is an https:// URL with a valid
 *      certificate — not a self-signed one, which the browser will reject;
 *   3. every absolute URL that ends up in a page — author-supplied logo and
 *      cover-image URLs in the theme panel, S3 presigned upload endpoints — is
 *      reachable over https.
 *
 * `NEXT_PUBLIC_` prefix: this same module is bundled into the edge proxy,
 * where only `NEXT_PUBLIC_*` variables are reliably inlined at build time. The
 * value is a boolean about our own response headers, which are visible to the
 * browser anyway, so there is nothing to leak.
 */
const upgradeInsecureRequests = process.env.NEXT_PUBLIC_UPGRADE_INSECURE_REQUESTS === 'true';

/**
 * Strict, nonce-based CSP on the two public runner routes.
 *
 *   'off'     — default. Nothing changes; the baseline policy is all you get.
 *   'report'  — the proxy sends `Content-Security-Policy-Report-Only`. Nothing
 *               is blocked; violations appear in the browser console. This is
 *               the setting to run first, because there is no way to be sure
 *               from source alone that every script Next emits carries the
 *               nonce, and a missed one means a blank form for every
 *               respondent.
 *   'enforce' — the proxy sends `Content-Security-Policy`. Only run this after
 *               'report' produced a clean console on a real published form.
 *
 * Next reads the nonce out of *either* header name (see
 * `next/dist/server/app-render/app-render.js`, which checks
 * `content-security-policy` then `content-security-policy-report-only`), so
 * report mode exercises the identical code path — it is a true dry run, not an
 * approximation.
 */
export type StrictCspMode = 'off' | 'report' | 'enforce';

function parseStrictCspMode(): StrictCspMode {
  switch (process.env.NEXT_PUBLIC_STRICT_CSP_PUBLIC_ROUTES) {
    case 'report':
      return 'report';
    case 'enforce':
      return 'enforce';
    default:
      // Anything unset, empty, misspelled or legacy ('true', '1', 'on') is
      // treated as off. A typo must never silently enable a policy that can
      // blank the form runner.
      return 'off';
  }
}

export const STRICT_CSP_MODE: StrictCspMode = parseStrictCspMode();

/** `/f/*` and `/a/*` — the public form runner and the public form-app surface. */
export function isPublicRunnerPath(pathname: string): boolean {
  return (
    pathname === '/f' ||
    pathname === '/a' ||
    pathname.startsWith('/f/') ||
    pathname.startsWith('/a/')
  );
}

/**
 * Everything except `script-src`, which is the only directive the two policies
 * disagree about.
 */
function policy(frameAncestors: string, scriptSrc: string): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
    `frame-ancestors ${frameAncestors}`,
    scriptSrc,
    // ── Deliberately NOT nonced ──────────────────────────────────────────
    // A nonce is only honoured on `<style>` *elements*. It does nothing for
    // `style=""` *attributes*, and the form runner is built on those:
    // FormThemeScope paints an author's entire theme by writing ~40 CSS custom
    // properties onto one wrapper element's style attribute. Adding a nonce
    // here would make the browser ignore 'unsafe-inline' (that is what a nonce
    // does to a directive) and strip the colours, fonts and radii off every
    // published form — the exact breakage this whole change exists to avoid.
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
    ...(upgradeInsecureRequests ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

/**
 * The policy every route gets from `next.config.ts`.
 *
 * ── Honest scope ───────────────────────────────────────────────────────────
 * `script-src` carries `'unsafe-inline'`, so this is **not** an XSS mitigation.
 * What it does buy is real but narrower: no script may be loaded from an
 * unlisted origin, `object-src 'none'` kills plugin injection, `base-uri 'self'`
 * blocks <base> hijacking, and `form-action 'self'` stops an injected form from
 * POSTing credentials off-site.
 */
export function baselineCsp(frameAncestors: string): string {
  // 'unsafe-eval' is React's dev-only source-mapping of server error stacks.
  return policy(frameAncestors, `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`);
}

/**
 * The strict policy the proxy attaches to `/f/*` and `/a/*`.
 *
 * ── Why `'strict-dynamic'` is load-bearing here, not decoration ─────────────
 * Next stamps the nonce onto the script tags it writes into the HTML itself
 * (the bootstrap script, the `ReactDOM.preinit`ed chunk scripts, and the
 * `self.__next_f.push(...)` inline flight-data scripts). It does **not** set
 * `__webpack_nonce__` — verified by grepping `next/dist`, where the only hits
 * are in the style-loader runtime, never in the chunk loader. So every script
 * element the bundler creates *after* hydration — client-side navigations,
 * `next/dynamic`, `React.lazy` — is injected by JS with no nonce attribute at
 * all, and would be blocked by a nonce-only policy. `'strict-dynamic'`
 * propagates the trust of an already-executing nonced script to the scripts it
 * inserts, which is exactly that case.
 *
 * `'self'` is kept alongside it even though CSP Level 3 browsers ignore host
 * sources whenever `'strict-dynamic'` is present. It is the fallback for a CSP
 * Level 2 browser, which ignores `'strict-dynamic'` instead and would
 * otherwise be left with a nonce-only policy that breaks chunk loading.
 *
 * ── The one known gap, measured ────────────────────────────────────────────
 * A production build of `/f/[id]` under this policy emits 25 `<script>` tags.
 * 24 carry the nonce, as does the one `<link rel="preload" as="script">`. The
 * 25th is `next-themes`' anti-flash script, rendered from the ROOT layout,
 * which takes its nonce as a prop. Supplying it would mean calling `headers()`
 * in the root layout, and that would drop all ~70 prerendered pages to dynamic
 * rendering — the exact thing this route scoping exists to prevent. So in
 * 'enforce' mode that one script is blocked: one console violation, and the
 * app-chrome light/dark class lands a beat later from React instead of before
 * paint. The form's own colours are unaffected; they are server-rendered
 * inline style attributes, not that script.
 *
 * Nothing else in the served HTML needs `'unsafe-inline'`: it contains no
 * inline event handlers and no `javascript:` URLs.
 */
export function noncedCsp(frameAncestors: string, nonce: string): string {
  return policy(
    frameAncestors,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
  );
}
