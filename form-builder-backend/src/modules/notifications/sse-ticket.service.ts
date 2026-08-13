import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { RedisService } from '../../common/redis/redis.service';
import { AppLogger } from '../../common/logger/app-logger.service';

/**
 * Single-use connection tickets for the SSE stream.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The problem ────────────────────────────────────────────────────────────
 * `EventSource` cannot set request headers. There is no `Authorization: Bearer`
 * on an SSE connection and no API for adding one, which means the access token
 * — which in this app lives in a module variable in `lib/api.ts` and is
 * deliberately never written anywhere a script can read it — cannot reach the
 * stream endpoint the way every other request carries it.
 *
 * ── What was rejected ──────────────────────────────────────────────────────
 *
 *  • `?token=<access token>`. The access token is a full-privilege credential
 *    valid for the whole session against every route on the API. URLs end up in
 *    access logs, in `Referer` on any navigation the page makes afterwards, in
 *    browser history, and in error trackers. Putting the session's master key
 *    there is not a trade-off, it is a mistake.
 *
 *  • The `refresh_token` cookie plus `withCredentials`. It would work — the
 *    cookie is already sent to this origin — but it is worse in two ways that
 *    matter. First, the refresh token MINTS access tokens; authenticating a
 *    read-only notification feed with the credential that can issue new
 *    sessions is the opposite of least privilege. Second, cookie auth is
 *    ambient: any page on the internet can open an `EventSource` to this URL
 *    and the browser will attach the cookie. CORS stops the attacker READING
 *    the events, but the connection is still established and still consumes one
 *    of the user's capped stream slots — a free, silent way to deny a user
 *    their own notifications from any page they happen to visit.
 *
 * ── What this does instead ─────────────────────────────────────────────────
 * `POST /notifications/stream-ticket` is an ordinary bearer-authenticated
 * route. It mints 32 random bytes, stores SHA-256(ticket) → userId in Redis for
 * {@link TICKET_TTL_SECONDS} seconds, and returns the plaintext once. The
 * client immediately opens `GET /notifications/stream?ticket=…`, which consumes
 * the ticket atomically — it is dead the instant it is used.
 *
 * The resulting credential is: valid for 30 seconds, usable exactly once,
 * scoped to one user's own notification feed and nothing else, and obtainable
 * only by a caller who already holds the bearer token. An attacker's page
 * cannot mint one, because minting requires the header it cannot set.
 *
 * ── Residual exposure, stated plainly ──────────────────────────────────────
 * The ticket does appear in the request line, so it lands in
 * `HttpLoggingInterceptor`'s `url` field. By the time anyone reads that log the
 * ticket has already been consumed and is worthless. Deployments that ship
 * request logs to a long-retention store should still add a redaction rule for
 * `ticket=` — see WIRING-notifications.md.
 *
 * The ticket is STORED hashed for the same reason the invitation tokens in
 * OrganizationsService are: anyone with a Redis dump, or an accidental `KEYS`
 * in a debugging session, otherwise walks away with live credentials.
 */

/** Long enough for the browser to open the connection, short enough to be dull. */
export const TICKET_TTL_SECONDS = 30;

const TICKET_KEY_PREFIX = 'sse:ticket:';

/**
 * Consume the ticket and report who it belonged to, atomically.
 *
 * GET-then-DEL from the application would let two connections racing on the
 * same ticket both read it before either deleted it, which is precisely the
 * single-use property this exists to provide. Redis runs the script to
 * completion with nothing interleaved, so exactly one caller can ever see a
 * non-nil reply.
 *
 * `GETDEL` would do the same in one command, but only on Redis 6.2+; the script
 * works everywhere and costs the same round trip.
 */
const CONSUME_SCRIPT = `
local value = redis.call('GET', KEYS[1])
if value then
  redis.call('DEL', KEYS[1])
end
return value
`;

@Injectable()
export class SseTicketService {
  constructor(
    private readonly redis: RedisService,
    private readonly logger: AppLogger,
  ) {
    this.logger.setContext(SseTicketService.name);
  }

  private key(ticket: string): string {
    return `${TICKET_KEY_PREFIX}${createHash('sha256').update(ticket).digest('hex')}`;
  }

  /** Issue a ticket for an already-authenticated user. Returns the plaintext once. */
  async mint(
    userId: string,
  ): Promise<{ ticket: string; expiresInSeconds: number }> {
    const ticket = randomBytes(32).toString('hex');
    await this.redis.set(this.key(ticket), userId, TICKET_TTL_SECONDS);
    return { ticket, expiresInSeconds: TICKET_TTL_SECONDS };
  }

  /**
   * Spend a ticket. Returns the user it was issued to, or null when it is
   * unknown, expired, or already used.
   *
   * A Redis failure returns null rather than throwing: "we cannot verify this
   * ticket" must read as "not authenticated", never as "let them through".
   * That is the opposite of the fail-open choice the submission quota makes,
   * and deliberately so — one is admission control on a soft limit, this is
   * authentication.
   */
  async consume(ticket: string): Promise<string | null> {
    if (
      typeof ticket !== 'string' ||
      ticket.length !== 64 ||
      !/^[0-9a-f]+$/.test(ticket)
    ) {
      // Reject anything that is not the exact shape we issue before it reaches
      // Redis, so a flood of junk tickets costs no round trips.
      return null;
    }

    try {
      const userId = (await this.redis
        .getClient()
        .eval(CONSUME_SCRIPT, 1, this.key(ticket))) as string | null;
      return userId ?? null;
    } catch (err) {
      this.logger.error(
        'Could not verify an SSE ticket; refusing the connection',
        err,
      );
      return null;
    }
  }
}
