import type { Metadata } from 'next';

import { API_BASE_URL_SERVER } from '@/lib/config';
import { FormUnavailable } from '../../f/[id]/FormUnavailable';
import { AppRunnerClient } from './AppRunnerClient';

/**
 * Public form-app page.
 *
 * The shareable entry point for a multi-step programme: one URL a field worker
 * can be given, behind which sits a respondent block, whatever repeatable
 * sections the app defines, and a single submit.
 *
 * Server-rendered for the title and description, exactly like /f/[id], and for
 * the same reason — the page has to say what it is before any JavaScript runs.
 */

interface PageProps {
  params: Promise<{ slug: string }>;
}

type LoadResult =
  | { kind: 'ok'; app: any }
  | { kind: 'not-found' }
  | { kind: 'unavailable'; message: string }
  | { kind: 'error'; message: string };

async function loadApp(slug: string): Promise<LoadResult> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL_SERVER}/public-apps/${encodeURIComponent(slug)}`, {
      // Not cached by Next — same reasoning as /f/[id]: the API owns a Redis
      // cache of this payload that it invalidates when the app changes, and a
      // Next-side cache in front of it would keep serving an edited app's old
      // shape with no way to clear it.
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
  } catch {
    return {
      kind: 'error',
      message: 'We could not reach the server. Please check your connection and try again.',
    };
  }

  if (response.status === 404) return { kind: 'not-found' };
  if (response.status === 403) {
    const body = await response.json().catch(() => null);
    return {
      kind: 'unavailable',
      message: body?.error?.message ?? body?.message ?? 'This app is not available right now.',
    };
  }
  if (!response.ok) return { kind: 'error', message: 'Something went wrong loading this app.' };

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return {
      kind: 'error',
      message: 'The server returned an unexpected response. Please try again shortly.',
    };
  }

  const json = await response.json().catch(() => null);
  const app = json?.data ?? json;
  if (!app?.id) return { kind: 'error', message: 'The server returned an incomplete app.' };

  return { kind: 'ok', app };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const result = await loadApp(slug);

  if (result.kind !== 'ok') {
    return { title: 'App unavailable', robots: { index: false, follow: false } };
  }

  return {
    title: result.app.name,
    description: result.app.description ?? undefined,
    // A data-collection surface is not content to rank, and indexing it would
    // leak internal programme names into search results.
    robots: { index: false, follow: false },
  };
}

export default async function PublicAppPage({ params }: PageProps) {
  const { slug } = await params;
  const result = await loadApp(slug);

  switch (result.kind) {
    case 'ok':
      return <AppRunnerClient slug={slug} app={result.app} />;

    case 'not-found':
      return (
        <FormUnavailable
          variant="not-found"
          title="This app is not available"
          message="The link may be incorrect, or the app may have been unpublished."
        />
      );

    case 'unavailable':
      return (
        <FormUnavailable variant="closed" title="This app is closed" message={result.message} />
      );

    case 'error':
      return (
        <FormUnavailable
          variant="error"
          title="We could not load this app"
          message={result.message}
          retryable
        />
      );
  }
}
