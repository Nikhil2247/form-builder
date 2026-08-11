'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { API_BASE_URL } from '@/lib/config';
import { fetchApi, getAccessToken, unwrap } from '@/lib/api';
import { useOrgId } from '@/hooks/use-auth';

/**
 * The choice-list dictionary.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Two scopes, one set of hooks. `'platform'` is the global dictionary a super
 * admin curates — states, districts, anything every tenant would otherwise
 * upload separately — and `'org'` is one organization's own lists.
 *
 * The scope is threaded through rather than split into two hook families
 * because the two surfaces are the same screen with a different base path. Two
 * copies would drift the moment either grew a feature, and the difference that
 * actually matters — who may write — is enforced by the API's guards, not here.
 */

export type DictionaryScope = 'org' | 'platform';

export interface ChoiceListSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  organizationId: string | null;
  parentListId: string | null;
  itemCount: number;
  version: number;
  updatedAt: string;
  isGlobal: boolean;
  parentList: { id: string; slug: string; name: string } | null;
  metadataSchema?: MetadataColumn[];
}

export interface MetadataColumn {
  key: string;
  label: string;
  type: string;
}

export interface ChoiceItemRow {
  id: string;
  value: string;
  label: string;
  parentValue: string | null;
  metadata: Record<string, unknown>;
  sortOrder: number;
  isActive: boolean;
}

export interface BrowseResult {
  items: ChoiceItemRow[];
  total: number;
  page: number;
  limit: number;
  pageCount: number;
  metadataSchema: MetadataColumn[];
  cascades: boolean;
}

export interface CsvPreview {
  columns: string[];
  delimiter: string;
  rowCount: number;
  sample: Array<Record<string, string>>;
}

export interface ImportResult {
  slug: string;
  mode: 'replace' | 'merge';
  itemCount: number;
  created: number;
  updated: number;
  retired: number;
  skipped: number;
}

export interface CsvMapping {
  value: string;
  label?: string;
  parentValue?: string;
  metadata?: Record<string, string>;
}

/**
 * Where a scope's endpoints live.
 *
 * Returns `null` for an org scope with no active organization, which is the
 * signal every query below uses to stay disabled rather than firing a request
 * at `/organizations/undefined/…`.
 */
function useBasePath(scope: DictionaryScope): string | null {
  const orgId = useOrgId();
  if (scope === 'platform') return '/admin/choice-lists';
  return orgId ? `/organizations/${orgId}/choice-lists` : null;
}

/** Query key root, so an org switch cannot serve the previous tenant's lists. */
function useScopeKey(scope: DictionaryScope): readonly unknown[] {
  const orgId = useOrgId();
  return scope === 'platform' ? ['dictionary', 'platform'] : ['dictionary', 'org', orgId];
}

// ── Reads ────────────────────────────────────────────────────────────────────

export function useDictionaryLists(scope: DictionaryScope) {
  const base = useBasePath(scope);
  const key = useScopeKey(scope);

  return useQuery<ChoiceListSummary[]>({
    queryKey: [...key, 'lists'],
    enabled: !!base,
    queryFn: async () => {
      const data = unwrap<ChoiceListSummary[]>(await fetchApi(base!));
      return Array.isArray(data) ? data : [];
    },
    staleTime: 30_000,
  });
}

export interface BrowseQuery {
  q?: string;
  parent?: string;
  page?: number;
  limit?: number;
  includeInactive?: boolean;
}

export function useDictionaryItems(
  scope: DictionaryScope,
  slug: string | null,
  query: BrowseQuery,
) {
  const base = useBasePath(scope);
  const key = useScopeKey(scope);

  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.parent) params.set('parent', query.parent);
  if (query.page && query.page > 1) params.set('page', String(query.page));
  if (query.limit) params.set('limit', String(query.limit));
  if (query.includeInactive) params.set('includeInactive', 'true');
  const search = params.toString();

  return useQuery<BrowseResult>({
    queryKey: [...key, 'items', slug, search],
    enabled: !!base && !!slug,
    queryFn: async () =>
      unwrap<BrowseResult>(
        await fetchApi(`${base}/${encodeURIComponent(slug!)}/browse${search ? `?${search}` : ''}`),
      ),
    // Keeps the previous page on screen while the next one loads, so paging
    // through a large list does not blank the table on every click.
    placeholderData: (previous) => previous,
    staleTime: 15_000,
  });
}

// ── Writes ───────────────────────────────────────────────────────────────────

/** Invalidate everything under a scope. Item counts move when items do. */
function useInvalidateScope(scope: DictionaryScope) {
  const queryClient = useQueryClient();
  const key = useScopeKey(scope);
  return () => queryClient.invalidateQueries({ queryKey: key });
}

