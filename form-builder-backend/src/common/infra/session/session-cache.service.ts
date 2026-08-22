import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { AppLogger } from '../../observability/logger/app-logger.service';
import { intEnv } from '../../../config/env';
import type { MembershipLike } from '../../tenancy/active-organization';

/**
 * SessionCacheService — the authenticated user's identity and memberships,
 * cached in Redis for the length of a heartbeat.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * WHAT IT REPLACES: every authenticated request used to pay for TWO queries
 * against the same two tables. `JwtStrategy.validate()` loaded the user with
 * their memberships joined, and then — on any /organizations/:orgId route —
 * `OrgMemberGuard` immediately went back for the SAME membership row it had
 * just been handed, because the two components had no way to talk to each other.
 * That is two round-trips before a single line of business logic runs, on the
 * hottest path in the application, and both of them return data that changes a
 * handful of times in an account's entire lifetime.
 *
 * ── The value shape is not arbitrary ──────────────────────────────────────────
 * It mirrors, field for field, the projection `jwt.strategy.ts` was already
 * selecting. That is what lets `resolveActiveOrganization` run against a cached
 * session with no adaptation layer and no second shape to keep in sync — the
 * cached object IS the row it replaces. Changing this select means changing
 * SESSION_CACHE_VERSION as well; see below.
 *
 * ── Failing open is a requirement, not a convenience ──────────────────────────
 * Every read path below swallows Redis errors and falls through to Postgres. An
 * unreachable cache must degrade this service to exactly the behaviour it had
 * before the cache existed — slower, and completely correct. The alternative,
 * propagating the error, means a Redis blip logs out every user on the platform
 * simultaneously: an availability optimisation that turns into a total outage
 * the first time it fails is worse than no optimisation.
 *
 * Note the asymmetry: a failed READ costs a database query and nothing else, but
 * a failed INVALIDATION leaves a stale entry alive until it expires. The TTL
 * exists to bound precisely that, and `invalidate()` logs at error level because
 * it is the one operation here whose failure has a security consequence.
 */

/**
 * How long a session may be served without re-reading the database.
 *
 * DEFAULT 60 SECONDS, and the number is a deliberate trade, not a round figure.
 *
 * What the window actually costs: this is NOT the normal propagation delay for a
 * permission change. Every write that alters the cached shape calls
 * `invalidate()` (the call sites are enumerated in WIRING-auth.md), so in the
 * healthy case a role change, a member removal or a suspension takes effect on
 * the very next request. The TTL is the blast radius when that fails — a Redis
 * hiccup during the DEL, or some future write path that nobody remembered to
 * instrument. In those cases a removed member keeps their old access for up to
 * this long. Sixty seconds of that is a bounded, explainable exposure; an hour
 * is not, and no expiry at all would make a single missed `invalidate()` a
 * permanent authorization bug.
 *
 * Set SESSION_CACHE_TTL_SECONDS to 0 to bypass the cache entirely and read
 * through to Postgres on every request — the escape hatch for an incident where
 * the cache is suspected, without a deploy.
 */
const DEFAULT_TTL_SECONDS = 60;

/**
 * Bumped whenever the cached shape changes.
 *
 * WHY: during a rolling deploy, old and new pods share one Redis. Without this,
 * a new pod reads an entry written by an old pod, finds a field it now depends
 * on missing, and makes an authorization decision on a half-populated object —
 * which fails in whichever direction the missing field happens to point. A
 * version mismatch is treated as a miss, so the worst case is a database query.
 */
const SESSION_CACHE_VERSION = 1;

const KEY_PREFIX = 'session:';

/** A membership as the session cache stores it. Satisfies MembershipLike. */
export interface CachedMembership extends MembershipLike {
  organizationId: string;
  role: string;
  joinedAt: Date;
  organization: { isActive: boolean; suspendedAt: Date | null };
}

/** Everything an auth decision needs about a user, in one object. */
export interface CachedSession {
  id: string;
  email: string;
  systemRole: string;
  deletedAt: Date | null;
  lastActiveOrganizationId: string | null;
  memberships: CachedMembership[];
}

/**
 * The same object after a JSON round-trip: every Date has become an ISO string.
 * Spelled out as its own type so the revival step below cannot be quietly
 * dropped — see `revive`.
 */
