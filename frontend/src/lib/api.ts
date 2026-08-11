/**
 * API client.
 *
 * ── Token handling ─────────────────────────────────────────────────────────
 * The access token lives in a module-scoped variable and NOWHERE else. It is
 * never written to localStorage, sessionStorage, a cookie readable by JS, or
 * the URL.
 *
 * Why this matters: the previous implementation stored it under
 * `localStorage['access_token']`. localStorage is origin-scoped and readable by
 * any script on the page — one XSS, one compromised dependency, or one
 * malicious browser extension and the token is exfiltrated wholesale, valid
 * until it expires, usable from anywhere. A module variable dies with the tab
 * and is not enumerable by other scripts.
 *
 * ── The session is one day long and cannot be extended ───────────────────
 * A session ends exactly `JWT_REFRESH_TTL_DAYS` after the user signs in — one
 * day — and NOTHING moves that deadline. There is no background refresh loop,
 * no refresh on a timer, and no retry-on-401 that transparently mints a new
 * token. The API enforces this: every token it issues for a session expires at
 * the deadline fixed at login, so exchanging one buys no extra time.
 *
 * The single exchange that does happen is `bootstrapSession` below: once per
 * page load, only when there is no token in memory yet. That is what lets a
 * reload keep you signed in without letting anything keep you signed in
 * forever — the token it gets back carries the ORIGINAL expiry, so reloading
 * the tab a hundred times still logs you out one day after you signed in.
 *
 * When that moment arrives — whether the tab is open (`scheduleExpiryLogout`)
 * or the API rejects the token outright — the session is dropped, the refresh
 * cookie is cleared server-side, and `onSessionExpired` fires so the app can
 * send the user back to /login.
 */

import { API_BASE_URL as BASE_URL } from './config';

export interface ValidationIssue {
  questionId: string;
  label?: string;
  code: string;
  message: string;
}

/**
 * Error carrying the HTTP status and any field-level validation issues, so
 * callers can render inline messages instead of a single toast.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly issues?: ValidationIssue[],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// In-memory token
// ─────────────────────────────────────────────────────────────────────────────

let accessToken: string | null = null;
let expiryTimer: ReturnType<typeof setTimeout> | null = null;

/** Notified whenever the token changes, so React can react to sign-out. */
type SessionListener = (token: string | null) => void;
const sessionListeners = new Set<SessionListener>();

/**
 * Notified when a session that WAS valid ends on its own — the access token's
 * `exp` was reached, or the API rejected it — as distinct from the user
 * choosing to sign out via `clearSession`. The app uses this to show "your
 * session expired" and route back to /login from wherever the user happens
 * to be, rather than leaving pages quietly holding stale, unusable data.
 */
type ExpiryListener = () => void;
const expiryListeners = new Set<ExpiryListener>();

export function setAccessToken(token: string | null) {
  accessToken = token;
  sessionListeners.forEach((fn) => fn(token));
  scheduleExpiryLogout(token);
}

export function getAccessToken() {
  return accessToken;
}

export function onSessionChange(fn: SessionListener) {
  sessionListeners.add(fn);
  return () => {
    sessionListeners.delete(fn);
  };
}

export function onSessionExpired(fn: ExpiryListener) {
  expiryListeners.add(fn);
  return () => {
    expiryListeners.delete(fn);
  };
}

/** Reads the `exp` claim out of a JWT without verifying it — for scheduling
 * the client-side logout timer only. The API is what actually enforces it. */
function decodeJwtExpiry(token: string): number | null {
  try {
    const payload = token.split('.')[1];
    const json = JSON.parse(
      atob(payload.replace(/-/g, '+').replace(/_/g, '/')),
    );
    return typeof json.exp === 'number' ? json.exp : null;
  } catch {
    return null;
  }
}

/**
 * Fires `expireSession()` at the exact moment the current token's `exp` is
 * reached, so a tab left open for the full session length logs itself out
 * proactively instead of waiting for the next API call to discover the 401.
 */
function scheduleExpiryLogout(token: string | null) {
  if (expiryTimer) {
    clearTimeout(expiryTimer);
    expiryTimer = null;
  }
  if (!token) return;

  const exp = decodeJwtExpiry(token);
  if (exp === null) return;

  const msUntilExpiry = exp * 1000 - Date.now();
  if (msUntilExpiry <= 0) {
    queueMicrotask(expireSession);
    return;
  }
  // A one-day session is comfortably inside setTimeout's ~24.8-day ceiling.
  expiryTimer = setTimeout(expireSession, msUntilExpiry);
}

/**
 * Ends the session because it is no longer valid — expired, or rejected by
 * the API — rather than because the user asked to sign out. Notifies
 * `onSessionExpired` listeners; `clearSession` deliberately does not.
 */
