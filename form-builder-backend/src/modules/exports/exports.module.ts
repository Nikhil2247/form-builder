import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';
import { ExportProducer } from './queues/export.producer';
import { ExportProcessor } from './queues/export.processor';
import { ExportSweeper } from './queues/export-sweeper.service';
import { EXPORTS_QUEUE } from './queues/export-queue.constants';
import { isWorkerMode } from '../../config/runtime.config';
import { FormsModule } from '../forms/forms.module';

/**
 * Asynchronous exports.
 *
 * FormsModule is imported for FormsService, whose `exportSubmissions` generator
 * is the row source. Reusing it is the point: it is where soft-deleted
 * submissions are excluded and where the CSV encoding lives, and a second copy
 * in this module would be correct exactly once — on the day it was written.
 *
 * The processor is registered only in worker (or combined) mode, matching
 * SubmissionsModule and WebhooksModule. An API pod that consumed export jobs
 * would spend minutes streaming a submissions table on the same event loop it
 * serves HTTP from, which is precisely the coupling this feature exists to
 * break — and it would make export throughput unscalable without also scaling
 * the API.
 *
 * ExportSweeper is a provider in BOTH modes even though only the worker's
 * processor invokes it, because it is plain injectable logic with no queue
 * binding of its own; keeping the provider list identical avoids a resolution
 * error the first time anything else wants to trigger a sweep.
 */
@Module({
  imports: [FormsModule, BullModule.registerQueue({ name: EXPORTS_QUEUE })],
  controllers: [ExportsController],
  providers: [
    ExportsService,
    ExportProducer,
    ExportSweeper,
    ...(isWorkerMode() ? [ExportProcessor] : []),
  ],
  exports: [ExportsService],
})
export class ExportsModule {}