interface SerializedSession {
  v: number;
  id: string;
  email: string;
  systemRole: string;
  deletedAt: string | null;
  lastActiveOrganizationId: string | null;
  memberships: Array<{
    organizationId: string;
    role: string;
    joinedAt: string;
    organization: { isActive: boolean; suspendedAt: string | null };
  }>;
}

/**
 * The projection. Identical to what jwt.strategy.ts selected before the cache
 * existed, so a cache miss and a cache hit are the same object.
 */
const sessionSelect = {
  id: true,
  email: true,
  systemRole: true,
  deletedAt: true,
  lastActiveOrganizationId: true,
  memberships: {
    select: {
      organizationId: true,
      role: true,
      joinedAt: true,
      organization: {
        select: { isActive: true, suspendedAt: true },
      },
    },
  },
} as const;

@Injectable()
export class SessionCacheService {
  private readonly ttlSeconds = intEnv(
    'SESSION_CACHE_TTL_SECONDS',
    DEFAULT_TTL_SECONDS,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly logger: AppLogger,
  ) {
    this.logger.setContext(SessionCacheService.name);
  }

  /**
   * The user's session, from cache when possible and from Postgres otherwise.
   *
   * Both callers (JwtStrategy and OrgMemberGuard) go through this one method
   * rather than each implementing their own miss handling, so there is exactly
   * one place where the fallback can be got wrong — and so the two can never
   * disagree with each other about a user's memberships within one request.
   *
   * Returns null when no such user exists. Deliberately does NOT cache that
   * answer: a null is either a deleted account or a forged `sub` claim, neither
   * of which is worth a key, and caching negatives would let anyone fill Redis
   * with junk by presenting tokens for user ids that never existed.
   */
  async getSession(userId: string): Promise<CachedSession | null> {
    const cached = await this.read(userId);
    if (cached) return cached;

    const fresh = await this.loadFromDatabase(userId);
    if (fresh) await this.write(fresh);
    return fresh;
  }

  /**
   * Drop a user's cached session. Call this from EVERY write that changes what
   * `sessionSelect` returns — role, membership, suspension, soft-delete,
   * system role, active org.
   *
   * Best-effort by necessity, and that is the honest word for it: if Redis is
   * unreachable at this instant the stale entry survives until its TTL expires.
   * There is no way to do better without making the write path depend on the
   * cache being up, which trades a bounded staleness window for an unbounded
   * outage. Logged at error level so the exposure is at least visible.
   */
  async invalidate(userId: string): Promise<void> {
    try {
      await this.redis.del(this.key(userId));
    } catch (err) {
      this.logger.error(
        `Failed to invalidate cached session for user ${userId}. Stale permissions may be served for up to ${this.ttlSeconds}s.`,
        err,
      );
    }
  }

  /** Invalidate a set of users in one round-trip. Empty input is a no-op. */
  async invalidateMany(userIds: string[]): Promise<void> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return;

