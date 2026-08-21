'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchApi, unwrap } from '@/lib/api';
import { useOrgId } from './use-auth';

/**
 * The unified assistant (AI_ASSISTANT_IMPROVEMENT_PLAN.md, Phase C).
 *
 * One chat, one endpoint (`POST .../assistant/messages`), every capability
 * available — the mode toggler in AssistantPanel only changes a suggested
 * prompt and a short hint line sent with the turn (`modeHint`), never which
 * tools or system prompt the backend uses (see org-chat.ts on the backend).
 *
 * No token-level streaming yet — a turn is a single request/response. The
 * backend's loop (route, call tools, maybe ask a follow-up) can take a few
 * seconds; the composer shows a loading state for that window. Every request
 * is abortable via the `signal` passed to useAskAssistant's mutate — the
 * panel wires this to Cancel and to closing mid-request.
 */

export interface AssistantMessage {
  id: string;
  role: 'USER' | 'ASSISTANT' | 'TOOL';
  content: { text?: string };
  modelUsed?: string | null;
  /** Decimal on the wire — a string, not a number. */
  costUsd?: string | null;
  createdAt: string;
}

export interface AssistantSession {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  messages: AssistantMessage[];
}

export interface AssistantTimeseriesPoint {
  date: string;
  submissions: number;
  views: number;
  starts: number;
}

export interface AssistantClarify {
  question: string;
  options?: string[];
  why: string;
}

export interface AssistantPlanOutline {
  // plan_form
  title?: string;
  questionCount?: number;
  questions?: string[];
  // plan_form_app
  subjectTypeName?: string;
  appName?: string;
  steps?: Array<{ title: string; questionCount: number }>;
}

export interface AssistantPlan {
  planId: string;
  kind: 'FORM' | 'FORM_APP';
  outline: AssistantPlanOutline;
}

export interface AssistantCreated {
  kind: 'FORM' | 'FORM_APP';
  // FORM
  formId?: string;
  title?: string;
  questionCount?: number;
  // FORM_APP
  subjectType?: { id: string; name: string };
  formApp?: { id: string; name: string; slug: string };
  steps?: Array<{ id: string; title: string; formId: string }>;
}

export interface AskAssistantResult {
  sessionId: string;
  reply: string;
  clarify?: AssistantClarify;
  chartData?: AssistantTimeseriesPoint[];
  plan?: AssistantPlan;
  created?: AssistantCreated;
  /** This turn's cost in USD — shown to Admins only; see AssistantPanel. */
  costUsd: number;
}

const SESSIONS_KEY = ['assistant', 'sessions'] as const;

export function useAssistantSessions(params: { enabled?: boolean } = {}) {
  const orgId = useOrgId();

  return useQuery({
    queryKey: [...SESSIONS_KEY, orgId],
    queryFn: async () =>
      unwrap<{ sessions: AssistantSession[] }>(
        await fetchApi(`/organizations/${orgId}/assistant/sessions?limit=20`),
      ),
    enabled: !!orgId && (params.enabled ?? true),
  });
}

/**
 * Loads one session on demand (picking it from the history dropdown) — a
 * mutation rather than a query, so the panel can hydrate its local turn list
 * imperatively in the click handler instead of syncing query data into state
 * via an effect.
 */
export function useLoadAssistantSession() {
  const orgId = useOrgId();

  return useMutation({
    meta: { errorFallback: 'Could not load that chat' },
    mutationFn: async (sessionId: string) =>
      unwrap<AssistantSession>(
        await fetchApi(`/organizations/${orgId}/assistant/sessions/${sessionId}`),
      ),
  });
}

export interface AskAssistantPayload {
  message: string;
  sessionId?: string;
  /** The form the user currently has open, if any — lets explain_rule/propose_rule work without asking for a formId. */
  currentFormId?: string;
  /** Which mode chip is active — a UI hint only, never a change in capability. */
  modeHint?: string;
  /** Wired to Cancel and to the panel closing mid-request. */
  signal?: AbortSignal;
}

export function useAskAssistant() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();

  return useMutation({
    meta: { errorFallback: 'Could not reach the assistant' },
    mutationFn: async ({ signal, ...body }: AskAssistantPayload) =>
      unwrap<AskAssistantResult>(
        await fetchApi(`/organizations/${orgId}/assistant/messages`, {
          method: 'POST',
          body: JSON.stringify(body),
          signal,
        }),
      ),
    onSuccess: () => {
      // Only the history list — the panel already holds this turn's messages
      // locally and doesn't need a round trip to see its own reply.
      queryClient.invalidateQueries({ queryKey: [...SESSIONS_KEY, orgId], exact: false });
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Platform (cross-org) assistant — superadmin only, a separate endpoint with
// no organization in scope. See platform-assistant.controller.ts.
// ─────────────────────────────────────────────────────────────────────────────

const PLATFORM_SESSIONS_KEY = ['assistant', 'platform', 'sessions'] as const;

export function usePlatformAssistantSessions(params: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: PLATFORM_SESSIONS_KEY,
    queryFn: async () =>
      unwrap<{ sessions: AssistantSession[] }>(
        await fetchApi(`/admin/assistant/sessions?limit=20`),
      ),
    enabled: params.enabled ?? false,
  });
}

/** See useLoadAssistantSession above for why this is a mutation, not a query. */
export function useLoadPlatformAssistantSession() {
  return useMutation({
    meta: { errorFallback: 'Could not load that chat' },
    mutationFn: async (sessionId: string) =>
      unwrap<AssistantSession>(await fetchApi(`/admin/assistant/sessions/${sessionId}`)),
  });
}

export interface AskPlatformAssistantPayload {
  message: string;
  sessionId?: string;
  signal?: AbortSignal;
}

export function useAskPlatformAssistant() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: { errorFallback: 'Could not reach the platform assistant' },
    mutationFn: async ({ signal, ...body }: AskPlatformAssistantPayload) =>
      unwrap<AskAssistantResult>(
        await fetchApi(`/admin/assistant/messages`, {
          method: 'POST',
          body: JSON.stringify(body),
          signal,
        }),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PLATFORM_SESSIONS_KEY, exact: false });
    },
  });
}

/**
 * Per-org usage aggregate — AI_ASSISTANT_IMPROVEMENT_PLAN.md §3.8. Visibility
 * only (tokens, queries, cost, cache-hit rate); there is no spend ceiling to
 * enforce (see the plan's §6 decision 3).
 */
export interface AssistantUsageRow {
  organizationId: string | null;
  organizationName: string;
  totalQueries: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  cacheHitRate: number | null;
}

/** Cross-org usage, sorted by spend descending — the superadmin "who's using the most" view. */
export function usePlatformAssistantUsage(days = 30) {
  return useQuery({
    queryKey: ['assistant', 'platform', 'usage', days],
    queryFn: async () =>
      unwrap<AssistantUsageRow[]>(
        await fetchApi(`/admin/assistant/usage?days=${days}`),
      ),
  });
}
