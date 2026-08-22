import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../common/infra/prisma/prisma.service';
import { RedisService } from '../../common/infra/redis/redis.service';
import { AppLogger } from '../../common/observability/logger/app-logger.service';
import { AuditService } from '../audit/audit.service';
import {
  API_KEY_PREFIX,
  apiKeyCacheKey,
  encodeBase62,
  fingerprintFromHash,
  parseScopes,
} from '../../common/auth/api-key-policy';
import { CreateApiKeyDto } from './dto/create-api-key.dto';

/**
 * Everything an API-key read returns.
 *
 * `keyHash` is selected but NEVER returned — `toPublicApiKey` consumes it to
 * derive the display fingerprint and drops it. It is listed here rather than
 * fetched separately so there is exactly one place where the mapping from row
 * to response happens, and that place cannot forget to strip it.
 */
const API_KEY_ROW_FIELDS = {
  id: true,
  name: true,
  scopes: true,
  keyHash: true,
  lastUsedAt: true,
  expiresAt: true,
  revokedAt: true,
  createdAt: true,
} as const;

type ApiKeyRow = {
  id: string;
  name: string;
  scopes: string;
  keyHash: string;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
};

/**
 * Longest expiry a key may be given.
 *
 * Not a security control — `expiresAt: null` (never expires) is still allowed,
 * because unattended integrations that break annually are integrations that get
 * replaced with a never-expiring one anyway. This exists to reject the sentinel
 * dates people reach for when a form demands a value: 9999-12-31 stored as an
 * expiry produces a key that looks time-bounded in the UI and is not.
 */
