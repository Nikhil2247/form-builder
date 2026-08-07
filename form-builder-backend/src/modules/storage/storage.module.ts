import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { StorageController } from './storage.controller';
import { StorageService } from './storage.service';
import { FileVerifierProcessor } from './queues/file-verifier.processor';
import { QUEUE_NAMES } from '../../config/bullmq.config';
import { isWorkerMode } from '../../config/runtime.config';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.FILE_VERIFY })],
  controllers: [StorageController],
  providers: [StorageService, ...(isWorkerMode() ? [FileVerifierProcessor] : [])],
  exports: [StorageService],
})
export class StorageModule {}
