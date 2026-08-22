import { Global, Module } from '@nestjs/common';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysService } from './api-keys.service';
import { ApiKeyGuard } from '../../common/auth/api-key.guard';
import { ApiKeyOrJwtGuard } from '../../common/auth/api-key-or-jwt.guard';

/**
 * API key CRUD, plus the two guards that consume the keys.
 *
 * WHY @Global: `ApiKeyOrJwtGuard` injects `ApiKeyGuard` through its
 * constructor. Nest will happily instantiate a guard named in `@UseGuards()`
 * without it being registered anywhere — but only if that guard's own
 * dependencies are resolvable in the module the controller belongs to. A guard
 * injecting another guard is not, so `ApiKeyGuard` has to be a real provider
 * exported from somewhere.
 *
 * Exporting it from a @Global module rather than importing this module into
 * FormsModule, SubmissionsModule, and every future consumer follows what
 * PrismaModule, RedisModule, and LoggerModule already do here, and means adding
 * `@UseGuards(ApiKeyOrJwtGuard)` to a controller never comes with a second,
 * easily-forgotten edit to that controller's module — the failure mode of
 * which is a DI error at boot rather than anything subtle, but a boot failure
 * on a security guard is still a boot failure.
 *
 * NOTE: PrismaService, RedisService, AuditService, and AppLogger are all
 * provided by @Global modules and are deliberately NOT re-declared here —
 * re-declaring PrismaService in particular would open a second pair of
 * connection pools.
 */
@Global()
@Module({
  controllers: [ApiKeysController],
  providers: [ApiKeysService, ApiKeyGuard, ApiKeyOrJwtGuard],
  exports: [ApiKeysService, ApiKeyGuard, ApiKeyOrJwtGuard],
})
export class ApiKeysModule {}
