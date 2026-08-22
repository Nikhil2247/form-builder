import {
  Controller,
  Get,
  Patch,
  Body,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import { FeatureFlagsService } from './feature-flags.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { SuperAdminGuard } from '../../common/auth/super-admin.guard';

/**
 * Feature flag administration — super-admin only.
 *
 * Resolved flags for the current session are returned by GET /auth/me, so the
 * dashboard never calls this. This controller exists purely to configure them.
 */
@Controller('admin/features')
@UseGuards(JwtAuthGuard, SuperAdminGuard)
export class FeatureFlagsController {
  constructor(private readonly features: FeatureFlagsService) {}

  @Get()
  listFlags() {
    return this.features.listFlags();
  }

  /** Flip the default that applies to every org without an explicit override. */
  @Patch(':key')
  setGlobal(
    @Param('key') key: string,
    @Body() body: { isEnabledGlobally: boolean },
    @Req() req: Request,
  ) {
    return this.features.setGlobal(
      key,
      body.isEnabledGlobally === true,
      (req.user as any)?.sub,
    );
  }

  /**
   * Override one organization.
   *
   * `isEnabled: null` clears the override and returns the org to the global
   * default — which is meaningfully different from an explicit `false`.
   */
  @Patch(':key/organizations/:orgId')
  setForOrganization(
    @Param('key') key: string,
    @Param('orgId') orgId: string,
    @Body() body: { isEnabled: boolean | null },
    @Req() req: Request,
  ) {
    const value = body.isEnabled === null ? null : body.isEnabled === true;
    return this.features.setForOrganization(
      key,
      orgId,
      value,
      (req.user as any)?.sub,
    );
  }
}
