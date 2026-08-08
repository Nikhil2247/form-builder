import { Global, Module } from '@nestjs/common';
import { FeatureFlagsController } from './feature-flags.controller';
import { FeatureFlagsService } from './feature-flags.service';

/**
 * Global: AuthService resolves flags for GET /auth/me, and other modules will
 * want `isEnabled()` for server-side gating. Exporting once avoids each
 * consumer importing the module — and avoids anyone re-declaring the provider,
 * which is how this codebase previously ended up with duplicate service
 * instances.
 */
@Global()
@Module({
  controllers: [FeatureFlagsController],
  providers: [FeatureFlagsService],
  exports: [FeatureFlagsService],
})
export class FeatureFlagsModule {}
