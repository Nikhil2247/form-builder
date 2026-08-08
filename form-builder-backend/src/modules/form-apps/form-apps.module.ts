import { Module } from '@nestjs/common';
import { FormAppsController } from './form-apps.controller';
import { FormAppsService } from './form-apps.service';

/** Prisma and Audit come from @Global() modules — import only, never re-provide. */
@Module({
  controllers: [FormAppsController],
  providers: [FormAppsService],
  exports: [FormAppsService],
})
export class FormAppsModule {}