export function expireSession() {
  if (accessToken === null) return; // already signed out; nothing to announce
  setAccessToken(null);
  // Drop the refresh cookie too. It is HttpOnly, so only the API can remove
  // it, and leaving it behind is not cosmetic: `middleware.ts` reads its
  // presence as "this browser has a session" and would bounce the user from
  // /login straight back into an app they can no longer use. Fire-and-forget,
  // and deliberately NOT through `fetchApi` — a failure here must not turn
  // into another expiry event.
  void fetch(`${BASE_URL}/auth/logout`, { method: 'POST', credentials: 'include' }).catch(
    () => {},
  );
  expiryListeners.forEach((fn) => fn());
}

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────────────────────────────────────

/** Module-scoped, so the exchange happens at most once per page load however
 *  many components ask for it. */
let bootstrapPromise: Promise<void> | null = null;

/**
 * Recover the in-memory access token after a page load, if the browser still
 * holds a live session.
 *
 * The access token lives in a module variable and therefore dies with the
 * page; the refresh cookie survives. This exchanges one for the other EXACTLY
 * ONCE per page load, and only when there is nothing in memory already.
 *
 * This is not a refresh loop and cannot become one:
 *   • it runs on a cold load only, never on a timer and never on a 401;
 *   • the token it receives expires when the session does, not a day from now,
 *     so no number of reloads extends anything;
 *   • a failure is simply "signed out" — there is no retry.
 *
 * A 401 here is the normal answer for a visitor who is not signed in, so it is
 * swallowed rather than surfaced.
 */
export function bootstrapSession(): Promise<void> {
  if (bootstrapPromise) return bootstrapPromise;

  bootstrapPromise = (async () => {
    if (accessToken) return;

    try {
      const response = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) return;

      const body = await response.json().catch(() => null);
      const token = (body?.data ?? body)?.accessToken;
      if (typeof token === 'string' && token) setAccessToken(token);
    } catch {
      // Offline or the API is down. Treated as signed out; the user can retry
      // by reloading, which is what they would do anyway.
    }
  })();

  return bootstrapPromise;
}

/** Drop the in-memory token because the user is signing out. Does not call
 * the API and does not notify expiry listeners — the caller already knows. */
export function clearSession() {
  setAccessToken(null);
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetch
// ─────────────────────────────────────────────────────────────────────────────

export interface FetchOptions extends RequestInit {
  /** Skip the Authorization header and never treat a 401 as session expiry. */
  anonymous?: boolean;
  /** Milliseconds before the request is aborted. Defaults to 30s. */
  timeoutMs?: number;
}

async function toApiError(response: Response): Promise<ApiError> {
  const body = await response.json().catch(() => null);

  // The backend's exception filter returns { error: { statusCode, message } }.
  const raw = body?.error?.message ?? body?.message;
  // class-validator returns `message` as an array of strings.
  const message = Array.isArray(raw) ? raw.join(', ') : raw;

  return new ApiError(
    message || `Request failed (${response.status})`,
    response.status,
    body?.error?.issues ?? body?.issues,
  );
}

export async function fetchApi(endpoint: string, options: FetchOptions = {}) {
  const { anonymous = false, timeoutMs = 30_000, ...init } = options;

  const send = async (token: string | null): Promise<Response> => {
    const headers = new Headers(init.headers);
    // Only set a JSON content type when there is a body; sending it on a GET
    // needlessly makes some requests non-simple for CORS.
    if (init.body != null && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    if (token && !anonymous) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    // Every request is abortable. Without this a hung API leaves spinners on
    // screen indefinitely with no way for the user to recover.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const externalSignal = init.signal;
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort();
      else externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    try {
      return await fetch(`${BASE_URL}${endpoint}`, {
        ...init,
        headers,
        credentials: 'include',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };

  let response: Response;
  try {
    response = await send(accessToken);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError('The request timed out. Please try again.', 408);
    }
    throw new ApiError('Could not reach the server. Check your connection.', 0);
  }

  // A 401 on a request that carried a bearer token means that token is no
  // longer good — expired, or revoked server-side — so the session is over.
  // No retry: the caller must sign in again. A 401 with no token attached
  // (an anonymous visitor, or a call made before any login) is just the
  // normal "not authenticated" answer and does not end anything.
  if (response.status === 401 && !anonymous && accessToken) {
    expireSession();
    throw new ApiError('Your session has expired. Please sign in again.', 401);
  }

  if (!response.ok) {
    throw await toApiError(response);
  }

  if (response.status === 204) return null;

  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    // A non-JSON 2xx (CSV export, for instance) — hand back the raw body.
    return text;
  }
}

/** Unwraps the API's `{ data: ... }` envelope, tolerating unwrapped responses. */
export function unwrap<T = any>(res: any): T {
  return (res?.data ?? res) as T;
}
