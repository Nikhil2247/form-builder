import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Sse,
  UseGuards,
  type MessageEvent,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Observable } from 'rxjs';
import type { Request } from 'express';
import { NotificationsService } from './notifications.service';
import { NotificationStreamService } from './notification-stream.service';
import { SseTicketService } from './sse-ticket.service';
import { SseTicketGuard } from './guards/sse-ticket.guard';
import { ListNotificationsDto } from './dto/list-notifications.dto';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { Public } from '../../common/auth/public.decorator';
import { parsePagination } from '../../common/http/pagination/pagination';

/**
 * In-app notifications for the signed-in user.
 *
 * ── Scoping ────────────────────────────────────────────────────────────────
 * Every route here is scoped to the CALLER, not to an organization, and so
 * carries no `:orgId` and no OrgMemberGuard. A `Notification` belongs to a
 * user; which organization's event produced it was decided at write time by
 * `notification-recipients.ts`, and re-deriving it per read would be both
 * slower and a second place for the rule to be wrong. The consequence is that
 * `userId` from the verified token is the only tenancy key these queries need,
 * and it is applied in the WHERE clause of every one of them.
 *
 * ── Route order ────────────────────────────────────────────────────────────
 * The literal paths (`unread-count`, `stream`, `stream-ticket`, `read-all`) are
 * declared before anything containing `:id`, so Nest cannot match "stream" as
 * an id — the same ordering rule `OrganizationsController` documents for `me`.
 */
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly stream: NotificationStreamService,
    private readonly tickets: SseTicketService,
  ) {}

  /** GET /notifications — the caller's notifications, newest first. */
  @Get()
  async list(@Req() req: Request, @Query() query: ListNotificationsDto) {
    const userId = (req.user as any).sub;
    return this.notifications.list(
      userId,
      parsePagination(query),
      query.unreadOnly === true,
    );
  }

  /**
   * GET /notifications/unread-count — the badge number on its own.
   *
   * Separate from the list because the header renders on every page and does
   * not want a page of rows to draw a number, and because it is the polling
   * fallback when EventSource cannot connect.
   */
  @Get('unread-count')
  async unreadCount(@Req() req: Request) {
    const userId = (req.user as any).sub;
    return this.notifications.unreadCount(userId);
  }

  /**
   * POST /notifications/stream-ticket — mint a single-use ticket for the stream.
   *
   * Authenticated normally, with the bearer header — which is the entire point:
   * the credential that authorizes the stream can only be obtained by a caller
   * that can already set an Authorization header, which an `EventSource` (and
   * therefore a cross-origin attacker's page) cannot.
   *
   * Throttled well below the global bucket. A healthy client mints one ticket
   * per connection, so roughly one every thirty minutes plus reconnects; a
   * client minting thirty a minute is looping and should be told to slow down
   * rather than allowed to fill Redis with live tickets.
   */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('stream-ticket')
  @HttpCode(HttpStatus.OK)
  async streamTicket(@Req() req: Request) {
    const userId = (req.user as any).sub;
    return this.tickets.mint(userId);
  }

  /**
   * GET /notifications/stream?ticket=… — Server-Sent Events.
   *
   * `@Public()` exempts this from JwtAuthGuard — an `EventSource` cannot send
   * the bearer token — and SseTicketGuard authenticates it instead. Public here
   * means "not authenticated by JWT", not "unauthenticated": the guard below
   * rejects anything without a live, unspent ticket, exactly as the decorator's
   * own documentation requires of a route that opts out.
   *
   * Events emitted:
   *   ready        — once, on connect. Commits the response headers.
   *   notification — a new notification for this user.
   *   heartbeat    — every 25s, so intermediaries do not reap the connection.
   */
  @Public()
  @UseGuards(SseTicketGuard)
  @Sse('stream')
  openStream(@Req() req: Request): Observable<MessageEvent> {
    const userId = (req.user as any).sub;
    return this.stream.connect(userId);
  }

  /**
   * POST /notifications/read-all — mark everything read.
   *
   * Declared before `:id/read` for clarity; the two cannot actually collide
   * because they differ in segment count.
   */
  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  async markAllRead(@Req() req: Request) {
    const userId = (req.user as any).sub;
    return this.notifications.markAllRead(userId);
  }

  /** POST /notifications/:id/read — mark one read. Returns the new badge count. */
  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  async markRead(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const userId = (req.user as any).sub;
    return this.notifications.markRead(userId, id);
  }

  /** DELETE /notifications/:id — dismiss one permanently. */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const userId = (req.user as any).sub;
    return this.notifications.remove(userId, id);
  }
}
