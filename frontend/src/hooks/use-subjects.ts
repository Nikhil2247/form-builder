import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { DEFAULT_PAGE_SIZE } from './use-pagination';
import { fetchApi, unwrap } from '@/lib/api';
import { useOrgId } from './use-auth';

/**
 * Subject types and subject records — the Data Apps read model.
 *
 * A subject is the longitudinal record (a person, a household, an asset) that
 * accumulates submissions over time. Its *type* declares how a registration
 * answer set is projected onto the record: which question keys make up the
 * display name, which are promoted to searchable attributes, and which carries
 * the external id.
 *
 * Same conventions as use-forms.ts: keys are arrays prefixed with the resource
 * name and the org id, every query is gated on `enabled: !!orgId`, and every
 * mutation invalidates by *prefix* so a change on page 2 is not left stale on
 * page 1.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Identity projection. Every string here is a QUESTION KEY on the registration
 * form, not a question id — a form can be re-published with new question ids
 * for the same logical field, and this config has to survive that.
 */
export interface IdentityConfig {
  /** Keys concatenated, in order, into `Subject.displayName`. */
  displayName?: string[];
  /** Keys promoted onto `Subject.attributes` for search and prefill. */
  attributes?: string[];
  /** Key holding a caller-supplied stable id. */
  externalId?: string;
}

/** The trimmed subject type carried alongside a subject. */
export interface SubjectTypeRef {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
}

export interface SubjectType extends SubjectTypeRef {
  registrationFormId: string | null;
  identityConfig: IdentityConfig;
  _count?: { subjects: number; forms: number };
}

/** Attribute values are whatever the answer was — scalar, array, or object. */
export type AttributeValue = string | number | boolean | null | AttributeValue[] | { [key: string]: AttributeValue };

export interface Subject {
  id: string;
  displayName: string;
  externalId: string | null;
  attributes: Record<string, AttributeValue>;
  createdAt: string;
  subjectType: SubjectTypeRef;
}

