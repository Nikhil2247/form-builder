import { NextResponse, type NextRequest } from 'next/server';

import { STRICT_CSP_MODE, isPublicRunnerPath, noncedCsp } from '@/lib/csp';

/**
 * Edge proxy — route protection, and the nonce for the public runners' CSP.
 *
 * (Named `proxy` because Next 16 deprecated the `middleware` file convention in
 * favour of this one; the behaviour is unchanged.)
 *
 * There was previously no middleware at all: every dashboard route was gated
 * only by client-side checks, so the HTML shell for /platform/users and friends
 * was served to anyone who asked.
 *
 * SCOPE OF THIS CHECK — read carefully:
 *  The access token lives in memory (and is sent as a bearer header), so the
 *  edge cannot verify it. What we CAN see is the HttpOnly refresh_token cookie.
 *  Its presence means "this browser has an active session"; its absence means
 *  "definitely signed out". So this proxy:
 *    • redirects signed-out visitors away from app routes (the win: no app
 *      shell, no layout flash, no wasted client bootstrap)
 *    • redirects signed-in visitors away from /login and /signup
 *
 *  It is NOT authorization. The cookie is neither validated nor role-checked
 *  here. Every route's real enforcement remains server-side in the API, where
 *  JwtAuthGuard + OrgMemberGuard + RoleGuard run against the actual token.
 *  Never treat passing this proxy as proof of anything.
 */

const AUTH_COOKIE = 'refresh_token';

/**
 * App areas that require a session.
 *
 * Must cover every route under `app/(dashboard)`. A dashboard route missing
 * from this list still enforces correctly at the API, but serves its shell to
 * signed-out visitors — which is exactly the flash this file exists to avoid.
 * `/apps`, `/records`, `/record-types` and `/dictionary` were all missing.
 */
const PROTECTED_PREFIXES = [
  '/dashboard',
  '/forms',
  '/submissions',
  '/analytics',
  '/templates',
  '/apps',
  '/records',
  '/record-types',
  '/dictionary',
  '/team',
  '/settings',
  '/profile',
  '/notifications',
  '/integrations',
  '/trash',
  '/platform',
  '/org-audit',
  '/global-audit',
];

/** Auth pages a signed-in user should not sit on. */
const AUTH_PAGES = ['/login', '/signup'];

/**
 * A fresh 128-bit nonce, base64-encoded.
 *
 * Not `Buffer.from(crypto.randomUUID())` as the Next docs show: that
 * base64-encodes the 36-character *text* of a UUID, so it spends 48 characters
 * carrying 122 bits, four of which are the version/variant constants. Raw
 * random bytes are shorter and strictly more unpredictable, which is the only
 * property a nonce needs. The alphabet stays within the `[A-Za-z0-9+/_-]+={0,2}`
 * pattern Next's own nonce parser matches against.
 *
 * `crypto` and `btoa` are both Web APIs available in the edge runtime; `Buffer`
 * is only there via a polyfill.
 */
function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/**
 * The nonce CSP for `/f/*` and `/a/*`.
 *
 * The nonce has to reach the renderer through the *request* headers, not the
 * response: Next reads `content-security-policy` (or its report-only twin) off
 * the incoming request, pulls the `'nonce-…'` source out of `script-src`, and
 * threads that value into the bootstrap script, every `ReactDOM.preinit`ed
 * chunk and the inline flight-data scripts. Setting it only on the response
 * would produce a policy whose nonce nothing in the page carries — a blank
 * page. `x-nonce` is set alongside it for the same reason the Next docs do:
 * so a server component that hand-writes a `<script>` can read it. Neither of
 * these two routes has one today, and Next needs no help for its own tags.
 *
 * Gated OFF by default. See `STRICT_CSP_MODE` in `src/lib/csp.ts` for the
 * three settings and why 'report' comes before 'enforce'.
 */
function publicRunnerCsp(req: NextRequest): NextResponse {
  if (STRICT_CSP_MODE === 'off') return NextResponse.next();

  const nonce = createNonce();
  // Framed anywhere, because embedding a published form in a customer's own
  // site is a product feature. This must be restated here rather than
  // inherited: in 'enforce' mode this header replaces the one next.config.ts
  // sets for these routes (verified against a production build), so a
  // frame-ancestors omitted here would fall back to `default-src 'self'` and
  // silently kill every embed.
  const value = noncedCsp('*', nonce);
  const header =
    STRICT_CSP_MODE === 'enforce'
      ? 'Content-Security-Policy'
      : 'Content-Security-Policy-Report-Only';

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set(header, value);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set(header, value);
  return res;
}

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // The public runners are anonymous by definition — no session check applies,
  // and they are only in the matcher at all so this can mint them a nonce.
  if (isPublicRunnerPath(pathname)) return publicRunnerCsp(req);

  const hasSession = req.cookies.has(AUTH_COOKIE);

  const isProtected = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  if (isProtected && !hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    // Preserve the destination so login can bounce the user back.
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  if (AUTH_PAGES.includes(pathname) && hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = '/dashboard';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /**
     * Everything that is not a Next internal, a static asset, or one of the two
     * public runners. `/f/` and `/a/` are carved out here because the session
     * logic must never touch them — they are reachable by anonymous
     * respondents by design — and picked up separately below.
     * `/a/` cannot collide with a protected prefix: `/analytics` and `/apps` do
     * not begin with `a/`.
     */
    '/((?!api|_next/static|_next/image|favicon.ico|f/|a/|embed.js|.*\\..*).*)',
    /**
     * The public runners, for the CSP nonce only. These entries are cheap even
     * when the strict mode is off — `publicRunnerCsp` returns a bare
     * `NextResponse.next()` — but they are what makes the nonce possible at
     * all, since a nonce cannot come from a static header in next.config.ts.
     */
    '/f/:path*',
    '/a/:path*',
  ],
};
