import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash, timingSafeEqual } from 'crypto';
import { PrismaService } from '../infra/prisma/prisma.service';
import { RedisService } from '../infra/redis/redis.service';
import { AppLogger } from '../observability/logger/app-logger.service';
import { SCOPES_KEY } from './scopes.decorator';
import {
  apiKeyCacheKey,
  evaluateApiKey,
  looksLikeApiKey,
  shouldRefreshLastUsedAt,
  LAST_USED_REFRESH_MS,
  type ApiKeyDecision,
} from './api-key-policy';

/**
 * Machine-to-machine authentication for `X-API-Key: fbk_…`.
 *
 * WHAT THIS GUARD USED TO DO, and why every line of it is now different:
 *
 *  • A Redis hit returned `true` immediately, before expiry, scope, or
 *    organization were considered. The cache was not a cache of a *validated*
 *    key, it was a bypass of validation — and it was the hot path, so in
 *    practice it was the only path.
 *  • Nothing anywhere checked that the key's organizationId matched the
 *    `:orgId` in the URL. Any valid key could read any organization's forms and
 *    submissions. This was the whole tenancy boundary, missing.
 *  • Nothing read `scopes` beyond splitting the string onto the request. A
 *    key issued `forms:read` could export every submission in the org.
 *  • `revokedAt` was not selected, let alone checked. Revoking a leaked key
 *    did nothing.
 *  • `lastUsedAt` was written on EVERY request that missed the cache, turning
 *    a read endpoint into a write against the primary.
 *  • The lookup ran against `prisma.reader`, so on a deployment with a real
 *    replica a revocation took effect whenever replication caught up.
 *  • `request.headers['x-api-key']` was typed as `string` and called
 *    `.startsWith` on it; a duplicated header arrives as an array in some
 *    configurations and produced a 500 instead of a 401.
 *
 * The guard is now plumbing only. Every decision is made by pure functions in
 * api-key-policy.ts, which are unit-tested without a database.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  /**
   * How long a validated key row is cached.
   *
   * Shorter than the 5 minutes this used to be. Revocation evicts this entry
   * explicitly (see ApiKeysService.revokeApiKey), so the TTL only bounds the
   * cases where eviction cannot happen: Redis was unreachable at revoke time,
   * or somebody set `revoked_at` with a support script. One minute is a window
   * an incident responder can live with; five was not.
   */
  private readonly CACHE_TTL_SECONDS = 60;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly logger: AppLogger,
    private readonly reflector: Reflector,
  ) {
    this.logger.setContext(ApiKeyGuard.name);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // Handler only, never the class — see the @RequiredScope docblock. A route
    // that has not opted in does not accept keys at all, no matter what the
    // controller it lives on is decorated with.
    const requiredScopes = this.reflector.get<string[] | undefined>(
      SCOPES_KEY,
      context.getHandler(),
    );

    if (!requiredScopes?.length) {
      throw new UnauthorizedException(
        'This endpoint does not accept API key authentication.',
      );
    }

    const presented = readApiKeyHeader(request.headers);
    if (!presented) {
      throw new UnauthorizedException('Missing or malformed API key.');
    }

    const keyHash = sha256Hex(presented);
    const now = new Date();

    let record = await this.readFromCache(keyHash);

    if (!record) {
      record = await this.loadFromPrimary(keyHash);

      if (!record) {
        // Deliberately does not log the presented key, not even truncated —
        // this log line is written on every scanner probe and a partial secret
        // in a log aggregator is a secret in a log aggregator.
        this.logger.warn('API key authentication failed: no such key', {
          path: request.url,
          keyHashPrefix: keyHash.slice(0, 8),
        });
        throw new UnauthorizedException('Invalid API key.');
      }

      await this.writeToCache(keyHash, record);
    }

    // Constant-time confirmation that the row we are about to trust really is
    // the row for the key that was presented.
    //
    // Honest about what this buys: the database lookup is a unique index probe
    // on the full hash, so the comparison it replaces was never timing-
    // sensitive. The real subject is the cache path — this asserts the cached
    // blob's own recorded hash against the hash we computed, so a truncated
    // cache key, a Redis key collision, or a blob written by some future code
    // path with a different key scheme cannot authenticate. Constant-time
    // because comparing secret-derived material with `===` is a habit worth not
    // having, not because a 40ms network hop leaves any timing signal to read.
    if (!timingSafeHexEqual(keyHash, record.keyHash)) {
      this.logger.error(
        'API key cache/hash mismatch — refusing to authenticate',
        undefined,
        {
          keyHashPrefix: keyHash.slice(0, 8),
        },
      );
      throw new UnauthorizedException('Invalid API key.');
    }

    const decision = evaluateApiKey(
      {
        id: record.id,
        userId: record.userId,
        organizationId: record.organizationId,
        scopes: record.scopes,
        expiresAt: record.expiresAt,
        revokedAt: record.revokedAt,
      },
      {
        routeOrgId: request.params?.orgId,
        requiredScopes,
        now,
      },
    );

    if (!decision.allowed) {
      this.deny(decision, request, record.id);
    }

    this.touchLastUsedAt(keyHash, record, now);

    // The key's OWNER is what downstream guards see. OrgMemberGuard then runs
    // and re-checks that this user is still a member of :orgId — so removing
    // someone from an organization also kills the keys they minted for it,
    // which is what an offboarding checklist assumes happens.
    //
    // `systemRole` is pinned to 'USER' rather than read from the owner's row.
    // RoleGuard grants SUPER_ADMIN an unconditional pass on every role check; a
    // platform admin's API key must not inherit that. A key is a scoped,
    // long-lived, copy-pasteable credential and is never the right thing to
    // hang platform-wide authority on.
    request.user = {
      sub: record.userId,
      systemRole: 'USER',
      authMethod: 'api-key',
      apiKeyId: record.id,
    };

    request.apiKey = {
      id: record.id,
      userId: record.userId,
      organizationId: record.organizationId,
      scopes: decision.scopes,
    };

    return true;
  }

  /** Translate a policy verdict into the HTTP exception it describes. */
  private deny(
    decision: Extract<ApiKeyDecision, { allowed: false }>,
    request: any,
    apiKeyId: string,
  ): never {
    this.logger.warn(`API key denied: ${decision.reason}`, {
      apiKeyId,
      reason: decision.reason,
      path: request.url,
      routeOrgId: request.params?.orgId,
    });

    throw decision.status === 401
      ? new UnauthorizedException(decision.message)
      : new ForbiddenException(decision.message);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Storage
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Read the key from the PRIMARY, not the reader replica.
   *
   * The old code used `prisma.reader`. On any deployment that actually has a
   * replica, that makes revocation eventually-consistent with replication lag —
   * the one operation where "it will take effect shortly" is the wrong
   * behaviour — and makes a freshly-minted key 401 for its first few seconds,
   * which reads to an integrator as "the key I was just given does not work".
   *
   * The primary can afford it precisely because of the cache above: this runs
   * once per key per CACHE_TTL_SECONDS, not once per request.
   */
  private async loadFromPrimary(keyHash: string): Promise<CachedApiKey | null> {
    const row = await this.prisma.writer.apiKey.findUnique({
      where: { keyHash },
      select: {
        id: true,
        userId: true,
        organizationId: true,
        scopes: true,
        keyHash: true,
        expiresAt: true,
        revokedAt: true,
        lastUsedAt: true,
      },
    });

    return row ?? null;
  }

  private async readFromCache(keyHash: string): Promise<CachedApiKey | null> {
    try {
      const raw = await this.redis.get(apiKeyCacheKey(keyHash));
      if (!raw) return null;

      const parsed = JSON.parse(raw) as SerializedApiKey;

      // JSON has no Date. Rehydrating here — rather than letting the nullable
      // ISO strings flow into evaluateApiKey — is what keeps the policy
      // functions working on one representation instead of two.
      return {
        id: parsed.id,
        userId: parsed.userId,
        organizationId: parsed.organizationId,
        scopes: parsed.scopes,
        keyHash: parsed.keyHash,
        expiresAt: parsed.expiresAt ? new Date(parsed.expiresAt) : null,
        revokedAt: parsed.revokedAt ? new Date(parsed.revokedAt) : null,
        lastUsedAt: parsed.lastUsedAt ? new Date(parsed.lastUsedAt) : null,
      };
    } catch (err) {
      // A cache that is down or serving garbage must degrade to a database
      // lookup, never to a denial and never to an acceptance.
      this.logger.warn('Redis cache read failed during API key validation', {
        error: err,
      });
      return null;
    }
  }

  private async writeToCache(
    keyHash: string,
    record: CachedApiKey,
  ): Promise<void> {
    try {
      const payload: SerializedApiKey = {
        id: record.id,
        userId: record.userId,
        organizationId: record.organizationId,
        scopes: record.scopes,
        keyHash: record.keyHash,
        expiresAt: record.expiresAt?.toISOString() ?? null,
        revokedAt: record.revokedAt?.toISOString() ?? null,
        lastUsedAt: record.lastUsedAt?.toISOString() ?? null,
      };

      await this.redis.set(
        apiKeyCacheKey(keyHash),
        JSON.stringify(payload),
        this.CACHE_TTL_SECONDS,
      );
    } catch (err) {
      this.logger.warn('Redis cache write failed during API key validation', {
        error: err,
      });
    }
  }

  /**
   * Throttled, non-blocking `lastUsedAt` refresh. See LAST_USED_REFRESH_MS for
   * the reasoning about what accuracy is being traded away and why.
   *
   * Not awaited, on purpose: this is a read request and it must not wait on a
   * write to the primary to produce its response. The `where` clause repeats
   * the staleness test so that a burst of concurrent requests arriving on the
   * same stale key does not turn into a burst of row-level lock contention —
   * all but the first become no-op updates.
   */
  private touchLastUsedAt(
    keyHash: string,
    record: CachedApiKey,
    now: Date,
  ): void {
    if (!shouldRefreshLastUsedAt(record.lastUsedAt, now)) return;

    const staleBefore = new Date(now.getTime() - LAST_USED_REFRESH_MS);

    // Keep the cached blob in step, or every request for the rest of the TTL
    // re-reads the old timestamp and re-fires this update.
    record.lastUsedAt = now;
    void this.writeToCache(keyHash, record);

    void this.prisma.writer.apiKey
      .updateMany({
        where: {
          keyHash,
          OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: staleBefore } }],
        },
        data: { lastUsedAt: now },
      })
      .catch((err: unknown) =>
        this.logger.error('Failed to update API key lastUsedAt', err as Error),
      );
  }
}

