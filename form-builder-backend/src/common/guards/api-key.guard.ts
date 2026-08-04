import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { AppLogger } from '../logger/app-logger.service';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly CACHE_TTL_SECONDS = 300; // 5 minutes

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly logger: AppLogger,
  ) {
    this.logger.setContext(ApiKeyGuard.name);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const rawKey: string = request.headers['x-api-key'];

    if (!rawKey?.startsWith('fbk_')) {
      throw new UnauthorizedException('Missing or malformed API key.');
    }

    const keyHash = createHash('sha256').update(rawKey).digest('hex');
    const cacheKey = `apikey:${keyHash}`;

    // 1. Try to fetch from Redis cache (sub-millisecond latency)
    try {
      const cachedData = await this.redis.get(cacheKey);
      if (cachedData) {
        const parsed = JSON.parse(cachedData);
        request.apiKeyCtx = {
          userId: parsed.userId,
          organizationId: parsed.organizationId,
          scopes: parsed.scopes,
        };
        return true;
      }
    } catch (err) {
      this.logger.warn('Redis cache read failed during API key validation', { error: err });
    }

    // 2. Fallback to Database
    const apiKey = await this.prisma.reader.apiKey.findUnique({
      where: { keyHash },
      select: {
        userId: true,
        organizationId: true,
        scopes: true,
        expiresAt: true,
      },
    });

    if (!apiKey) {
      throw new UnauthorizedException('Invalid API key.');
    }

    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      throw new UnauthorizedException('API key has expired.');
    }

    const scopesArray = apiKey.scopes.split(',');

    // 3. Cache the validated key in Redis
    try {
      await this.redis.set(
        cacheKey,
        JSON.stringify({
          userId: apiKey.userId,
          organizationId: apiKey.organizationId,
          scopes: scopesArray,
        }),
        this.CACHE_TTL_SECONDS,
      );
    } catch (err) {
      this.logger.warn('Redis cache write failed during API key validation', { error: err });
    }

    // 4. Fire-and-forget background update of 'lastUsedAt' in the DB
    this.prisma.writer.apiKey.update({
      where: { keyHash },
      data: { lastUsedAt: new Date() },
    }).catch((err: any) => this.logger.error('Failed to update API key lastUsedAt', err));

    // Attach to request for downstream handlers and rate limiting
    request.apiKeyCtx = {
      userId: apiKey.userId,
      organizationId: apiKey.organizationId,
      scopes: scopesArray,
    };
    return true;
  }
}
