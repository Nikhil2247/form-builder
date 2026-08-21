import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { AuditService } from '../audit/audit.service';

/**
 * Feature flags.
 *
 * Resolution is: organization override, else the flag's global default. A
 * super-admin can therefore dark-launch (global OFF), enable one pilot org, and
 * later flip the global default without unpicking per-org rows.
 *
 * FLAGS ARE UI GATING, NOT AUTHORIZATION. A disabled flag hides navigation and
 * screens; it does not protect data. Every endpoint keeps its own guards, so a
 * user who flips a flag in devtools gains nothing but a broken-looking menu.
 */

/** Flags the application knows about. Adding one here needs a seed migration. */
export const FEATURE_KEYS = {
  FORM_APPS: 'FORM_APPS',
  FORM_RULES: 'FORM_RULES',
  AI_ASSISTANT: 'AI_ASSISTANT',
} as const;

export type FeatureKey = (typeof FEATURE_KEYS)[keyof typeof FEATURE_KEYS];

/** Short — flags are read on nearly every page load and change rarely. */
const CACHE_TTL_SECONDS = 60;

@Injectable()
export class FeatureFlagsService {
  private readonly logger = new Logger(FeatureFlagsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Resolved flags for one organization, as `{ KEY: boolean }`.
   *
   * Fails OPEN-AS-DISABLED: if the lookup throws, every flag reads false. A
   * database blip should degrade the product to its previous, known-good
   * feature set rather than surfacing half-configured screens.
   */
  async getForOrganization(
    orgId: string | null | undefined,
  ): Promise<Record<string, boolean>> {
    const cacheKey = `features:${orgId ?? 'none'}`;

    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch {
      // Cache read failures are never fatal — fall through to the database.
    }

    try {
      const [flags, overrides] = await Promise.all([
        this.prisma.reader.featureFlag.findMany(),
        orgId
          ? this.prisma.reader.organizationFeatureFlag.findMany({
              where: { organizationId: orgId },
            })
          : Promise.resolve([]),
      ]);

      const overrideByKey = new Map(
        overrides.map((o) => [o.flagKey, o.isEnabled]),
      );

      const resolved: Record<string, boolean> = {};
      for (const flag of flags) {
        resolved[flag.key] =
          overrideByKey.get(flag.key) ?? flag.isEnabledGlobally;
      }

      try {
        await this.redis.set(
          cacheKey,
          JSON.stringify(resolved),
          CACHE_TTL_SECONDS,
        );
      } catch {
        // Non-fatal.
      }

      return resolved;
    } catch (err) {
      this.logger.error(
        'Failed to resolve feature flags; defaulting all to off.',
        err,
      );
      return {};
    }
  }

  async isEnabled(
    orgId: string | null | undefined,
    key: FeatureKey,
  ): Promise<boolean> {
    const flags = await this.getForOrganization(orgId);
    return flags[key] === true;
  }

  // ── Super-admin surface ───────────────────────────────────────────────────

  async listFlags() {
    const flags = await this.prisma.reader.featureFlag.findMany({
      orderBy: { name: 'asc' },
      include: {
        overrides: {
          include: {
            organization: { select: { id: true, name: true, slug: true } },
          },
        },
      },
    });

    return flags.map((flag) => ({
      key: flag.key,
      name: flag.name,
      description: flag.description,
      isEnabledGlobally: flag.isEnabledGlobally,
      overrides: flag.overrides.map((o) => ({
        organizationId: o.organizationId,
        organizationName: o.organization.name,
        isEnabled: o.isEnabled,
      })),
    }));
  }

  async setGlobal(key: string, isEnabledGlobally: boolean, userId?: string) {
    const flag = await this.prisma.reader.featureFlag.findUnique({
      where: { key },
    });
    if (!flag) throw new NotFoundException('Unknown feature.');

    const updated = await this.prisma.writer.featureFlag.update({
      where: { key },
      data: { isEnabledGlobally },
    });

    // A global default affects every organization, so there is no single key to
    // drop. Rather than scanning Redis for `features:*` — which is O(keyspace)
    // and blocks the server — the change simply propagates as the short TTL
    // expires. Worst case a super-admin waits CACHE_TTL_SECONDS to see it.
    // Per-org overrides below invalidate immediately, because those have one key.

    this.audit.log({
      organizationId: null,
      userId,
      action: isEnabledGlobally
        ? 'FEATURE_ENABLED_GLOBALLY'
        : 'FEATURE_DISABLED_GLOBALLY',
      resource: 'FeatureFlag',
      resourceId: key,
      metadata: { name: flag.name },
    });

    return updated;
  }

  async setForOrganization(
    key: string,
    orgId: string,
    isEnabled: boolean | null,
    userId?: string,
  ) {
    const flag = await this.prisma.reader.featureFlag.findUnique({
      where: { key },
    });
    if (!flag) throw new NotFoundException('Unknown feature.');

    const org = await this.prisma.reader.organization.findUnique({
      where: { id: orgId },
      select: { id: true },
    });
    if (!org) throw new NotFoundException('Organization not found.');

    if (isEnabled === null) {
      // null clears the override, returning the org to the global default —
      // which is different from an explicit `false`.
      await this.prisma.writer.organizationFeatureFlag.deleteMany({
        where: { organizationId: orgId, flagKey: key },
      });
    } else {
      await this.prisma.writer.organizationFeatureFlag.upsert({
        where: {
          organizationId_flagKey: { organizationId: orgId, flagKey: key },
        },
        create: { organizationId: orgId, flagKey: key, isEnabled },
        update: { isEnabled },
      });
    }

    await this.invalidate(orgId);

    this.audit.log({
      organizationId: orgId,
      userId,
      action: 'FEATURE_OVERRIDE_SET',
      resource: 'FeatureFlag',
      resourceId: key,
      metadata: { isEnabled },
    });

    return { key, organizationId: orgId, isEnabled };
  }

  private async invalidate(orgId: string) {
    try {
      await this.redis.del(`features:${orgId}`);
    } catch {
      // A stale cache self-heals within CACHE_TTL_SECONDS.
    }
  }
}
