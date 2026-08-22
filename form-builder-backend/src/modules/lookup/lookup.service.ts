import { Injectable, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { PrismaService } from '../../common/infra/prisma/prisma.service';
import { Logger } from 'winston';

@Injectable()
export class LookupService {
  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private prisma: PrismaService,
    @Inject('winston') private logger: Logger,
  ) {}

  /**
   * Retrieves organization settings from cache, or DB if not cached.
   * TTL: 1 hour (3600000 ms)
   */
  async getOrganizationSettings(orgId: string) {
    const cacheKey = `org_settings:${orgId}`;
    const cached = await this.cacheManager.get(cacheKey);

    if (cached) {
      this.logger.debug(`[LookupService] CACHE HIT: ${cacheKey}`);
      return cached;
    }

    this.logger.debug(
      `[LookupService] CACHE MISS: ${cacheKey}, fetching from DB...`,
    );
    const org = await this.prisma.reader.organization.findUnique({
      where: { id: orgId },
      select: { settings: true, isActive: true },
    });

    if (org) {
      // cache-manager-ioredis-yet uses milliseconds for TTL natively in v5+
      await this.cacheManager.set(cacheKey, org, 3600000);
    }
    return org;
  }

  /**
   * Retrieves a specific form version snapshot from cache or DB.
   * TTL: 24 hours (86400000 ms) because form versions are immutable!
   */
  async getFormVersion(formVersionId: string) {
    const cacheKey = `form_version:${formVersionId}`;
    const cached = await this.cacheManager.get(cacheKey);

    if (cached) {
      this.logger.debug(`[LookupService] CACHE HIT: ${cacheKey}`);
      return cached;
    }

    this.logger.debug(
      `[LookupService] CACHE MISS: ${cacheKey}, fetching from DB...`,
    );
    const version = await this.prisma.reader.formVersion.findUnique({
      where: { id: formVersionId },
    });

    if (version) {
      // Immutable data can be cached for a very long time
      await this.cacheManager.set(cacheKey, version, 86400000);
    }
    return version;
  }

  /**
   * Invalidate a specific cache key (useful when settings change)
   */
  async invalidate(key: string) {
    await this.cacheManager.del(key);
    this.logger.info(`[LookupService] Cache invalidated for key: ${key}`);
  }
}