export interface ListDraft {
  name: string;
  slug?: string;
  description?: string;
  parentListSlug?: string | null;
  metadataSchema?: MetadataColumn[];
}

export function useCreateList(scope: DictionaryScope) {
  const base = useBasePath(scope);
  const invalidate = useInvalidateScope(scope);

  return useMutation({
    mutationFn: async (draft: ListDraft) =>
      unwrap<ChoiceListSummary>(
        await fetchApi(base!, { method: 'POST', body: JSON.stringify(draft) }),
      ),
    onSuccess: invalidate,
  });
}

export function useUpdateList(scope: DictionaryScope) {
  const base = useBasePath(scope);
  const invalidate = useInvalidateScope(scope);

  return useMutation({
    mutationFn: async ({ slug, ...patch }: ListDraft & { slug: string }) =>
      unwrap<ChoiceListSummary>(
        await fetchApi(`${base}/${encodeURIComponent(slug)}`, {
          method: 'PATCH',
          body: JSON.stringify(patch),
        }),
      ),
    onSuccess: invalidate,
  });
}

export function useDeleteList(scope: DictionaryScope) {
  const base = useBasePath(scope);
  const invalidate = useInvalidateScope(scope);

  return useMutation({
    mutationFn: async (slug: string) =>
      unwrap(await fetchApi(`${base}/${encodeURIComponent(slug)}`, { method: 'DELETE' })),
    onSuccess: invalidate,
  });
}

// ── CSV ──────────────────────────────────────────────────────────────────────

/**
 * How long an upload is given before the client gives up.
 *
 * `fetchApi` defaults to 30 s, which is right for an ordinary request and wrong
 * for this one: a 20 000-row import is a single transaction doing real work,
 * and aborting the fetch does NOT cancel it — the server commits, the browser
 * reports a timeout, and the user re-uploads a file that already landed.
 */
const IMPORT_TIMEOUT_MS = 180_000;

export function usePreviewCsv(scope: DictionaryScope) {
  const base = useBasePath(scope);

  return useMutation({
    mutationFn: async (csv: string) =>
      unwrap<CsvPreview>(
        await fetchApi(`${base}/import/preview`, {
          method: 'POST',
          body: JSON.stringify({ csv }),
          timeoutMs: 60_000,
        }),
      ),
  });
}

export function useImportCsv(scope: DictionaryScope) {
  const base = useBasePath(scope);
  const invalidate = useInvalidateScope(scope);

  return useMutation({
    mutationFn: async ({
      slug,
      csv,
      mapping,
      mode,
    }: {
      slug: string;
      csv: string;
      mapping: CsvMapping;
      mode: 'replace' | 'merge';
    }) =>
      unwrap<ImportResult>(
        await fetchApi(`${base}/${encodeURIComponent(slug)}/import/csv`, {
          method: 'POST',
          body: JSON.stringify({ csv, mapping, mode }),
          timeoutMs: IMPORT_TIMEOUT_MS,
        }),
      ),
    onSuccess: invalidate,
  });
}

/**
 * Download a list as CSV.
 *
 * A plain `<a href>` cannot carry the Authorization header — the access token
 * lives in memory and never in a cookie readable by the browser's navigation —
 * so the file is fetched, turned into a blob, and handed to a synthetic link.
 */
function useCsvDownload(scope: DictionaryScope, endpoint: 'export' | 'template') {
  const base = useBasePath(scope);

  return useMutation({
    mutationFn: async ({ slug, name }: { slug: string; name?: string }) => {
      const token = getAccessToken();
      const response = await fetch(
        `${API_BASE_URL}${base}/${encodeURIComponent(slug)}/${endpoint}`,
        {
          credentials: 'include',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        },
      );
      if (!response.ok) {
        throw new Error(
          response.status === 404
            ? 'That list no longer exists.'
            : `Could not download the file (${response.status}).`,
        );
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const stem = name ? name.replace(/[^\w\s-]/g, '').trim() || slug : slug;
      link.href = url;
      link.download = endpoint === 'template' ? `${stem} template.csv` : `${stem}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Revoking immediately can cancel the download in some browsers; a tick
      // is enough for the click to have been dispatched.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  });
}

/** Download the list's current contents, in the layout the importer accepts. */
export function useExportCsv(scope: DictionaryScope) {
  return useCsvDownload(scope, 'export');
}

/**
 * Download a blank starter file for the list.
 *
 * Distinct from export, which is empty for an empty list — precisely the case
 * where someone most needs to be told what the columns are.
 */
export function useTemplateCsv(scope: DictionaryScope) {
  return useCsvDownload(scope, 'template');
}
