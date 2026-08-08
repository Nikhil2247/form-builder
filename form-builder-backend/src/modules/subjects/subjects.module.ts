import { Module } from '@nestjs/common';
import { SubjectsController } from './subjects.controller';
import { SubjectsService } from './subjects.service';

/**
 * PrismaService, RedisService and AuditService are provided by @Global() modules.
 * Re-declaring them here would create a second instance of each — which is
 * exactly the bug that gave this app 8 Prisma clients per pod. Import only.
 */
@Module({
  controllers: [SubjectsController],
  providers: [SubjectsService],
  exports: [SubjectsService],
})
export class SubjectsModule {}
