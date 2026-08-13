import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgMemberGuard } from '../../common/guards/org-member.guard';
import { RoleGuard } from '../../common/guards/role.guard';
import { RequiredRole } from '../../common/decorators/roles.decorator';
import { OrgId } from '../../common/decorators/org-id.decorator';

/**
 * Organization-scoped API key management.
 *
 * ADMIN-only, class-wide, on the same reasoning the webhooks controller uses:
 * a key here can read every submission in the organization, so issuing one is
 * an administrative act even though reading with it is not.
 *
 * NOTE THE GUARD: `JwtAuthGuard`, NOT `ApiKeyOrJwtGuard`. An API key can never
 * be used to mint, list, or revoke API keys. A leaked read-only key that could
 * reach this controller would be able to mint itself a write-scoped successor
 * and survive the revocation of the original — a credential that can issue
 * credentials is a foothold, not a key. Managing keys requires a human session.
 */
@Controller('organizations/:orgId/api-keys')
@UseGuards(JwtAuthGuard, OrgMemberGuard, RoleGuard)
@RequiredRole('ADMIN')
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  /**
   * POST /organizations/:orgId/api-keys — mint a key.
   *
   * Rate limited well below the global 100/min. Creation is the expensive,
   * irreversible half of this controller: each call permanently adds a
   * long-lived credential, and there is no legitimate workflow that needs more
   * than a handful. A stricter bucket here means a compromised admin session
   * cannot quietly seed dozens of persistence keys before anyone notices, and
   * costs a real admin nothing — they create one key and copy it.
   */
  @Post()
  @Throttle({ default: { limit: 5, ttl: 300_000 } })
  createApiKey(
    @OrgId() orgId: string,
    @Body() dto: CreateApiKeyDto,
    @Req() req: Request,
  ) {
    const userId = (req.user as any).sub;
    return this.apiKeysService.createApiKey(orgId, userId, dto, clientIp(req));
  }

  /**
   * GET /organizations/:orgId/api-keys — list keys.
   *
   * Returns no key material of any kind: not the plaintext (never stored), not
   * the hash, only a fingerprint derived from it. Revoked keys are included.
   */
  @Get()
  listApiKeys(@OrgId() orgId: string) {
    return this.apiKeysService.listApiKeys(orgId);
  }

  /**
   * DELETE /organizations/:orgId/api-keys/:keyId — SOFT revoke.
   *
   * DELETE is the verb because that is what the operation means to the caller
   * — the credential stops working, immediately and permanently. What the row
   * does is a storage detail, and it is a soft revoke for the reasons in the
   * `ApiKey.revokedAt` schema comment.
   *
   * `ParseUUIDPipe` so a malformed id is a 400 here rather than a Prisma error
   * surfacing as a 500 from inside the service.
   */
  @Delete(':keyId')
  revokeApiKey(
    @OrgId() orgId: string,
    @Param('keyId', new ParseUUIDPipe()) keyId: string,
    @Req() req: Request,
  ) {
    const userId = (req.user as any).sub;
    return this.apiKeysService.revokeApiKey(
      orgId,
      keyId,
      userId,
      clientIp(req),
    );
  }
}

/**
 * req.ips is populated from X-Forwarded-For because main.ts sets `trust proxy`.
 * Reading the header directly would let the client choose what the audit log
 * records about them.
 */
function clientIp(req: Request): string {
  return req.ips?.[0] ?? req.ip ?? req.socket?.remoteAddress ?? 'unknown';
}
