import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationStreamService } from './notification-stream.service';
import { SseTicketService } from './sse-ticket.service';
import { SseTicketGuard } from './guards/sse-ticket.guard';
import { isApiMode } from '../../config/runtime.config';

/**
 * In-app notifications.
 *
 * ── Why the controller is conditional ──────────────────────────────────────
 * `worker.ts` boots the SAME AppModule with `createApplicationContext`, so
 * every module here is instantiated in the queue-consumer process too. That is
 * correct and necessary for `NotificationsService` — the submission and webhook
 * processors are the main producers of notifications and run only there — but
 * mounting the controller in a process with no HTTP listener is pointless, and
 * mounting the SSE route in particular advertises a stream endpoint that
 * process could never serve. `WebhooksModule` makes the mirror-image choice
 * with `isWorkerMode()` for its processor.
 *
 * ── Exports ────────────────────────────────────────────────────────────────
 * `NotificationsService` only. The stream service and the ticket service are
 * internals: a caller outside this module that publishes to the stream without
 * first persisting the row produces a notification that vanishes on refresh,
 * and there is no legitimate reason to mint a stream ticket from anywhere else.
 */
@Module({
  controllers: isApiMode() ? [NotificationsController] : [],
  providers: [
    NotificationsService,
    NotificationStreamService,
    SseTicketService,
    SseTicketGuard,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
