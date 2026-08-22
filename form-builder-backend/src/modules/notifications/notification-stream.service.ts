import {
  HttpException,
  HttpStatus,
  Injectable,
  OnModuleDestroy,
  type MessageEvent,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { randomUUID } from 'crypto';
import type Redis from 'ioredis';
import { RedisService } from '../../common/infra/redis/redis.service';
import { AppLogger } from '../../common/observability/logger/app-logger.service';

/**
 * The live half of notifications: Redis pub/sub fanned out to SSE clients.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why Redis and not an in-memory Subject ─────────────────────────────────
 * The obvious implementation is a `Map<userId, Subject>` in the service and a
 * `subject.next(...)` wherever a notification is written. It works perfectly on
 * one pod and fails silently on two: the writer that persisted the row is a
 * different process from the one holding the user's open connection, so the row
 * appears in the list on refresh and never arrives live. Worse, it fails
 * *intermittently* — with two pods it works half the time — which is the kind
 * of bug that gets closed as "cannot reproduce".
 *
 * Notifications are also written from the BullMQ worker (`PROCESS_ROLE=worker`),
 * which by design serves no HTTP at all and therefore holds no connections. An
 * in-process Subject there reaches exactly nobody, always.
 *
 * So every notification is published to `notifications:user:<id>`, and each pod
 * subscribes only to the channels for users it is actually holding a connection
 * for. Per-user channels rather than one firehose channel (or a `PSUBSCRIBE`
 * pattern) because the alternative delivers every tenant's notification payload
 * to every pod, which is both wasteful and a tenancy surface nobody wants.
 *
 * ── The subscriber connection must be its own socket ───────────────────────
 * A Redis connection in subscriber mode can only issue (P)SUBSCRIBE,
 * (P)UNSUBSCRIBE, PING and QUIT. Calling `SUBSCRIBE` on the shared client from
 * `RedisService` would put the connection every cache read, quota counter, and
 * throttler bucket in this process depends on into a mode where those commands
 * are rejected. Hence `duplicate()`.
 *
 * It is created LAZILY, on the first connection this pod accepts, so the worker
 * process — which publishes but never subscribes — never opens the socket.
 */

/** One channel per user. */
const CHANNEL_PREFIX = 'notifications:user:';

/** The Redis key holding a user's currently-open streams, across all pods. */
const STREAMS_KEY_PREFIX = 'sse:streams:';

/**
 * Concurrent streams per user, platform-wide.
 *
 * Generous enough for a person with several tabs open plus a stale one the
 * browser has not yet torn down, low enough that a script cannot open ten
 * thousand and pin a pod's memory and file descriptors. Each open stream costs
 * a socket on some pod and an entry in a sorted set.
 */
const MAX_STREAMS_PER_USER = 6;

/**
 * Heartbeat interval.
 *
 * Idle connections are killed by intermediaries long before the client notices:
 * nginx's `proxy_read_timeout` defaults to 60s, ELB/ALB idle timeout to 60s,
 * and a number of corporate proxies are stricter. Without traffic the browser
 * eventually reconnects, but only after the connection has been silently dead
 * for up to a minute — during which notifications are simply lost, because
 * nothing is buffering them. 25 seconds sits comfortably inside every common
 * default.
 */
const HEARTBEAT_MS = 25_000;

/**
 * A stream entry is considered abandoned if its heartbeat has not refreshed it
 * within this window. Generously more than two heartbeats, so a slow pod is
 * never mistaken for a dead one.
 */
const STREAM_STALE_MS = HEARTBEAT_MS * 3;

/**
 * Maximum lifetime of a single connection.
 *
 * The ticket that authorized this stream was checked once, at connect time.
 * Left alone, a connection opened this morning would still be delivering
 * notifications this evening to a session that has since been signed out or
 * revoked. Ending the stream on a timer forces the client to obtain a fresh
 * ticket, which requires a live access token, which bounds the window in which
 * a dead session keeps receiving data. The client reconnects transparently —
 * `use-notifications.ts` treats a server-closed stream as a normal reconnect.
 */
const MAX_STREAM_LIFETIME_MS = 30 * 60_000;

/**
 * Admit one stream if the user is under the cap, in a single round trip.
 *
 * Three things have to happen without anything interleaving: prune entries
 * whose heartbeat has stopped, count what remains, and add this connection only
 * if the count is under the limit. Done as separate commands, N simultaneous
 * connections all read the same count and all decide they fit.
 *
 * Pruning by score rather than relying on key expiry is what makes this
 * self-healing: when a pod is SIGKILLed its connections never run their
 * cleanup, so their entries stay behind. Nothing refreshes them, so the next
 * admission drops them. Without that, one crash permanently costs those users
 * part of their allowance.
 */
const ADMIT_SCRIPT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[2]) then
  return 0
