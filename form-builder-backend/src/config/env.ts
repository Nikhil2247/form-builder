/**
 * Environment loading and access.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHY THIS FILE EXISTS — the bug it fixes:
 *
 * Nest's ConfigModule loads .env during module *initialisation*. But an
 * `export const x = process.env.FOO ?? 'default'` at the top level of a config
 * file is evaluated during module *import*, which happens strictly earlier —
 * while the import graph is being resolved, long before Nest bootstraps.
 *
 * So `bullmq.config.ts` read REDIS_URL before .env had been read, got
 * `undefined`, fell back to localhost, and every queue quietly tried to reach
 * 127.0.0.1:6379 — while .env plainly named a different host. The failure
 * surfaced as ECONNREFUSED against an address that appears nowhere in config,
 * which is about as confusing as a misconfiguration can get.
 *
 * `import 'dotenv/config'` below runs on FIRST IMPORT of this module. Any file
 * that reads the environment at module scope must import from here, which makes
 * the ordering a compile-time dependency rather than something to remember.
 *
 * dotenv never overwrites variables that are already set, so real environment
 * variables (Docker, Kubernetes, CI) always win over the .env file.
 */
import 'dotenv/config';

/**
 * Required value. Throws at startup rather than letting the app boot and fail
 * later against a silent fallback — which is exactly how the Redis bug hid.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Set it in .env (see .env.example) or in the process environment.`,
    );
  }
  return value.trim();
}

/** Optional value with an explicit fallback. */
export function optionalEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== '' ? value.trim() : fallback;
}

export function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function boolEnv(name: string, fallback = false): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw.toLowerCase() === 'true' || raw === '1';
}

// ── Connection strings ──────────────────────────────────────────────────────

/**
 * Redis, used by three independent consumers: the cache, the rate limiter, and
 * BullMQ. They previously each read the variable themselves with their own
 * localhost fallback, so a misconfiguration could half-work — cache pointing
 * one way, queues another.
 *
 * Required in production. In development it falls back to localhost, but says
 * so out loud, because a silent fallback is what caused the original problem.
 */
export function getRedisUrl(): string {
  const url = process.env.REDIS_URL?.trim();
  if (url) return url;

  if (process.env.NODE_ENV === 'production') {
    throw new Error('REDIS_URL is required in production.');
  }

  // eslint-disable-next-line no-console
  console.warn(
    '[env] REDIS_URL is not set — falling back to redis://localhost:6379. ' +
      'If Redis is not running there, queues, caching and rate limiting will fail ' +
      'with ECONNREFUSED.',
  );
  return 'redis://localhost:6379';
}

export function getDatabaseUrl(): string {
  return requireEnv('DATABASE_URL');
}

/** Read replica, when one is configured. Falls back to the primary. */
export function getDatabaseReplicaUrl(): string {
  return optionalEnv('DATABASE_REPLICA_URL', getDatabaseUrl());
}
