/**
 * Queue identity for asynchronous exports.
 *
 * TEMPORARY HOME. This belongs in `QUEUE_NAMES` in src/config/bullmq.config.ts
 * beside SUBMISSIONS, FILE_VERIFY and WEBHOOKS — it is declared here only
 * because that file is owned by another change in flight. WIRING-exports.md
 * carries the exact edit; once it lands, this file's `EXPORTS_QUEUE` becomes a
 * re-export of `QUEUE_NAMES.EXPORTS` and then disappears.
 *
 * The string value is what matters and must not change once deployed: BullMQ
 * keys every list, set and scheduler in Redis by the queue name, so renaming it
 * orphans whatever is already enqueued rather than migrating it.
 */
export const EXPORTS_QUEUE = 'exports_queue';

/** One job per export request. */
export const EXPORT_RUN_JOB = 'run-export';

/**
 * The retention sweep. A repeatable job on the same queue rather than a
 * separate cron process — see ExportSweeper for why that choice was made.
 */
export const EXPORT_SWEEP_JOB = 'sweep-expired-exports';

/** Stable id for the repeatable sweep schedule, so upserting it is idempotent. */
export const EXPORT_SWEEP_SCHEDULER_ID = 'export-retention-sweep';
