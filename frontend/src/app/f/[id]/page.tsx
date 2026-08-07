import type { Metadata } from 'next';
import { API_BASE_URL_SERVER } from '@/lib/config';
import { FormRunnerClient } from './FormRunnerClient';
import { FormUnavailable } from './FormUnavailable';

/**
 * Public form page.
 *
 * Anonymous respondents land here. It renders on the server so the form's title
 * and description are in the HTML for link previews and crawlers.
 *
 * The URL is built from API_BASE_URL_SERVER, not an inline default. The
 * previous inline fallback pointed at :3000 — the Next dev server — so with no
 * .env.local present this page fetched *itself*, received HTML instead of JSON,
 * and told every visitor the form had been deleted or expired. The forms were
 * fine.
 */

interface PageProps {
  params: Promise<{ id: string }>;
}

type LoadResult =
  | { kind: 'ok'; form: any }
  | { kind: 'not-found' }
  | { kind: 'unavailable'; message: string }
  | { kind: 'error'; message: string };

/**
 * Fetch the form and classify the outcome.
 *
 * The four cases mean genuinely different things to a respondent, and the old
 * page collapsed all of them into one red sentence — including the case where
 * the API was simply unreachable, which is not the respondent's problem and is
 * not permanent.
 */
async function loadForm(slug: string): Promise<LoadResult> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL_SERVER}/public-forms/${encodeURIComponent(slug)}`, {
      // Published versions are immutable, so caching is safe. Revalidating
      // keeps an unpublish or an expiry from being served for long.
      next: { revalidate: 300 },
      headers: { Accept: 'application/json' },
    });
  } catch {
    return {
      kind: 'error',
      message: 'We could not reach the server. Please check your connection and try again.',
    };
  }

  if (response.status === 404) return { kind: 'not-found' };

  // 403 is the API saying the form exists but is closed to responses right now:
  // expired, or its organization is suspended. That deserves its own message.
  if (response.status === 403) {
    const body = await response.json().catch(() => null);
    return {
      kind: 'unavailable',
      message:
        body?.error?.message ?? body?.message ?? 'This form is not accepting responses right now.',
    };
  }

  if (!response.ok) {
    return { kind: 'error', message: 'Something went wrong loading this form.' };
  }

  // Guard against a non-JSON 200 — exactly what a misconfigured base URL
  // produces, and what silently broke this page before.
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return {
      kind: 'error',
      message: 'The server returned an unexpected response. Please try again shortly.',
    };
  }

  const json = await response.json().catch(() => null);
  const form = json?.data ?? json;

  if (!form?.id) {
    return { kind: 'error', message: 'The server returned an incomplete form.' };
  }

  return { kind: 'ok', form };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id: slug } = await params;
  const result = await loadForm(slug);

  if (result.kind !== 'ok') {
    return { title: 'Form unavailable', robots: { index: false, follow: false } };
  }

  return {
    title: result.form.title,
    description: result.form.description ?? undefined,
    // A form is a form, not content to rank. Indexing them also leaks internal
    // survey titles into search results.
    robots: { index: false, follow: false },
    openGraph: {
      title: result.form.title,
      description: result.form.description ?? undefined,
      type: 'website',
    },
  };
}

export default async function PublicFormPage({ params }: PageProps) {
  const { id: slug } = await params;
  const result = await loadForm(slug);

  switch (result.kind) {
    case 'ok':
      return <FormRunnerClient slug={slug} initialData={result.form} />;

    case 'not-found':
      return (
        <FormUnavailable
          variant="not-found"
          title="This form is not available"
          message="The link may be incorrect, or the form may have been unpublished or deleted."
        />
      );

    case 'unavailable':
      return <FormUnavailable variant="closed" title="This form is closed" message={result.message} />;

    case 'error':
      return (
        <FormUnavailable
          variant="error"
          title="We could not load this form"
          message={result.message}
          // Only a transient failure is worth retrying; a 404 never is.
          retryable
        />
      );
  }
}
