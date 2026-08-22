/**
 * Retention, naming, and content-type policy for asynchronous exports.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Pure functions, no I/O — every decision that has to be identical in three
 * places (the API that answers "when does this expire?", the worker that stamps
 * `expiresAt`, and the sweeper that decides what to delete) lives here exactly
 * once. The previous synchronous export had none of this because the bytes
 * never came to rest anywhere: they went straight down the socket. An async
 * export leaves a full copy of a tenant's response data sitting in a bucket,
 * and that copy is the thing that must not outlive its usefulness.
 */

/**
 * Default retention window.
 *
 * Deliberately short. An export is a *derived* artefact — it can always be
 * regenerated from the submissions it was built from — so there is no
 * durability argument for keeping it, only a convenience one, and convenience
 * expires quickly. Seven days covers "I ran it Friday, I need it Monday"
 * without turning the bucket into a shadow copy of the responses table.
 */
export const DEFAULT_RETENTION_DAYS = 7;

/**
 * Bounds on the configurable window.
 *
 * The floor exists because a retention shorter than a day makes the download
 * link expire while the person who requested it is still in the same meeting.
 * The ceiling exists because the whole point of the feature is that these files
 * do not accumulate; an operator who sets `EXPORT_RETENTION_DAYS=3650` has
 * almost certainly made a typo, and honouring it silently would be the worst
 * possible reading of their intent.
 */
export const MIN_RETENTION_DAYS = 1;
export const MAX_RETENTION_DAYS = 90;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Resolve the retention window from configuration, clamped and NaN-proofed.
 *
 * `parseInt('')`, `parseInt('seven')` and `parseInt(undefined!)` all produce
 * NaN, and `new Date(completedAt + NaN)` is an Invalid Date that Prisma rejects
 * at write time — i.e. a typo in an env var would fail the export *after* the
 * file had already been uploaded, which is the most expensive place to fail.
 */
export function resolveRetentionDays(
  raw: string | undefined = process.env.EXPORT_RETENTION_DAYS,
): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed)) return DEFAULT_RETENTION_DAYS;
  return Math.min(MAX_RETENTION_DAYS, Math.max(MIN_RETENTION_DAYS, parsed));
}

/**
 * The instant a finished export becomes eligible for sweeping.
 *
 * Measured from completion, not from creation: a job that sat in the queue for
 * twenty minutes behind a larger one should not arrive with twenty minutes of
 * its retention already spent.
 */
export function retentionExpiryFrom(
  completedAt: Date,
  days: number = resolveRetentionDays(),
): Date {
  return new Date(completedAt.getTime() + days * MS_PER_DAY);
}

/** True when a stored export has passed its retention window as of `now`. */
export function isRetentionExpired(
  expiresAt: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!expiresAt) return false;
  return expiresAt.getTime() <= now.getTime();
}

/**
 * Object key for a finished export.
 *
 * Two properties matter and neither is cosmetic:
 *
 *  • The `exports/` root is separate from `uploads/`. Respondent uploads are
 *    retained for the life of the submission; exports are swept after a week.
 *    A bucket lifecycle rule can only express "delete objects under this
 *    prefix after N days", so the two lifetimes must not share a prefix — see
 *    WIRING-exports.md for the rule the operator has to configure.
 *
 *  • `org_{orgId}` mirrors the upload layout, so an IAM or bucket policy that
 *    already scopes a tenant by an `org_{id}` path segment keeps working.
 *
 * The job id is the whole filename: it is a UUID generated server-side, so
 * nothing user-controlled reaches the key and there is no traversal or
 * collision surface to sanitise.
 */
export function exportObjectKey(
  orgId: string,
  jobId: string,
  format: 'CSV' | 'JSON',
): string {
  return `exports/org_${orgId}/${jobId}.${format.toLowerCase()}`;
}

/**
 * Filename the browser should save the download as.
 *
 * The object key is a UUID, which is unhelpful in a Downloads folder. This is
 * handed to storage as a `response-content-disposition` override at presign
 * time rather than being baked into the object, so renaming the convention
 * later does not require rewriting stored objects.
 */
export function exportFilename(
  label: string | null | undefined,
  createdAt: Date,
  format: 'CSV' | 'JSON',
): string {
  const slug = (label ?? 'export')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  const day = createdAt.toISOString().slice(0, 10);
  return `${slug || 'export'}-${day}.${format.toLowerCase()}`;
}

/** MIME type stored on the object and echoed back on download. */
export function exportContentType(format: 'CSV' | 'JSON'): string {
  return format === 'JSON'
    ? 'application/json; charset=utf-8'
    : 'text/csv; charset=utf-8';
}

/**
 * How long a download link stays valid.
 *
 * Short by design: the link is a bearer credential for a full copy of a
 * tenant's responses, and it is handed to a browser that may well be logged
 * into a shared machine. Five minutes is enough to start the transfer — S3 and
 * MinIO both check the signature at request time, not for the duration of the
 * body — while making a pasted link useless by the time it reaches a chat log.
 */
export function resolveDownloadTtlSeconds(
  raw: string | undefined = process.env.EXPORT_DOWNLOAD_TTL_SECONDS,
): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed)) return 300;
  return Math.min(3600, Math.max(30, parsed));
}

/**
 * Age past which a job still marked RUNNING is presumed dead.
 *
 * A worker that is OOM-killed or hard-terminated mid-upload never gets to run
 * its failure handler, so the row stays RUNNING forever and the dashboard shows
 * a spinner that will never resolve. The sweeper reaps these; the window is
 * generous because a genuinely large export legitimately takes a long time, and
 * failing a live job is worse than showing a stale spinner for a few hours.
 */
export function resolveStaleRunningMs(
  raw: string | undefined = process.env.EXPORT_STALE_HOURS,
): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  const hours = Number.isFinite(parsed) ? Math.min(72, Math.max(1, parsed)) : 6;
  return hours * 60 * 60 * 1000;
}
