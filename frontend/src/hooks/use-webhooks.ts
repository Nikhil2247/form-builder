import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchApi, unwrap } from '@/lib/api';
import { useOrgId } from './use-auth';

/**
 * Webhook types mirror the FormWebhook / WebhookDelivery models exactly.
 *
 * The previous versions declared `events: string[]`, `updatedAt`,
 * `failureCount`, and `lastTriggeredAt` on Webhook, and `event`, `status`,
 * `error`, `createdAt`, and `durationMs` on WebhookDelivery. None of those
 * columns exist. Every one rendered as `undefined` behind a fallback, so the
 * integrations page showed an empty events list, "Never" for last delivery on
 * webhooks that had fired thousands of times, and a blank status for every
 * delivery attempt.
 */

export interface Webhook {
  id: string;
  formId: string;
  url: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  _count?: { deliveries: number };
  /** Returned once, at creation and on rotation. Never on reads. */
  secret?: string;
}

export interface WebhookDelivery {
  id: string;
  submissionId: string;
  /** Null when the request never completed (DNS failure, timeout, blocked). */
  statusCode: number | null;
  attempt: number;
  success: boolean;
  deliveredAt: string;
  /** Truncated to 512 bytes server-side. */
  responseBody: string | null;
}

/**
 * All webhook routes are nested under a form and guarded with
 * `@RequiredRole('ADMIN')`. `enabled` therefore requires a formId — firing
 * without one produced a request to `/forms/undefined/webhooks` on every mount
 * of the integrations page before a form was chosen.
 */
export function useWebhooks(formId?: string) {
  const orgId = useOrgId();

  return useQuery<Webhook[]>({
    queryKey: ['webhooks', orgId, formId],
    queryFn: async () => {
      const data = unwrap<any>(await fetchApi(`/organizations/${orgId}/forms/${formId}/webhooks`));
      return Array.isArray(data) ? data : (data?.webhooks ?? []);
    },
    enabled: !!orgId && !!formId,
  });
}

export function useWebhookDeliveries(formId?: string, webhookId?: string) {
  const orgId = useOrgId();

  return useQuery<WebhookDelivery[]>({
    queryKey: ['webhook-deliveries', orgId, formId, webhookId],
    queryFn: async () => {
      const data = unwrap<any>(
        await fetchApi(`/organizations/${orgId}/forms/${formId}/webhooks/${webhookId}/deliveries`),
      );
      return Array.isArray(data) ? data : (data?.deliveries ?? []);
    },
    enabled: !!orgId && !!formId && !!webhookId,
    // Deliveries are the debugging surface; keep them fresh while open.
    staleTime: 10_000,
  });
}

export function useCreateWebhook(formId?: string) {
  const qc = useQueryClient();
  const orgId = useOrgId();

  return useMutation({
    meta: { errorFallback: 'Could not create this webhook' },
    mutationFn: async (dto: { url: string; name?: string }) =>
      unwrap<Webhook>(
        await fetchApi(`/organizations/${orgId}/forms/${formId}/webhooks`, {
          method: 'POST',
          body: JSON.stringify(dto),
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhooks', orgId, formId] }),
  });
}

export function useDeleteWebhook(formId?: string) {
  const qc = useQueryClient();
  const orgId = useOrgId();

  return useMutation({
    meta: { errorFallback: 'Could not delete this webhook' },
    mutationFn: (webhookId: string) =>
      fetchApi(`/organizations/${orgId}/forms/${formId}/webhooks/${webhookId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhooks', orgId, formId] }),
  });
}

/** Returns the new secret. It is shown once and never retrievable again. */
export function useRotateWebhookSecret(formId?: string) {
  const qc = useQueryClient();
  const orgId = useOrgId();

  return useMutation({
    meta: { errorFallback: 'Could not rotate the secret' },
    mutationFn: async (webhookId: string) =>
      unwrap<{ secret: string }>(
        await fetchApi(
          `/organizations/${orgId}/forms/${formId}/webhooks/${webhookId}/rotate-secret`,
          { method: 'POST' },
        ),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhooks', orgId, formId] }),
  });
}
