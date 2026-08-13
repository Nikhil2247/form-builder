import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchApi, unwrap } from '@/lib/api';
import { useOrgId } from './use-auth';
import type { SubmissionStatus } from './use-submissions';

/**
 * The single-submission read and the three write operations behind it.
 *
 * Kept out of `use-submissions.ts` because that file is the LIST surface and
 * these are the DETAIL surface: they invalidate the list rather than being part
 * of it, and every one of them is a mutation whose cache fan-out has to be
 * thought about once, in one place. See `invalidateSubmissions` below.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SubmissionActor {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  avatarUrl?: string | null;
}

/**
 * One answer, already matched to its question by the API.
 *
 * The label, key and type come from the submission's OWN form version, not the
 * form's current one. That resolution deliberately happens server-side: the
 * client only ever holds the current version's questions, so doing it here
 * would silently relabel historic answers whenever a form was re-published —
 * the exact failure the immutable-version design exists to prevent.
 */
export interface SubmissionAnswer {
  questionId: string;
  key: string | null;
  label: string;
  type: string;
  value: unknown;
  answered: boolean;
  /** Present in the stored payload but absent from that version's schema. */
  orphaned: boolean;
}

export interface SubmissionFile {
  id: string;
  questionId: string;
  originalName: string;
  mimeType: string;
  /** A string, not a number: the column is a BigInt server-side. */
  sizeBytes: string;
  status: 'PENDING_UPLOAD' | 'VERIFIED' | 'QUARANTINED' | 'DELETED' | string;
  verifiedAt: string | null;
  /**
   * Null when the file cannot currently be served — still uploading, or
   * quarantined by the scanner. The row is still listed, because "there is a
   * file here and it is quarantined" is information the reviewer needs.
   */
  downloadUrl: string | null;
}

export interface SubmissionDetail {
  id: string;
  formId: string;
  formVersionId: string;
  form: { id: string; title: string; slug: string };
  formVersion: { id: string; version: number };
  subjectId: string | null;
  subject: { id: string; displayName: string; externalId: string | null } | null;
  submittedAt: string;
  processedAt: string | null;
  completionTimeMs: number;
  status: SubmissionStatus;
  country: string | null;
  quizScore: number | null;
  maxQuizScore: number | null;
  isPassed: boolean | null;
  respondent: SubmissionActor | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  reviewedBy: SubmissionActor | null;
  deletedAt: string | null;
  deletedBy: SubmissionActor | null;
  answers: SubmissionAnswer[];
  files: SubmissionFile[];
}

/** The statuses a reviewer may set. DELETED goes through the delete route. */
export type ReviewableStatus = Extract<
  SubmissionStatus,
  'SUBMITTED' | 'FLAGGED_SPAM' | 'REJECTED'
>;

export interface BulkSubmissionsResult {
  action: 'SET_STATUS' | 'DELETE';
  status?: ReviewableStatus;
  requested: number;
  affected: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cache
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every cache key a submission mutation can invalidate.
 *
 * There are three list surfaces reading the same rows — the org-wide list, the
 * per-form list, and a record's timeline — plus the detail itself. Marking a
 * response as spam from the org-wide list and leaving the per-form table
 * showing the old status is the kind of bug that gets reported as "it didn't
 * save", so the fan-out is written once here rather than at each call site.
 */
function useInvalidateSubmissions() {
  const qc = useQueryClient();
  const orgId = useOrgId();

  return (submissionIds?: readonly string[]) => {
    qc.invalidateQueries({ queryKey: ['org-submissions', orgId] });
    qc.invalidateQueries({ queryKey: ['submissions', orgId] });
    qc.invalidateQueries({ queryKey: ['subject-timeline'] });
    // The form list shows a response count per form, and a delete moves it.
    qc.invalidateQueries({ queryKey: ['forms', orgId] });

    for (const id of submissionIds ?? []) {
      qc.invalidateQueries({ queryKey: ['submission', orgId, id] });
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Query
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One submission, fully resolved.
 *
 * `enabled` is gated on the id so the hook can be mounted unconditionally by a
 * drawer that is currently closed — calling hooks conditionally is not an
 * option, and mounting/unmounting the drawer instead would throw away the
 * cached detail every time it closed.
 */
export function useSubmissionDetail(submissionId: string | null | undefined) {
  const orgId = useOrgId();

  return useQuery<SubmissionDetail>({
    queryKey: ['submission', orgId, submissionId],
    queryFn: async () =>
      unwrap<SubmissionDetail>(
        await fetchApi(`/organizations/${orgId}/submissions/${submissionId}`),
      ),
    enabled: !!orgId && !!submissionId,
    // A response is immutable apart from its review fields, and those are
    // invalidated explicitly by the mutations below. Nothing else can change
    // it, so refetching on every window focus is pure waste.
    staleTime: 60_000,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────────────────────────────────

export interface ReviewSubmissionInput {
  submissionId: string;
  /** Omit to leave unchanged; `null` to clear. */
  reviewNote?: string | null;
  status?: ReviewableStatus;
}

/** PATCH — set the review note and/or move the status. */
export function useReviewSubmission() {
  const orgId = useOrgId();
  const invalidate = useInvalidateSubmissions();

  return useMutation({
    meta: { errorFallback: 'Could not update this response' },
    mutationFn: async ({ submissionId, ...body }: ReviewSubmissionInput) => {
      if (!orgId) throw new Error('No active organization');
      return unwrap<{ id: string; status: SubmissionStatus; reviewNote: string | null }>(
        await fetchApi(`/organizations/${orgId}/submissions/${submissionId}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        }),
      );
    },
    onSuccess: (_result, variables) => invalidate([variables.submissionId]),
  });
}

/** DELETE — soft delete. The row disappears from every list. */
export function useDeleteSubmission() {
  const orgId = useOrgId();
  const invalidate = useInvalidateSubmissions();

  return useMutation({
    meta: { errorFallback: 'Could not delete this response' },
    mutationFn: async (submissionId: string) => {
      if (!orgId) throw new Error('No active organization');
      return unwrap<{ id: string; deleted: boolean }>(
        await fetchApi(`/organizations/${orgId}/submissions/${submissionId}`, {
          method: 'DELETE',
        }),
      );
    },
    onSuccess: (_result, submissionId) => invalidate([submissionId]),
  });
}

export type BulkSubmissionsInput =
  | { action: 'SET_STATUS'; ids: string[]; status: ReviewableStatus }
  | { action: 'DELETE'; ids: string[] };

/**
 * POST /submissions/bulk — status change or soft-delete over a list of ids.
 *
 * The API is all-or-nothing: if a single id is not resolvable inside the
 * organization the whole call fails and nothing is written. That is worth
 * knowing at the call site, because it means a partial-success UI would be
 * describing a state the server never produces — the result is either
 * `affected === requested` or an error.
 */
export function useBulkSubmissions() {
  const orgId = useOrgId();
  const invalidate = useInvalidateSubmissions();

  return useMutation({
    meta: { errorFallback: 'Could not apply that action' },
    mutationFn: async (input: BulkSubmissionsInput) => {
      if (!orgId) throw new Error('No active organization');
      return unwrap<BulkSubmissionsResult>(
        await fetchApi(`/organizations/${orgId}/submissions/bulk`, {
          method: 'POST',
          body: JSON.stringify(input),
        }),
      );
    },
    onSuccess: (_result, input) => invalidate(input.ids),
  });
}
