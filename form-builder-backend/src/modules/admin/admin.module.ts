import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { SystemService } from './services/system.service';
import { AdminUsersService } from './services/admin-users.service';
import { QUEUE_NAMES } from '../../config/bullmq.config';

/**
 * Queues are registered read-only here: SystemService only calls
 * getJobCounts(). Registering them does not make this module a consumer —
 * processors are declared in their own modules and only in worker mode.
 */
@Module({
  imports: [
    BullModule.registerQueue(
      { name: QUEUE_NAMES.SUBMISSIONS },
      { name: QUEUE_NAMES.WEBHOOKS },
      { name: QUEUE_NAMES.FILE_VERIFY },
    ),
  ],
  controllers: [AdminController],
  providers: [AdminService, SystemService, AdminUsersService],
  exports: [AdminService],
})
export class AdminModule {}
