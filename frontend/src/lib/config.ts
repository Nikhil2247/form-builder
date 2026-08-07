/**
 * Runtime configuration.
 *
 * ── Why this file exists ───────────────────────────────────────────────────
 * The API base URL was inlined as `process.env.NEXT_PUBLIC_API_URL || '<some
 * default>'` in five separate files, and the defaults had drifted apart:
 * lib/api.ts and use-submissions.ts said `:3100`, while the public form page,
 * FormRunnerClient, and the upload helper said `:3000`.
 *
 * With no .env.local present, every fallback was live at once. `:3000` is the
 * Next dev server, so the public form page fetched itself, got HTML back, and
 * rendered "Failed to load form. It may have been deleted or expired." for
 * forms that were published and perfectly healthy.
 *
 * One export, one default. A divergent base URL is now impossible.
 */

/** Trailing slashes break `${API_BASE_URL}/public-forms/x` — strip them once. */
function normalise(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Where the API lives, as seen from the browser.
 *
 * The backend's own .env sets PORT=3100, so that is the default. Override with
 * NEXT_PUBLIC_API_URL for any other environment.
 */
export const API_BASE_URL = normalise(
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3100/v1',
);

/**
 * Where the API lives, as seen from the Next server.
 *
 * Server components run inside the container/host, not the browser, so in a
 * containerised deployment they need an internal address ("http://api:3100/v1")
 * rather than the public one. Falls back to the browser URL, which is correct
 * for local development.
 */
export const API_BASE_URL_SERVER = normalise(
  process.env.API_URL_INTERNAL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3100/v1',
);

/** Absolute URL for a public form, used for share links and embeds. */
export function publicFormUrl(slug: string): string {
  const origin =
    typeof window !== 'undefined'
      ? window.location.origin
      : (process.env.NEXT_PUBLIC_SITE_URL ?? '');
  return `${origin}/f/${slug}`;
}
