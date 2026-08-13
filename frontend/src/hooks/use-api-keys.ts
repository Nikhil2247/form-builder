import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchApi, unwrap } from '@/lib/api';
import { useOrgId } from './use-auth';

/**
 * API key types mirror what `ApiKeysService.toPublicApiKey` returns, and
 * nothing more.
 *
 * There is deliberately no `key` field on the list type. The API stores only
 * the SHA-256 hash, so there is no route anywhere that can return the raw key
 * a second time — declaring one optionally on the shared type would invite a
 * `key.key ?? '—'` somewhere that renders a permanent em dash and teaches the
 * reader that the value merely happens to be absent.
 */

/** The scope vocabulary, mirroring API_KEY_SCOPES on the API. */
export const API_KEY_SCOPES = [
  'forms:read',
  'forms:write',
  'submissions:read',
  'submissions:export',
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

/** What each scope actually permits, for the create form. */
export const API_KEY_SCOPE_LABELS: Record<ApiKeyScope, string> = {
  'forms:read': 'Read form definitions and questions',
  'forms:write': 'Create and update forms',
  'submissions:read': 'List and read responses',
  'submissions:export': 'Download full response exports',
};

export interface ApiKey {
  id: string;
  name: string;
  scopes: string[];
  /**
   * First 8 hex characters of the key's SHA-256 hash — a stable, non-reversible
   * label for telling two keys apart. NOT the last characters of the key: the
   * plaintext is never stored, so there is nothing to show a suffix of.
   */
  fingerprint: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  /** Non-null once revoked. Revoked keys stay listed — see the schema comment. */
  revokedAt: string | null;
  createdAt: string;
}

/** The create response, and the only shape that ever carries `key`. */
export interface CreatedApiKey extends ApiKey {
  /** The raw `fbk_…` secret. Returned exactly once and never retrievable. */
  key: string;
}

export function useApiKeys() {
  const orgId = useOrgId();

  return useQuery<ApiKey[]>({
    queryKey: ['api-keys', orgId],
    queryFn: async () => {
      const data = unwrap<unknown>(await fetchApi(`/organizations/${orgId}/api-keys`));
      return Array.isArray(data) ? (data as ApiKey[]) : [];
    },
    enabled: !!orgId,
  });
}

/**
 * Mint a key.
 *
 * The mutation result is the ONE place the plaintext exists in the browser.
 * The caller must show it immediately — nothing refetches it, because nothing
 * can.
 */
export function useCreateApiKey() {
  const qc = useQueryClient();
  const orgId = useOrgId();

  return useMutation({
    meta: { errorFallback: 'Could not create this API key' },
    mutationFn: async (dto: { name: string; scopes?: string[]; expiresAt?: string | null }) =>
      unwrap<CreatedApiKey>(
        await fetchApi(`/organizations/${orgId}/api-keys`, {
          method: 'POST',
          body: JSON.stringify(dto),
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-keys', orgId] }),
  });
}

/**
 * Revoke a key.
 *
 * DELETE on the wire, a soft revoke in the database: the row survives with
 * `revokedAt` set so an incident review can still see what the key was scoped
 * to and when it was last used. The list therefore still contains the key after
 * this resolves — invalidating rather than removing it from the cache is the
 * correct behaviour, not an oversight.
 */
export function useRevokeApiKey() {
  const qc = useQueryClient();
  const orgId = useOrgId();

  return useMutation({
    meta: { errorFallback: 'Could not revoke this API key' },
    mutationFn: (keyId: string) =>
      fetchApi(`/organizations/${orgId}/api-keys/${keyId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-keys', orgId] }),
  });
}
