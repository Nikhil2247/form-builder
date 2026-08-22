import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/infra/prisma/prisma.service';
import { AppLogger } from '../../common/observability/logger/app-logger.service';
import {
  parsePagination,
  paginated,
  type Pagination,
} from '../../common/http/pagination/pagination';
import {
  NotificationStreamService,
  type NotificationPush,
} from './notification-stream.service';
import {
  selectRecipients,
  type NotificationType,
  type OrgMemberRef,
} from './logic/notification-recipients';

/**
 * Everything a notification read returns.
 *
 * Explicit rather than a bare `findMany`, following the pattern in
 * WebhooksService: the row shape is a wire contract with the notification list
 * and the SSE payload, and both have to agree exactly or a live push renders
 * differently from the same row after a refresh.
 */
const NOTIFICATION_FIELDS = {
  id: true,
  type: true,
  title: true,
  body: true,
  metadata: true,
  isRead: true,
  createdAt: true,
} as const;

/** `Notification.title` is VarChar(255) and `type` VarChar(50). */
const MAX_TITLE = 255;
const MAX_TYPE = 50;

export interface CreateNotificationInput {
  userId: string;
  /**
   * `string`, not `NotificationType | string` — that union collapses to
   * `string`, so the named type added documentation and no checking. Kept as a
   * plain string because the column is a VarChar(50) that modules outside this
   * one write to; NotificationType remains the canonical list for callers that
   * want it.
   */
  type: string;
  title: string;
  body?: string | null;
  /** Deep-link context, e.g. `{ formId, submissionId }`. */
  metadata?: Record<string, unknown> | null;
}