end
redis.call('ZADD', KEYS[1], ARGV[3], ARGV[4])
redis.call('PEXPIRE', KEYS[1], ARGV[5])
return 1
`;

/** What a subscriber to a user's channel receives. */
export interface NotificationPush {
  id: string;
  type: string;
  title: string;
  body: string | null;
  metadata: unknown;
  isRead: boolean;
  createdAt: string;
}

@Injectable()
export class NotificationStreamService implements OnModuleDestroy {
  /**
   * Dedicated subscriber connection. Null until the first stream is opened on
   * this pod — see the note above about the worker process.
   */
  private subscriber: Redis | null = null;

  /**
   * Local delivery targets, keyed by user. A pod can hold several connections
   * for one user (multiple tabs) behind a single Redis subscription.
   */
  private readonly listeners = new Map<
    string,
    Set<(push: NotificationPush) => void>
  >();

  /**
   * Serialises SUBSCRIBE/UNSUBSCRIBE per user.
   *
   * Two tabs closing and opening in the same tick would otherwise race: the
   * unsubscribe for the closing one is issued, the new one sees a non-empty
   * listener set and skips subscribing, and then the unsubscribe lands — the
   * pod is now holding a connection for a channel it no longer receives. The
   * user's notifications stop arriving and nothing looks wrong anywhere.
   */
  private readonly channelOps = new Map<string, Promise<unknown>>();

  constructor(
    private readonly redis: RedisService,
    private readonly logger: AppLogger,
  ) {
    this.logger.setContext(NotificationStreamService.name);
  }

  async onModuleDestroy() {
    if (this.subscriber) {
      await this.subscriber.quit().catch(() => undefined);
      this.subscriber = null;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PUBLISH
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Announce a notification to whichever pod is holding that user's stream.
   *
   * Never throws. A notification that failed to publish is already durably in
   * the database and will appear the next time the list is fetched or the
   * stream reconnects; letting a Redis blip fail the surrounding write — a
   * submission, an invitation acceptance — would be wildly disproportionate.
   */
  async publish(userId: string, push: NotificationPush): Promise<void> {
    try {
      await this.redis
        .getClient()
        .publish(`${CHANNEL_PREFIX}${userId}`, JSON.stringify(push));
    } catch (err) {
      this.logger.warn(
        'Could not publish a notification to Redis; it will arrive on refresh',
        {
          userId,
          notificationId: push.id,
          error: (err as Error)?.message,
        },
      );
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SUBSCRIBE
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * The event stream for one connection.
   *
   * Returned synchronously even though admission is asynchronous, because
   * `@Sse()` subscribes immediately and `SseStream` defers the response headers
   * until the first message — so an `observer.error()` raised before anything is
   * emitted still reaches the exception filter and becomes a normal JSON error
   * with a real status code, rather than a 200 followed by an empty stream.
   *
   * EVERY resource acquired here is registered on `disposers` the moment it is
   * acquired, and `teardown` runs them whether the connection ended because the
   * client navigated away, because the lifetime cap expired it, or because the
   * observable errored. RxJS calls the returned teardown exactly once on
   * unsubscribe, and Nest's SSE handler unsubscribes on the request socket's
   * `close` event — that is the path that a leaking implementation misses, and
   * it is the one that fires on every single reconnect.
   */
  connect(userId: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((observer) => {
      const connectionId = randomUUID();
      const disposers: Array<() => void | Promise<void>> = [];
      let disposed = false;

      /**
       * Register cleanup for a resource. If the connection has ALREADY been
       * torn down by the time the resource was acquired — the client that
       * disconnects while the admission round trip is still in flight, which is
       * exactly what an aggressive reconnect loop produces — release it
       * immediately instead of adding it to a list nobody will drain again.
       */
      const onDispose = (fn: () => void | Promise<void>) => {
        if (disposed) {
          void Promise.resolve()
            .then(fn)
            .catch((err) =>
              this.logger.warn('Late SSE cleanup failed', {
                error: err?.message,
              }),
            );
          return;
        }
        disposers.push(fn);
      };

      const teardown = () => {
        if (disposed) return;
        disposed = true;
        // Unwind in reverse acquisition order, and never let one failure strand
        // the rest — a failed Redis UNSUBSCRIBE must not skip the release of
        // the user's stream slot.
        for (const dispose of disposers.reverse()) {
          try {
            void Promise.resolve(dispose()).catch((err) =>
              this.logger.warn('SSE cleanup step failed', {
                error: err?.message,
              }),
            );
          } catch (err) {
            this.logger.warn('SSE cleanup step threw', {
              error: (err as Error)?.message,
            });
          }
        }
        disposers.length = 0;
      };

      void (async () => {
        try {
          const admitted = await this.admit(userId, connectionId);
          if (!admitted) {
            observer.error(
              new HttpException(
                `Too many open notification streams (limit ${MAX_STREAMS_PER_USER}). Close another tab and try again.`,
                HttpStatus.TOO_MANY_REQUESTS,
              ),
            );
            return;
          }
          onDispose(() => this.release(userId, connectionId));
          if (disposed) return;

          const deliver = (push: NotificationPush) => {
            // `id` lets the browser send Last-Event-ID on reconnect. We do not
            // replay from it — the client refetches the list instead, which is
            // both simpler and correct across a pod change — but leaving it out
            // entirely makes SseStream invent sequential ids that mean nothing.
            observer.next({ id: push.id, type: 'notification', data: push });
          };

          await this.retainChannel(userId, deliver);
          onDispose(() => this.releaseChannel(userId, deliver));
          if (disposed) return;

          // First message: commits the response headers immediately so the
          // browser reports the connection as open, and gives any buffering
          // proxy something to flush. Without it a client sits in `CONNECTING`
          // until the first real notification, which may be hours.
          observer.next({
            type: 'ready',
            data: { connectedAt: new Date().toISOString() },
          });

          const heartbeat = setInterval(() => {
            // A comment frame (`: ping`) would be the idiomatic keep-alive, but
            // Nest's SseStream only writes id/event/data/retry fields — there is
            // no way to emit a bare comment through `@Sse()`. A named event the
            // client does not listen for is the next best thing: `EventSource`
            // dispatches it as a `heartbeat` event with no handler attached, so
            // it costs the page nothing while still moving bytes.
            observer.next({ type: 'heartbeat', data: { at: Date.now() } });
            // Keep this connection's entry fresh so another pod's admission
            // check does not prune it as abandoned.
            void this.touch(userId, connectionId);
          }, HEARTBEAT_MS);
          onDispose(() => clearInterval(heartbeat));

          const lifetime = setTimeout(() => {
            // Complete rather than error: the client should reconnect quietly,
            // not surface a failure to the user.
            observer.complete();
          }, MAX_STREAM_LIFETIME_MS);
          onDispose(() => clearTimeout(lifetime));
        } catch (err) {
          this.logger.error('Could not open a notification stream', err, {
            userId,
          });
          observer.error(
            new HttpException(
              'The notification stream is unavailable.',
              HttpStatus.SERVICE_UNAVAILABLE,
            ),
          );
        }
      })();

      return teardown;
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Redis channel bookkeeping
  // ══════════════════════════════════════════════════════════════════════════

  /** Lazily open the dedicated subscriber socket. */
  private getSubscriber(): Redis {
    if (!this.subscriber) {
      // `duplicate()` copies the configured URL and retry strategy, so the
      // subscriber reconnects on the same terms as the command connection.
      this.subscriber = this.redis.getClient().duplicate();

      this.subscriber.on('error', (err) =>
        this.logger.error('Notification subscriber connection error', err),
      );

      // ioredis re-issues the SUBSCRIBE commands for every channel it believes
      // it is subscribed to after a reconnect, so a dropped connection restores
      // itself without any bookkeeping here.
      this.subscriber.on('ready', () =>
        this.logger.info('Notification subscriber connected', {
          channels: this.listeners.size,
        }),
      );

      this.subscriber.on('message', (channel: string, raw: string) => {
        const userId = channel.slice(CHANNEL_PREFIX.length);
        const targets = this.listeners.get(userId);
        if (!targets?.size) return;

        let push: NotificationPush;
        try {
          push = JSON.parse(raw) as NotificationPush;
        } catch {
          this.logger.warn('Discarded an unparseable notification payload', {
            channel,
          });
          return;
        }

        // Copy before iterating: a delivery that ends up completing the
        // observable would otherwise mutate the set mid-iteration.
        for (const target of [...targets]) {
          try {
            target(push);
          } catch (err) {
            this.logger.warn('A notification listener threw', {
              error: (err as Error)?.message,
            });
          }
        }
      });
    }

    return this.subscriber;
  }

  /** Run per-user channel operations strictly in order. See `channelOps`. */
  private enqueue<T>(userId: string, op: () => Promise<T>): Promise<T> {
    const previous = this.channelOps.get(userId) ?? Promise.resolve();
    // `.catch` on the tail, not on `op`: one failed subscribe must not poison
    // every later operation for this user.
    const next = previous.catch(() => undefined).then(op);
    this.channelOps.set(userId, next);
    void next
      .catch(() => undefined)
      .finally(() => {
        if (this.channelOps.get(userId) === next)
          this.channelOps.delete(userId);
      });
    return next;
  }

  private retainChannel(
    userId: string,
    listener: (push: NotificationPush) => void,
  ) {
    return this.enqueue(userId, async () => {
      let targets = this.listeners.get(userId);
      if (!targets) {
        targets = new Set();
        this.listeners.set(userId, targets);
      }
      targets.add(listener);

      // Only the first listener for a user costs a SUBSCRIBE; every extra tab
      // rides the same one.
      if (targets.size === 1) {
        await this.getSubscriber().subscribe(`${CHANNEL_PREFIX}${userId}`);
      }
    });
  }

  private releaseChannel(
    userId: string,
    listener: (push: NotificationPush) => void,
  ) {
    return this.enqueue(userId, async () => {
      const targets = this.listeners.get(userId);
      if (!targets) return;

      targets.delete(listener);
      if (targets.size > 0) return;

      this.listeners.delete(userId);
      // Never throw out of cleanup. If the UNSUBSCRIBE fails the pod keeps
      // receiving messages for a user it no longer serves and drops them on the
      // empty-listener check above — wasteful, but not a leak that grows, and
      // ioredis drops the subscription entirely on its next reconnect.
      await this.getSubscriber()
        .unsubscribe(`${CHANNEL_PREFIX}${userId}`)
        .catch((err) =>
          this.logger.warn('Could not unsubscribe a notification channel', {
            userId,
            error: err?.message,
          }),
        );
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Per-user stream cap
  // ══════════════════════════════════════════════════════════════════════════

  private streamsKey(userId: string): string {
    return `${STREAMS_KEY_PREFIX}${userId}`;
  }

  private async admit(userId: string, connectionId: string): Promise<boolean> {
    const now = Date.now();
    try {
      const result = await this.redis
        .getClient()
        .eval(
          ADMIT_SCRIPT,
          1,
          this.streamsKey(userId),
          String(now - STREAM_STALE_MS),
          String(MAX_STREAMS_PER_USER),
          String(now),
          connectionId,
          String(STREAM_STALE_MS * 2),
        );
      return result === 1;
    } catch (err) {
      // Fail OPEN on the CAP specifically. The cap is a fairness limit, not an
      // authorization decision — that was already made by the ticket — and
      // refusing every notification stream on the platform because a counter is
      // unreachable is a worse outcome than a user briefly holding a seventh
      // tab. The SUBSCRIBE immediately after will fail anyway if Redis is truly
      // down, and that failure is surfaced.
      this.logger.warn('Stream cap unavailable; admitting the connection', {
        userId,
        error: (err as Error)?.message,
      });
      return true;
    }
  }

  /** Refresh this connection's heartbeat timestamp so it is not pruned. */
  private async touch(userId: string, connectionId: string): Promise<void> {
    try {
      const key = this.streamsKey(userId);
      await this.redis
        .getClient()
        .zadd(key, Date.now(), connectionId)
        .then(() => this.redis.getClient().pexpire(key, STREAM_STALE_MS * 2));
    } catch {
      // Nothing to do. A missed refresh only risks this entry being pruned
      // early, which costs the user nothing — the connection stays open, it
      // just stops occupying a slot.
    }
  }

  private async release(userId: string, connectionId: string): Promise<void> {
    try {
      await this.redis.getClient().zrem(this.streamsKey(userId), connectionId);
    } catch (err) {
      // Not fatal: the entry stops being refreshed and the next admission
      // prunes it. Logged because a persistent failure here means every user's
      // cap slowly fills with ghosts.
      this.logger.warn(
        'Could not release a stream slot; it will be pruned as stale',
        {
          userId,
          error: (err as Error)?.message,
        },
      );
    }
  }
}