/** `GET /subjects/:id` includes the full subject type, not just the ref. */
export interface SubjectDetail extends Omit<Subject, 'subjectType'> {
  subjectType: SubjectType;
  registrationSubmissionId?: string | null;
  updatedAt?: string;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface SubjectsResponse {
  subjects: Subject[];
  pagination: PaginationMeta;
}

/** One submission attached to a record. */
export interface TimelineEntry {
  id: string;
  formId: string;
  submittedAt: string;
  answers: Record<string, AttributeValue>;
  status: string;
  form: { id: string; title: string } | null;
}

export interface TimelineResponse {
  entries: TimelineEntry[];
  pagination: PaginationMeta;
}

/** Advisory duplicate match. Never blocks; the operator decides. */
export interface DuplicateSubject {
  id: string;
  displayName: string;
  externalId: string | null;
  createdAt: string;
  attributes: Record<string, AttributeValue>;
}

export interface SubjectsQuery {
  page?: number;
  limit?: number;
  subjectTypeId?: string;
  search?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Subject types
// ─────────────────────────────────────────────────────────────────────────────

export function useSubjectTypes(options: { enabled?: boolean } = {}) {
  const orgId = useOrgId();

  return useQuery<SubjectType[]>({
    queryKey: ['subject-types', orgId],
    queryFn: async () => {
      const data = unwrap<SubjectType[] | { subjectTypes?: SubjectType[] }>(
        await fetchApi(`/organizations/${orgId}/subject-types`),
      );
      return Array.isArray(data) ? data : (data?.subjectTypes ?? []);
    },
    enabled: !!orgId && options.enabled !== false,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Subjects
// ─────────────────────────────────────────────────────────────────────────────

export function useSubjects(query: SubjectsQuery = {}, options: { enabled?: boolean } = {}) {
  const orgId = useOrgId();
  const { page = 1, limit = DEFAULT_PAGE_SIZE, subjectTypeId, search } = query;

  return useQuery<SubjectsResponse>({
    queryKey: ['subjects', orgId, { page, limit, subjectTypeId, search }],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (subjectTypeId && subjectTypeId !== 'ALL') params.set('subjectTypeId', subjectTypeId);
      if (search) params.set('search', search);

      const data = unwrap<SubjectsResponse>(
        await fetchApi(`/organizations/${orgId}/subjects?${params}`),
      );
      return {
        subjects: data.subjects ?? [],
        pagination:
          data.pagination ?? { page, limit, total: data.subjects?.length ?? 0, totalPages: 1 },
      };
    },
    enabled: !!orgId && options.enabled !== false,
    // Keeps the current page on screen (dimmed) while the next one loads,
    // instead of collapsing the table to skeletons on every page change.
    placeholderData: keepPreviousData,
  });
}

export function useSubject(subjectId: string | undefined, options: { enabled?: boolean } = {}) {
  const orgId = useOrgId();

  return useQuery<SubjectDetail>({
    queryKey: ['subject', orgId, subjectId],
    queryFn: async () =>
      unwrap<SubjectDetail>(await fetchApi(`/organizations/${orgId}/subjects/${subjectId}`)),
    enabled: !!orgId && !!subjectId && options.enabled !== false,
  });
}

export function useSubjectTimeline(
  subjectId: string | undefined,
  query: { page?: number; limit?: number } = {},
  options: { enabled?: boolean } = {},
) {
  const orgId = useOrgId();
  const { page = 1, limit = DEFAULT_PAGE_SIZE } = query;

  return useQuery<TimelineResponse>({
    queryKey: ['subject-timeline', orgId, subjectId, { page, limit }],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      const data = unwrap<TimelineResponse>(
        await fetchApi(`/organizations/${orgId}/subjects/${subjectId}/timeline?${params}`),
      );
      return {
        entries: data.entries ?? [],
        pagination:
          data.pagination ?? { page, limit, total: data.entries?.length ?? 0, totalPages: 1 },
      };
    },
    enabled: !!orgId && !!subjectId && options.enabled !== false,
    placeholderData: keepPreviousData,
  });
}

/**
 * Possible duplicates for a record about to be registered.
 *
 * Exact matching only, and advisory: it warns, it never blocks and never
 * merges. Disabled until there is something to match on, so an empty form does
 * not fire a request per keystroke.
 */
export function useSubjectDuplicates(
  params: { subjectTypeId?: string; displayName?: string; externalId?: string },
  options: { enabled?: boolean } = {},
) {
  const orgId = useOrgId();
  const { subjectTypeId, displayName, externalId } = params;
  const hasCandidate = !!displayName?.trim() || !!externalId?.trim();

  return useQuery<DuplicateSubject[]>({
    queryKey: ['subject-duplicates', orgId, { subjectTypeId, displayName, externalId }],
    queryFn: async () => {
      const search = new URLSearchParams({ subjectTypeId: subjectTypeId ?? '' });
      if (displayName) search.set('displayName', displayName);
      if (externalId) search.set('externalId', externalId);

      const data = unwrap<DuplicateSubject[]>(
        await fetchApi(`/organizations/${orgId}/subjects/duplicates?${search}`),
      );
      return Array.isArray(data) ? data : [];
    },
    enabled: !!orgId && !!subjectTypeId && hasCandidate && options.enabled !== false,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Mutations
//
// Invalidation is by prefix — ['subject-types', orgId] and ['subjects', orgId]
// clear every page, filter, and sort variant of those lists.
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateSubjectTypeDto {
  name: string;
  slug?: string;
  icon?: string;
  identityConfig?: IdentityConfig;
}

export interface UpdateSubjectTypeDto {
  name?: string;
  icon?: string;
  identityConfig?: IdentityConfig;
  registrationFormId?: string | null;
}

export function useCreateSubjectType() {
  const qc = useQueryClient();
  const orgId = useOrgId();

  return useMutation({
    mutationFn: async (dto: CreateSubjectTypeDto) => {
      if (!orgId) throw new Error('No active organization');
      return unwrap<SubjectType>(
        await fetchApi(`/organizations/${orgId}/subject-types`, {
          method: 'POST',
          body: JSON.stringify(dto),
        }),
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['subject-types', orgId] });
    },
  });
}

export function useUpdateSubjectType() {
  const qc = useQueryClient();
  const orgId = useOrgId();

  return useMutation({
    mutationFn: async ({
      subjectTypeId,
      ...dto
    }: UpdateSubjectTypeDto & { subjectTypeId: string }) => {
      if (!orgId) throw new Error('No active organization');
      return unwrap<SubjectType>(
        await fetchApi(`/organizations/${orgId}/subject-types/${subjectTypeId}`, {
          method: 'PATCH',
          body: JSON.stringify(dto),
        }),
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['subject-types', orgId] });
      // Binding a registration form also stamps the form itself.
      qc.invalidateQueries({ queryKey: ['forms', orgId] });
    },
  });
}

export function useDeleteSubjectType() {
  const qc = useQueryClient();
  const orgId = useOrgId();

  return useMutation({
    mutationFn: async (subjectTypeId: string) => {
      if (!orgId) throw new Error('No active organization');
      await fetchApi(`/organizations/${orgId}/subject-types/${subjectTypeId}`, {
        method: 'DELETE',
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['subject-types', orgId] });
    },
  });
}

export function useDeleteSubject() {
  const qc = useQueryClient();
  const orgId = useOrgId();

  return useMutation({
    mutationFn: async (subjectId: string) => {
      if (!orgId) throw new Error('No active organization');
      await fetchApi(`/organizations/${orgId}/subjects/${subjectId}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['subjects', orgId] });
      qc.invalidateQueries({ queryKey: ['subject-types', orgId] });
    },
  });
}