/** An ApiKey row as the guard holds it, in memory or in Redis. */
interface CachedApiKey {
  id: string;
  userId: string;
  organizationId: string;
  scopes: string;
  keyHash: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
}

/** The same thing after JSON.stringify, where Dates are ISO strings. */
interface SerializedApiKey {
  id: string;
  userId: string;
  organizationId: string;
  scopes: string;
  keyHash: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

/**
 * Pull a well-formed API key out of the request headers, or null.
 *
 * Tolerates the array form: Express hands back `string[]` for a header sent
 * more than once, and the old code called `.startsWith` on it unguarded. Two
 * different keys on one request is a client bug either way, so neither is
 * accepted — picking the first would make which key authenticates depend on
 * header ordering through the proxy chain.
 *
 * Exported because ApiKeyOrJwtGuard needs the same "is this caller presenting a
 * key at all?" answer, and two copies of this predicate would eventually
 * disagree about it.
 */
export function readApiKeyHeader(
  headers: Record<string, unknown>,
): string | null {
  const raw = headers?.['x-api-key'];

  if (typeof raw !== 'string') return null;

  const value = raw.trim();
  return looksLikeApiKey(value) ? value : null;
}

/**
 * Whether the caller is ATTEMPTING key authentication, regardless of whether
 * the value is well-formed.
 *
 * Distinct from `readApiKeyHeader` on purpose. ApiKeyOrJwtGuard routes on this,
 * so a caller who sends a mangled or truncated key is told their API key is bad
 * rather than being silently handed to the bearer-token path and told they are
 * not signed in — which sends an integrator hunting for a login problem they do
 * not have.
 */
export function hasApiKeyHeader(headers: Record<string, unknown>): boolean {
  const raw = headers?.['x-api-key'];
  if (typeof raw === 'string') return raw.trim().length > 0;
  // Array form: the header arrived more than once. Still an attempt.
  return Array.isArray(raw) && raw.length > 0;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Constant-time comparison of two hex digests of the same expected length. */
function timingSafeHexEqual(a: string, b: string): boolean {
  // timingSafeEqual throws on a length mismatch, which is itself a (harmless
  // here — both operands are digests of fixed width) early exit.
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}