    try {
      // One DEL with N keys rather than N calls — org-wide invalidations can
      // touch every member of a large workspace, and a per-key round-trip there
      // would put the org's member count on the latency path of a suspend.
      await this.redis.getClient().del(...unique.map((id) => this.key(id)));
    } catch (err) {
      this.logger.error(
        `Failed to invalidate ${unique.length} cached session(s). Stale permissions may be served for up to ${this.ttlSeconds}s.`,
        err,
      );
    }
  }

  /**
   * Invalidate every member of an organization.
   *
   * For org-level changes — suspend, reactivate, soft-delete — because the
   * cached session embeds `organization.isActive` and `organization.suspendedAt`
   * for each membership. Suspending a workspace without this leaves every member
   * of it holding a session that still says the org is healthy, which is the
   * exact regression the invalidation list exists to prevent.
   *
   * Reads the roster from the WRITER: it is called immediately after the update
   * that made the change, and a replica lagging by a few milliseconds would
   * return a roster missing whoever joined last — leaving precisely one member
   * with a stale session.
   */
  async invalidateOrganizationMembers(organizationId: string): Promise<void> {
    const members = await this.prisma.writer.organizationMember.findMany({
      where: { organizationId },
      select: { userId: true },
    });

    await this.invalidateMany(members.map((m: { userId: string }) => m.userId));
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private key(userId: string): string {
    return `${KEY_PREFIX}${userId}`;
  }

  /** Cache read. Any failure — down, timeout, garbage payload — returns null. */
  private async read(userId: string): Promise<CachedSession | null> {
    if (this.ttlSeconds <= 0) return null;

    let raw: string | null;
    try {
      raw = await this.redis.get(this.key(userId));
    } catch (err) {
      // FAIL OPEN. The caller falls through to Postgres and the request
      // succeeds; the only casualty is the round-trip we were trying to save.
      this.logger.warn(
        'Session cache read failed; falling back to the database.',
        {
          userId,
          error: err instanceof Error ? err.message : String(err),
        },
      );
      return null;
    }

    if (!raw) return null;

    return this.revive(raw, userId);
  }

  private async write(session: CachedSession): Promise<void> {
    if (this.ttlSeconds <= 0) return;

    try {
      const payload: SerializedSession = {
        v: SESSION_CACHE_VERSION,
        id: session.id,
        email: session.email,
        systemRole: session.systemRole,
        deletedAt: session.deletedAt ? session.deletedAt.toISOString() : null,
        lastActiveOrganizationId: session.lastActiveOrganizationId,
        memberships: session.memberships.map((m) => ({
          organizationId: m.organizationId,
          role: m.role,
          joinedAt: m.joinedAt.toISOString(),
          organization: {
            isActive: m.organization.isActive,
            suspendedAt: m.organization.suspendedAt
              ? m.organization.suspendedAt.toISOString()
              : null,
          },
        })),
      };

      await this.redis.set(
        this.key(session.id),
        JSON.stringify(payload),
        this.ttlSeconds,
      );
    } catch (err) {
      // A cache we could not populate is a cache we will miss on next time.
      // Nothing else breaks, so this is a warning, not an error.
      this.logger.warn('Session cache write failed.', {
        userId: session.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * JSON → CachedSession.
   *
   * The Date revival here is load-bearing, not tidiness. `JSON.parse` returns
   * `joinedAt` as a string, and `resolveActiveOrganization` sorts memberships by
   * `joinedAt?.getTime()` — on a string that throws a TypeError, which would
   * surface as a 500 on every authenticated request the moment the cache warmed
   * up, and only then. `isUsable` reads `suspendedAt` for truthiness, where a
   * string is subtler and worse: the empty-string case aside, it would work, and
   * the failure would be invisible until some caller compared it to a Date.
   */
  private revive(raw: string, userId: string): CachedSession | null {
    try {
      const parsed = JSON.parse(raw) as SerializedSession;

      // Written by a different build of this file. Treat as a miss.
      if (
        parsed?.v !== SESSION_CACHE_VERSION ||
        !Array.isArray(parsed.memberships)
      ) {
        return null;
      }

      return {
        id: parsed.id,
        email: parsed.email,
        systemRole: parsed.systemRole,
        deletedAt: parsed.deletedAt ? new Date(parsed.deletedAt) : null,
        lastActiveOrganizationId: parsed.lastActiveOrganizationId,
        memberships: parsed.memberships.map((m) => ({
          organizationId: m.organizationId,
          role: m.role,
          joinedAt: new Date(m.joinedAt),
          organization: {
            isActive: m.organization.isActive,
            suspendedAt: m.organization.suspendedAt
              ? new Date(m.organization.suspendedAt)
              : null,
          },
        })),
      };
    } catch (err) {
      this.logger.warn(
        'Discarding unparseable cached session; falling back to the database.',
        {
          userId,
          error: err instanceof Error ? err.message : String(err),
        },
      );
      return null;
    }
  }

  /**
   * The authoritative read. Uses the READER — this is the same query
   * JwtStrategy ran against the replica before the cache existed, and a session
   * that is a replication-lag behind is no more stale than one served from a
   * cache entry written a moment ago.
   */
  private async loadFromDatabase(
    userId: string,
  ): Promise<CachedSession | null> {
    const user = await this.prisma.reader.user.findUnique({
      where: { id: userId },
      select: sessionSelect,
    });

    return user ?? null;
  }
}
