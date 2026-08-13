import { Global, Module } from '@nestjs/common';
import { SessionCacheService } from './session-cache.service';

/**
 * SessionModule
 * ══════════════════════════════════════════════════════════════════════════════
 * Global module exposing the authenticated-session cache.
 *
 * WHY @Global, for two reasons that are both about correctness rather than
 * convenience:
 *
 *  1. Its consumers are not in a module. `JwtStrategy` lives in AuthModule, but
 *     `OrgMemberGuard` is instantiated by whichever feature module happens to
 *     declare the controller it decorates — forms, submissions, organizations,
 *     analytics, and so on. Listing SessionCacheService in each of their
 *     `providers` arrays is not just repetitive, it is wrong: Nest would build a
 *     separate instance per module, and the invalidation call sites scattered
 *     across the service layer would then be deleting keys through one instance
 *     while the guards read through another. They would all still hit the same
 *     Redis, so the bug would not show up as a crash — just as a service that
 *     works fine and occasionally serves a permission that was revoked.
 *
 *  2. It follows RedisModule, which is @Global for the harder version of the
 *     same problem (see its comment: duplicate instances there mean duplicate
 *     TCP connections). This module's dependencies — PrismaService, RedisService
 *     and AppLogger — are all already global singletons, so registering it once
 *     here is the only arrangement in which the whole chain stays single.
 *
 * Import once in AppModule and nowhere else.
 */
@Global()
@Module({
  providers: [SessionCacheService],
  exports: [SessionCacheService],
})
export class SessionModule {}
