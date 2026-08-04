import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { StorageController } from './storage.controller';
import { StorageService } from './storage.service';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { QUEUE_NAMES } from '../../config/bullmq.config';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_NAMES.FILE_VERIFY }),
    PrismaModule,
  ],
  controllers: [StorageController],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
