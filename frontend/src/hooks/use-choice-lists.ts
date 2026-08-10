'use client';

import { useEffect, useState } from 'react';

import { fetchApi, unwrap } from '@/lib/api';
import { useOrgId } from '@/hooks/use-auth';

/**
 * The choice lists this organization can bind a question to.
 *
 * Includes both the org's own lists and the platform-global ones (India's
 * states and districts ship that way), because the API resolves visibility —
 * the client should not be reconstructing that predicate.
 */

export interface ChoiceListSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  itemCount: number;
  version: number;
  isGlobal: boolean;
  parentList: { id: string; slug: string; name: string } | null;
  metadataSchema?: Array<{ key: string; label: string; type: string }>;
}

export function useChoiceLists(): {
  lists: ChoiceListSummary[];
  isLoading: boolean;
  error: string | null;
} {
  const orgId = useOrgId();
  const [lists, setLists] = useState<ChoiceListSummary[]>([]);
  const [state, setState] = useState<{ loaded: boolean; error: string | null }>({
    loaded: false,
    error: null,
  });

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;

    fetchApi(`/organizations/${orgId}/choice-lists`)
      .then((response) => {
        if (cancelled) return;
        const data = unwrap<ChoiceListSummary[]>(response);
        setLists(Array.isArray(data) ? data : []);
        setState({ loaded: true, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          loaded: true,
          error: err instanceof Error ? err.message : 'Could not load the option lists.',
        });
      });

    return () => {
      cancelled = true;
    };
  }, [orgId]);

  return { lists, isLoading: !!orgId && !state.loaded, error: state.error };
}