export interface NotifyOrganizationInput {
  organizationId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  metadata?: Record<string, unknown> | null;
  /** The user who caused the event; never notified about their own action. */
  actorUserId?: string | null;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stream: NotificationStreamService,
    private readonly logger: AppLogger,
  ) {
    this.logger.setContext(NotificationsService.name);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // EMISSION — the API other modules call
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Notify one specific user.
   *
   * Persist first, publish second, and never the other way round: a push that
   * arrives before its row is committed shows an entry the user cannot then
   * find in their list, and a failed publish is invisible because the row is
   * already there to be fetched.
   */
  async create(input: CreateNotificationInput) {
    const notification = await this.prisma.writer.notification.create({
      data: {
        userId: input.userId,
        type: String(input.type).slice(0, MAX_TYPE),
        title: input.title.slice(0, MAX_TITLE),
        body: input.body ?? null,
        metadata: (input.metadata ?? undefined) as any,
      },
      select: NOTIFICATION_FIELDS,
    });

    await this.stream.publish(input.userId, this.toPush(notification));

    return notification;
  }

  /**
   * Notify the members of an organization who are entitled to hear about this.
   *
   * The audience decision lives in `notification-recipients.ts` and is unit
   * tested there; this method's only jobs are to fetch the roster for exactly
   * one organization and to write what comes back.
   *
   * NEVER THROWS. Every caller is a side effect of something more important —
   * a submission that has already been committed, an invitation that has
   * already been accepted, a webhook that has already exhausted its retries.
   * Failing those because the notification write failed would turn a cosmetic
   * problem into data loss, so failures are logged and swallowed. This mirrors
   * the treatment `SubmissionProcessor.runSideEffects` gives notification
   * emails for the same reason.
   *
   * @returns how many notifications were written (0 is a normal outcome).
   */
  async notifyOrganization(input: NotifyOrganizationInput): Promise<number> {
    try {
      const members: OrgMemberRef[] =
        await this.prisma.reader.organizationMember.findMany({
          where: { organizationId: input.organizationId },
          select: { userId: true, role: true, organizationId: true },
        });

      const recipients = selectRecipients(members, {
        organizationId: input.organizationId,
        type: input.type,
        actorUserId: input.actorUserId,
      });

      if (recipients.length === 0) return 0;

      const type = String(input.type).slice(0, MAX_TYPE);
      const title = input.title.slice(0, MAX_TITLE);
      const body = input.body ?? null;
      const metadata = (input.metadata ?? undefined) as any;

      // `createManyAndReturn` rather than `createMany`: the ids are needed to
      // publish, and a second round trip to re-read what we just inserted would
      // have to guess at which rows were ours.
      const created = await this.prisma.writer.notification.createManyAndReturn(
        {
          data: recipients.map((userId) => ({
            userId,
            type,
            title,
            body,
            metadata,
          })),
          select: { ...NOTIFICATION_FIELDS, userId: true },
        },
      );

      await Promise.all(
        created.map((row: any) =>
          this.stream.publish(row.userId, this.toPush(row)),
        ),
      );

      return created.length;
    } catch (err) {
      this.logger.error('Failed to emit an organization notification', err, {
        organizationId: input.organizationId,
        type: input.type,
      });
      return 0;
    }
  }

  /** Row → wire payload. One conversion, so list and stream cannot diverge. */
  private toPush(row: {
    id: string;
    type: string;
    title: string;
    body: string | null;
    metadata: unknown;
    isRead: boolean;
    createdAt: Date;
  }): NotificationPush {
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      metadata: row.metadata ?? null,
      isRead: row.isRead,
      // Serialised here rather than left as a Date, because the payload crosses
      // Redis as JSON and would otherwise be a Date on one path and a string on
      // the other.
      createdAt: row.createdAt.toISOString(),
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // READS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * The caller's own notifications.
   *
   * Scoped on `userId` in the WHERE clause, never on a client-supplied id —
   * there is no route by which one user can name another's notifications, and
   * the ordering matches the `[userId, createdAt desc]` index so paging stays
   * an index scan rather than a sort.
   */
  async list(
    userId: string,
    pagination: Pagination = parsePagination(),
    unreadOnly = false,
  ) {
    const where = { userId, ...(unreadOnly ? { isRead: false } : {}) };

    const [notifications, total, unreadCount] = await Promise.all([
      this.prisma.reader.notification.findMany({
        where,
        select: NOTIFICATION_FIELDS,
        // `id` breaks ties: notifications written by one `createManyAndReturn`
        // share a `createdAt` to the microsecond and would otherwise swap
        // between pages.
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.reader.notification.count({ where }),
      // Returned alongside the page so the badge and the list can never
      // disagree after a mark-as-read — the page that just changed the state is
      // the page that gets the corrected count.
      this.prisma.reader.notification.count({
        where: { userId, isRead: false },
      }),
    ]);

    return {
      ...paginated('notifications', notifications, pagination, total),
      unreadCount,
    };
  }

  /**
   * Just the badge number.
   *
   * A count against the `[userId, isRead]` index — cheap enough to poll, which
   * matters because it is the fallback when the SSE stream cannot connect.
   */
  async unreadCount(userId: string) {
    const unreadCount = await this.prisma.reader.notification.count({
      where: { userId, isRead: false },
    });
    return { unreadCount };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MUTATIONS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Mark one notification read.
   *
   * `updateMany` with the userId in the WHERE, not `update` on the id: the
   * latter would happily flip another user's row and only the 404 afterwards
   * would hint at it. A zero count here means "not yours or not there", and
   * both answer 404 so the endpoint cannot be used to probe for the existence
   * of other people's notification ids.
   */
  async markRead(userId: string, id: string) {
    const result = await this.prisma.writer.notification.updateMany({
      where: { id, userId },
      data: { isRead: true },
    });

    if (result.count === 0)
      throw new NotFoundException('Notification not found.');

    return this.unreadCount(userId);
  }

  async markAllRead(userId: string) {
    // Filtered on `isRead: false` so the write touches only rows that change,
    // which keeps a user with thousands of read notifications from rewriting
    // all of them every time they click the button.
    const result = await this.prisma.writer.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });

    return { markedRead: result.count, unreadCount: 0 };
  }

  async remove(userId: string, id: string) {
    const result = await this.prisma.writer.notification.deleteMany({
      where: { id, userId },
    });

    if (result.count === 0)
      throw new NotFoundException('Notification not found.');

    return this.unreadCount(userId);
  }
}
