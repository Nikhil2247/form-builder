/**
 * Runtime role of this process.
 *
 * api      — serves HTTP only. Does NOT consume queue jobs.
 * worker   — consumes queue jobs only. Controllers are still mounted but the
 *            process is normally started via `src/worker.ts` with no HTTP server.
 * combined — both. The default for local development and small deployments.
 *
 * Set PROCESS_ROLE=api on your API deployment and PROCESS_ROLE=worker on your
 * worker deployment so the two can be scaled independently.
 */
export type ProcessRole = 'api' | 'worker' | 'combined';

export function getProcessRole(): ProcessRole {
  const raw = (process.env.PROCESS_ROLE ?? 'combined').toLowerCase();
  if (raw === 'api' || raw === 'worker' || raw === 'combined') return raw;
  return 'combined';
}

/** True when this process should register BullMQ processors. */
export function isWorkerMode(): boolean {
  const role = getProcessRole();
  return role === 'worker' || role === 'combined';
}

/** True when this process should listen for HTTP traffic. */
export function isApiMode(): boolean {
  const role = getProcessRole();
  return role === 'api' || role === 'combined';
}
