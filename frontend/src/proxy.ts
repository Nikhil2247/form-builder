import { NextResponse, type NextRequest } from 'next/server';

/**
 * Edge proxy — first line of route protection.
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

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
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
  /**
   * Skip Next internals, static assets, and — importantly — the two public
   * runners at /f/* and /a/*, which must stay reachable by anonymous
   * respondents. `/a/` cannot collide with a protected prefix: `/analytics` and
   * `/apps` do not begin with `a/`.
   */
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|f/|a/|embed.js|.*\\..*).*)'],
};
