import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchApi } from '@/lib/api';
import { useUser } from './use-auth';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
export interface Webhook {
  id: string;
  url: string;
  events: string[];
  isActive: boolean;
  secret?: string;
  createdAt: string;
  updatedAt: string;
}

export const WEBHOOK_EVENTS = [
  { value: 'form.submitted', label: 'Form Submitted' },
  { value: 'form.published', label: 'Form Published' },
  { value: 'form.deleted', label: 'Form Deleted' },
  { value: 'form.restored', label: 'Form Restored' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Hooks
// ─────────────────────────────────────────────────────────────────────────────

function useOrgId() {
  const { data: session } = useUser();
  return session?.activeOrganization?.id;
}

/** List all webhooks for a specific form */
export function useWebhooks(formId?: string) {
  const orgId = useOrgId();
  return useQuery<Webhook[]>({
    queryKey: ['webhooks', orgId, formId],
    queryFn: async () => {
      const res = await fetchApi(`/organizations/${orgId}/forms/${formId}/webhooks`);
      // Backend returns a plain array
      return Array.isArray(res.data) ? res.data : res.data?.webhooks ?? res.data ?? [];
    },
    // Only fire when both orgId and formId are known
    enabled: !!orgId && !!formId,
  });
}

/** Create a new webhook for a specific form */
export function useCreateWebhook(formId?: string) {
  const qc = useQueryClient();
  const orgId = useOrgId();
  return useMutation({
    mutationFn: async (dto: { url: string; name?: string }) => {
      const res = await fetchApi(`/organizations/${orgId}/forms/${formId}/webhooks`, {
        method: 'POST',
        body: JSON.stringify(dto),
      });
      return res.data ?? res;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['webhooks', orgId, formId] });
    },
  });
}

/** Update a webhook */
export function useUpdateWebhook(webhookId: string) {
  const qc = useQueryClient();
  const orgId = useOrgId();
  return useMutation({
    mutationFn: async (dto: Partial<Webhook>) => {
      const res = await fetchApi(`/organizations/${orgId}/webhooks/${webhookId}`, {
        method: 'PUT',
        body: JSON.stringify(dto),
      });
      return res.data?.webhook ?? res.data ?? res;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['webhooks', orgId] });
    },
  });
}

/** Delete a webhook */
export function useDeleteWebhook(formId?: string) {
  const qc = useQueryClient();
  const orgId = useOrgId();
  return useMutation({
    mutationFn: async (webhookId: string) => {
      await fetchApi(`/organizations/${orgId}/forms/${formId}/webhooks/${webhookId}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['webhooks', orgId, formId] });
    },
  });
}
