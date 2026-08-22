/**
 * API-key decision logic, with no NestJS, Prisma, or Redis in sight.
 *
 * Everything that decides whether a presented key may perform a request lives
 * here as pure functions over plain values. ApiKeyGuard is then only plumbing:
 * read the header, fetch the row, call `evaluateApiKey`, translate the verdict
 * into an exception.
 *
 * WHY THE SPLIT: the previous guard interleaved the checks with the Redis and
 * Prisma calls, which is how three of them ended up unreachable — a cache hit
 * returned `true` before expiry, scope, or organization were ever considered.
 * Logic that can only be exercised by standing up a database and a cache does
 * not get exercised. This file is covered by api-key-policy.spec.ts, which
 * needs neither.
 */

/**
 * The scope vocabulary, verbatim from the ApiKey model's schema comment.
 *
 * `forms:write` is accepted and stored even though no route currently demands
 * it. Silently dropping a scope the schema documents would be worse: an
 * integrator would grant it, see it vanish from the key listing, and reasonably
 * conclude the key was created wrong.
 */
export const API_KEY_SCOPES = [
  'forms:read',
  'forms:write',
  'submissions:read',
  'submissions:export',
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

const KNOWN_SCOPES: ReadonlySet<string> = new Set(API_KEY_SCOPES);

export function isApiKeyScope(value: string): value is ApiKeyScope {
  return KNOWN_SCOPES.has(value);
}

/**
 * Split the stored comma-separated scope string into a normalised list.
 *
 * Trims, lowercases, drops empties and de-duplicates. A stored value of
 * `"forms:read, ,SUBMISSIONS:READ"` — which a hand-written support UPDATE can
 * easily produce — must not turn into a scope named `" "` that matches nothing
 * and silently locks the key out of everything.
 */
export function parseScopes(stored: string | null | undefined): string[] {
  if (!stored) return [];
  const seen = new Set<string>();
  for (const part of stored.split(',')) {
    const scope = part.trim().toLowerCase();
    if (scope) seen.add(scope);
  }
  return [...seen];
}

/** The subset of an ApiKey row an authorization decision actually depends on. */
export interface ApiKeyRecord {
  id: string;
  userId: string;
  organizationId: string;
  /** Raw comma-separated column value; parsed by `evaluateApiKey`. */
  scopes: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

export type ApiKeyDenialReason =
  | 'REVOKED'
  | 'EXPIRED'
  | 'ROUTE_NOT_ORG_SCOPED'
  | 'ORG_MISMATCH'
  | 'MISSING_SCOPE';

export type ApiKeyDecision =
  | { allowed: true; scopes: string[] }
  | {
      allowed: false;
      reason: ApiKeyDenialReason;
      /** 401 = the credential itself is no good. 403 = it is real but not for this. */
      status: 401 | 403;
      message: string;
    };

/**
 * Decide whether `key` may serve this request.
 *
 * CHECK ORDER is deliberate, because the order decides what a caller learns
 * from the response:
 *
 *  1. revoked / expired — properties of the credential, and the caller already
 *     knows it holds this key. Telling it plainly that the key was revoked or
 *     has lapsed is the difference between a working integration and a support
 *     ticket, and reveals nothing it did not already have.
 *  2. organization — checked BEFORE scope so that probing org B with a key for
 *     org A never produces a scope-shaped error message. A scope error is a
 *     weak oracle for "this org exists and this route is real"; the org error
 *     is the same regardless.
 *  3. scopes — every required scope must be present (AND, not OR). A route that
 *     both reads and exports submissions genuinely needs both.
 *
 * `routeOrgId` is the `:orgId` path parameter. Its absence is a DENY, not a
 * skip: a route with no organization in its path cannot have its tenancy
 * checked, so an API key must not be able to reach it. Failing open here is
 * precisely the bug that lets a key for org A read org B.
 */
export function evaluateApiKey(
  key: ApiKeyRecord,
  ctx: {
    routeOrgId: string | undefined | null;
    requiredScopes: readonly string[];
    now: Date;
  },
): ApiKeyDecision {
  if (key.revokedAt !== null && key.revokedAt <= ctx.now) {
    return {
      allowed: false,
      reason: 'REVOKED',
      status: 401,
      message: 'This API key has been revoked.',
    };
  }

  if (key.expiresAt !== null && key.expiresAt <= ctx.now) {
    return {
      allowed: false,
      reason: 'EXPIRED',
      status: 401,
      message: 'This API key has expired.',
    };
  }

  if (!ctx.routeOrgId) {
    return {
      allowed: false,
      reason: 'ROUTE_NOT_ORG_SCOPED',
      status: 403,
      message: 'API keys may only be used on organization-scoped routes.',
    };
  }

  // THE check. Everything else on this list is hygiene; this one is the
  // boundary between tenants. A key is issued against exactly one organization
  // and the URL names exactly one organization — if they disagree, the request
  // is a cross-tenant read attempt whether or not the caller meant it as one.
  if (key.organizationId !== ctx.routeOrgId) {
    return {
      allowed: false,
      reason: 'ORG_MISMATCH',
      status: 403,
      message: 'This API key is not valid for this organization.',
    };
  }

  const granted = parseScopes(key.scopes);
  const missing = ctx.requiredScopes.filter(
    (scope) => !granted.includes(scope),
  );

  if (missing.length > 0) {
    return {
      allowed: false,
      reason: 'MISSING_SCOPE',
      status: 403,
      message: `This API key is missing the required scope: ${missing.join(', ')}.`,
    };
  }

  return { allowed: true, scopes: granted };
}

/**
 * How stale `lastUsedAt` is allowed to get before the guard writes to it.
 *
 * THE TRADEOFF: `lastUsedAt` is a nice-to-have — it tells an admin which keys
 * are dead weight and gives an incident review a last-seen timestamp. It is not
 * worth turning every authenticated GET into an UPDATE on the primary, which is
 * what an unconditional write does: a read-only export integration polling once
 * a second becomes a write-once-a-second workload, on the one connection pool
 * that must never be the bottleneck.
 *
 * So the value is accurate to within this window and no better, and it is
 * deliberately allowed to be lost entirely if the process dies with the
 * fire-and-forget update in flight. "Last used some time in the last minute" is
 * every bit as useful as "last used at 14:03:11.482" for both purposes above.
 */
export const LAST_USED_REFRESH_MS = 60_000;

export function shouldRefreshLastUsedAt(
  lastUsedAt: Date | null,
  now: Date,
  thresholdMs: number = LAST_USED_REFRESH_MS,
): boolean {
  if (lastUsedAt === null) return true;
  return now.getTime() - lastUsedAt.getTime() >= thresholdMs;
}

// ────────────────────────────────────────────────────────────────────────────
// Key material
// ────────────────────────────────────────────────────────────────────────────

/** `fbk_` + base62, per the KEY FORMAT block on the ApiKey model. */
export const API_KEY_PREFIX = 'fbk_';

const BASE62_ALPHABET =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** 32 random bytes is a 256-bit integer; ceil(256 / log2(62)) = 43 characters. */
export const API_KEY_BODY_LENGTH = 43;

/**
 * Shape check applied before the key is hashed and looked up.
 *
 * Cheap, and it keeps junk — a truncated copy-paste, a bearer token pasted into
 * the wrong header, a scanner's payload — from costing a Redis round trip and a
 * database query each. The length is a range rather than exactly
 * API_KEY_BODY_LENGTH so that a key minted by an older or a future generator
 * is rejected by the hash lookup (where it belongs) rather than by a format
 * rule that nobody will think to update.
 */
const API_KEY_FORMAT = /^fbk_[0-9A-Za-z]{20,64}$/;

export function looksLikeApiKey(value: string): boolean {
  return API_KEY_FORMAT.test(value);
}

/**
 * Big-endian base62 of an arbitrary byte string, left-padded to a fixed width.
 *
 * The padding matters: a buffer whose leading byte happens to be zero encodes
 * to a shorter string, so without it roughly 1 key in 256 would be 42
 * characters and any consumer that asserted on the length would fail
 * intermittently, months later, for no discoverable reason.
 */
export function encodeBase62(
  bytes: Uint8Array,
  width: number = API_KEY_BODY_LENGTH,
): string {
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }

  let out = '';
  while (value > 0n) {
    out = BASE62_ALPHABET[Number(value % 62n)] + out;
    value /= 62n;
  }

  return out.padStart(width, BASE62_ALPHABET[0]);
}

/**
 * The display hint shown in the key listing.
 *
 * NOT the last four characters of the key, which is what most products show —
 * that requires storing a slice of the plaintext, and this schema stores only
 * the SHA-256 hash. Rather than change the schema for a cosmetic affordance,
 * this derives the hint from the hash we already hold: the first 8 hex
 * characters of the digest.
 *
 * That is safe to publish. Deriving a key from 32 bits of its SHA-256 means
 * searching for a preimage of the FULL 256-bit digest — the lookup is on the
 * whole hash, so the ~2^32 near-collisions an attacker can generate cheaply
 * authenticate as nothing at all.
 *
 * The cost of choosing a fingerprint over last-4 is that a user holding a raw
 * key cannot match it to a row by eye; they have to compute
 * `sha256(key)[0:8]`. In exchange, two keys are always distinguishable in the
 * list, nothing derived from the plaintext is ever persisted, and the whole
 * thing needs no migration.
 */
export function fingerprintFromHash(keyHash: string): string {
  return keyHash.slice(0, 8);
}

/**
 * Redis key under which a validated ApiKey row is cached.
 *
 * Exported so that ApiKeysService can evict the exact entry the guard reads
 * when a key is revoked. A revocation that leaves the cache populated is not a
 * revocation — it is a revocation that takes effect in up to CACHE_TTL seconds,
 * which is the wrong answer to "this key has leaked, kill it now".
 */
export function apiKeyCacheKey(keyHash: string): string {
  return `apikey:${keyHash}`;
}
