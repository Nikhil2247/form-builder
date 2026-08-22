import { Injectable, ForbiddenException } from '@nestjs/common';
import { RedisService } from '../../common/infra/redis/redis.service';
import { PrismaService } from '../../common/infra/prisma/prisma.service';

function monthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

/**
 * There is no platform-level equivalent of Organization.maxAiQueriesMonth —
 * a platform session has no Organization row to hold a configurable limit.
 * An env-configurable flat ceiling is the pragmatic choice for a
 * superadmin-only surface rather than inventing a new settings table for one
 * number; see AI_ASSISTANT_PLAN.md §10 Phase 4.
 */
const PLATFORM_MAX_AI_QUERIES_MONTH = parseInt(
  process.env.PLATFORM_AI_MAX_QUERIES_MONTH ?? '2000',
  10,
);

/**
 * Monthly per-org AI assistant quota.
 *
 * Same design as the submissions quota (submissions.service.ts —
 * assertWithinMonthlyQuota): a Redis counter is authoritative for admission
 * control, checked and incremented on every request. Organization.aiQueriesThisMonth
 * is a best-effort visibility counter only — never the enforcement path — so a
 * failed write to it never blocks a request.
 */
@Injectable()
export class QuotaService {
  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  async assertWithinMonthlyQuota(orgId: string): Promise<void> {
    const org = await this.prisma.reader.organization.findUnique({
      where: { id: orgId },
      select: { maxAiQueriesMonth: true },
    });
    if (!org) return;

    const key = `quota:ai:${orgId}:${monthKey()}`;
    const used = await this.redis.incr(key);
    if (used === 1) {
      // ~40 days: comfortably past month end, so the key self-expires.
      await this.redis.expire(key, 60 * 60 * 24 * 40);
    }
    if (used > org.maxAiQueriesMonth) {
      await this.redis.decr(key); // don't let a rejected attempt inflate usage
      throw new ForbiddenException(
        'This organization has reached its monthly AI assistant quota.',
      );
    }

    this.prisma.writer.organization
      .update({
        where: { id: orgId },
        data: { aiQueriesThisMonth: { increment: 1 } },
      })
      .catch(() => {
        // Visibility only — never let this fail the request.
      });
  }

  /**
   * Monthly quota for the platform insights bot (mode 4). No Organization row
   * to check against — the Redis counter is the whole mechanism, gated only
   * by PLATFORM_MAX_AI_QUERIES_MONTH. Access to this surface is already
   * restricted to SUPER_ADMIN users, so this bounds cost exposure rather than
   * enforcing per-tenant fairness.
   */
  async assertWithinPlatformMonthlyQuota(): Promise<void> {
    const key = `quota:ai:platform:${monthKey()}`;
    const used = await this.redis.incr(key);
    if (used === 1) {
      await this.redis.expire(key, 60 * 60 * 24 * 40);
    }
    if (used > PLATFORM_MAX_AI_QUERIES_MONTH) {
      await this.redis.decr(key);
      throw new ForbiddenException(
        'The platform insights assistant has reached its monthly query quota.',
      );
    }
  }
}
