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
 * Durability across reloads comes from the HttpOnly `refresh_token` cookie the
 * API sets: on boot we call /auth/refresh once and put a fresh access token
 * back in memory. JavaScript can never read that cookie, so the long-lived
 * credential is the one the page cannot touch.
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

/** Notified whenever the token changes, so React can react to sign-out. */
type SessionListener = (token: string | null) => void;
const sessionListeners = new Set<SessionListener>();

export function setAccessToken(token: string | null) {
  accessToken = token;
  sessionListeners.forEach((fn) => fn(token));
}

export function getAccessToken() {
  return accessToken;
}

export function onSessionChange(fn: SessionListener) {
  sessionListeners.add(fn);
  return () => sessionListeners.delete(fn);
}

// ─────────────────────────────────────────────────────────────────────────────
// Refresh — single-flight
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Only ever one refresh request in flight. Ten queries firing on a dashboard
 * mount with an expired token used to trigger ten refreshes; with rotating
 * refresh tokens that is a race where nine of them present an already-rotated
 * token and get logged out.
 */
let refreshInFlight: Promise<string | null> | null = null;

async function requestRefresh(): Promise<string | null> {
  try {
    const res = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include', // sends the HttpOnly refresh_token cookie
      headers: { 'Content-Type': 'application/json' },
    });

    if (!res.ok) return null;

    const json = await res.json().catch(() => null);
    const token: string | undefined = (json?.data ?? json)?.accessToken;
    return typeof token === 'string' && token.length > 0 ? token : null;
  } catch {
    // Network failure — treat as "no token", but do not sign the user out;
    // the next call will try again.
    return null;
  }
}

/** Refresh the access token, coalescing concurrent callers onto one request. */
export function refreshAccessToken(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = requestRefresh()
      .then((token) => {
        setAccessToken(token);
        return token;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

/**
 * Called once when the app mounts to restore the session after a page load.
 * Resolves to true when a token was obtained.
 */
export async function bootstrapSession(): Promise<boolean> {
  const token = await refreshAccessToken();
  return token !== null;
}

/** Drop the in-memory token. Does not call the API. */
export function clearSession() {
  setAccessToken(null);
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetch
// ─────────────────────────────────────────────────────────────────────────────

export interface FetchOptions extends RequestInit {
  /** Skip the Authorization header and the 401-refresh dance. */
  anonymous?: boolean;
  /** Milliseconds before the request is aborted. Defaults to 30s. */
  timeoutMs?: number;
}

/** Endpoints where a 401 is the *answer*, not a signal to refresh. */
const NO_REFRESH = new Set([
  '/auth/refresh',
  '/auth/login',
  '/auth/login/mfa',
  '/auth/register',
  '/auth/forgot-password',
  '/auth/reset-password',
]);

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

  // 401 → refresh once, then retry the original request.
  if (response.status === 401 && !anonymous && !NO_REFRESH.has(endpoint)) {
    const token = await refreshAccessToken();

    if (!token) {
      clearSession();
      throw new ApiError('Your session has expired. Please sign in again.', 401);
    }

    try {
      response = await send(token);
    } catch {
      throw new ApiError('Could not reach the server. Check your connection.', 0);
    }
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