const MAX_EXPIRY_MS = 5 * 365 * 24 * 60 * 60 * 1000;

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly logger: AppLogger,
  ) {
    this.logger.setContext(ApiKeysService.name);
  }

  /**
   * Mint a key. The plaintext is returned here and is unrecoverable afterwards.
   *
   * 32 bytes from the CSPRNG, rendered base62 behind the `fbk_` prefix that
   * secret scanners match on, hashed with SHA-256, and only the hash stored.
   * SHA-256 rather than argon2id — deliberately, and the reasoning is the
   * opposite of the password case: this is 256 bits of uniform randomness, not
   * something a human chose, so there is no dictionary to run and nothing for a
   * slow KDF to buy. What a fast hash does buy is a lookup that can be an index
   * probe on every request instead of a per-row verification pass over the
   * whole table.
   */
  async createApiKey(
    orgId: string,
    userId: string,
    dto: CreateApiKeyDto,
    ipAddress?: string,
  ) {
    const expiresAt = this.parseExpiry(dto.expiresAt);

    // De-duplicated and normalised here rather than trusting the request array,
    // so `["forms:read","forms:read"]` cannot inflate the stored string toward
    // the VarChar(500) ceiling.
    const scopes = dto.scopes ? parseScopes(dto.scopes.join(',')) : undefined;

    const rawKey = generateRawApiKey();
    const keyHash = sha256Hex(rawKey);

    const created = await this.prisma.writer.apiKey.create({
      data: {
        userId,
        organizationId: orgId,
        name: dto.name.trim(),
        keyHash,
        // Omitting the field entirely lets the schema default
        // (`forms:read,submissions:read`) apply. Passing `undefined` explicitly
        // would be the same thing, but this reads as the intent it is.
        ...(scopes ? { scopes: scopes.join(',') } : {}),
        expiresAt,
      },
      select: API_KEY_ROW_FIELDS,
    });

    this.audit.log({
      organizationId: orgId,
      userId,
      action: 'api_key.created',
      resource: 'api_key',
      resourceId: created.id,
      // The fingerprint, never the key and never the hash — an audit log is
      // read by more people, and retained longer, than the key itself.
      metadata: {
        name: created.name,
        scopes: parseScopes(created.scopes),
        fingerprint: fingerprintFromHash(created.keyHash),
        expiresAt: created.expiresAt?.toISOString() ?? null,
      },
      ipAddress,
    });

    // `key` appears in this response object and in no other, anywhere in the
    // codebase. Every read path goes through `toPublicApiKey`, which has no
    // access to the plaintext to leak.
    return { ...toPublicApiKey(created), key: rawKey };
  }

  /**
   * List an organization's keys.
   *
   * Revoked keys are deliberately NOT filtered out — that is the whole point of
   * `ApiKey.revokedAt` being a soft revoke. An incident review needs to see that
   * a key existed, what it was scoped to, and when it was last used; a list that
   * hides it answers none of those. They sort below live keys and the UI greys
   * them out.
   */
  async listApiKeys(orgId: string) {
    const rows = await this.prisma.reader.apiKey.findMany({
      where: { organizationId: orgId },
      select: API_KEY_ROW_FIELDS,
      // `nulls: 'first'` is load-bearing. Postgres sorts NULLs last on ASC, and
      // "not revoked" is NULL — without this the live keys, which are the ones
      // anybody came to this page to look at, sort to the bottom.
      orderBy: [
        { revokedAt: { sort: 'asc', nulls: 'first' } },
        { createdAt: 'desc' },
      ],
    });

    return rows.map(toPublicApiKey);
  }

  /**
   * Soft-revoke a key.
   *
   * The schema comment on `revokedAt` spells out why this is not a DELETE: a
   * hard delete erases what the key was permitted to do and when it was last
   * used, which is exactly the evidence an incident review is opened to find.
   * The row stays, the credential stops working.
   *
   * Idempotent. Revoking an already-revoked key returns it unchanged rather
   * than 404-ing or moving the timestamp — "when was this revoked" must not
   * change because somebody clicked twice, and a UI that lost the race with
   * another admin should not show an error for an outcome that is already true.
   */
  async revokeApiKey(
    orgId: string,
    keyId: string,
    actorUserId: string,
    ipAddress?: string,
  ) {
    const existing = await this.prisma.writer.apiKey.findFirst({
      where: { id: keyId, organizationId: orgId },
      select: API_KEY_ROW_FIELDS,
    });

    if (!existing) {
      throw new NotFoundException('API key not found in this organization.');
    }

    if (existing.revokedAt) {
      // Still evict — if a previous revoke failed to reach Redis, this is the
      // retry, and it is the only thing standing between a "revoked" key and
      // another cache-TTL of it working.
      await this.evictFromCache(existing.keyHash, existing.id);
      return toPublicApiKey(existing);
    }

    const updated = await this.prisma.writer.apiKey.update({
      where: { id: keyId },
      data: { revokedAt: new Date() },
      select: API_KEY_ROW_FIELDS,
    });

    // Awaited, not fire-and-forget. ApiKeyGuard caches validated keys, so until
    // this entry is gone the revoked key keeps authenticating. Returning 200 to
    // an admin who just killed a leaked credential while it is still live for
    // another minute is the one outcome this whole route exists to prevent.
    await this.evictFromCache(updated.keyHash, updated.id);

    this.audit.log({
      organizationId: orgId,
      userId: actorUserId,
      action: 'api_key.revoked',
      resource: 'api_key',
      resourceId: updated.id,
      metadata: {
        name: updated.name,
        scopes: parseScopes(updated.scopes),
        fingerprint: fingerprintFromHash(updated.keyHash),
        lastUsedAt: updated.lastUsedAt?.toISOString() ?? null,
      },
      ipAddress,
    });

    return toPublicApiKey(updated);
  }

  /**
   * Drop the guard's cached copy of a key.
   *
   * Failure is logged loudly but does not fail the request: the database is the
   * source of truth and the cache entry expires on its own within
   * ApiKeyGuard.CACHE_TTL_SECONDS. Throwing here would leave the caller
   * believing the revocation did not happen when in fact it did — and inviting
   * a retry that cannot help.
   */
  private async evictFromCache(
    keyHash: string,
    apiKeyId: string,
  ): Promise<void> {
    try {
      await this.redis.del(apiKeyCacheKey(keyHash));
    } catch (err) {
      this.logger.error(
        'Failed to evict revoked API key from cache — it may authenticate until the entry expires',
        err as Error,
        { apiKeyId },
      );
    }
  }

  /** Validate a requested expiry against "in the future" and MAX_EXPIRY_MS. */
  private parseExpiry(value: string | null | undefined): Date | null {
    if (!value) return null;

    const expiresAt = new Date(value);
    if (Number.isNaN(expiresAt.getTime())) {
      throw new BadRequestException('expiresAt is not a valid date.');
    }

    const now = Date.now();
    if (expiresAt.getTime() <= now) {
      throw new BadRequestException('expiresAt must be in the future.');
    }

    if (expiresAt.getTime() - now > MAX_EXPIRY_MS) {
      throw new BadRequestException(
        'expiresAt may be at most 5 years away. Omit it for a key that never expires.',
      );
    }

    return expiresAt;
  }
}

/**
 * Row → API response. The single chokepoint through which key rows reach a
 * caller, and the reason no read path can return `keyHash`.
 */
function toPublicApiKey(row: ApiKeyRow) {
  const { keyHash, scopes, ...rest } = row;

  return {
    ...rest,
    scopes: parseScopes(scopes),
    /** Non-reversible display hint. See `fingerprintFromHash`. */
    fingerprint: fingerprintFromHash(keyHash),
  };
}

/** `fbk_` + 43 base62 characters of CSPRNG output. */
function generateRawApiKey(): string {
  return API_KEY_PREFIX + encodeBase62(randomBytes(32));
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
