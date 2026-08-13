import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { SseTicketService } from '../sse-ticket.service';
import { AppLogger } from '../../../common/logger/app-logger.service';

/**
 * Authenticates the SSE stream from a single-use connection ticket.
 *
 * The reasoning for why the stream is not authenticated with a bearer header, a
 * cookie, or an access token in the query string is in `sse-ticket.service.ts`
 * — read that first; this guard is only the enforcement.
 *
 * It attaches a `req.user` of the same SHAPE the JWT strategy produces (`sub`),
 * so `@CurrentUser()` and the logging interceptor's `user?.sub` lookup behave
 * identically on this route. It deliberately does NOT populate `organizationId`
 * or `orgRole`: nothing on the stream is org-scoped — a user receives their own
 * notifications and only their own — and inventing a half-filled principal is
 * how a route ends up authorizing against a field that was never verified.
 *
 * The ticket is consumed here, in the guard, rather than in the handler. If the
 * handler were the one to spend it, a request rejected by the throttler or any
 * later guard would leave a live ticket behind for its full TTL.
 */
@Injectable()
export class SseTicketGuard implements CanActivate {
  constructor(
    private readonly tickets: SseTicketService,
    private readonly logger: AppLogger,
  ) {
    this.logger.setContext(SseTicketGuard.name);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // Express parses a repeated `?ticket=a&ticket=b` into an array. Take
    // nothing rather than the first element: a caller sending two is not a
    // client of ours, and "pick one and hope" is how parameter-pollution bugs
    // start.
    const raw = request.query?.ticket;
    const ticket = typeof raw === 'string' ? raw : null;

    if (!ticket) {
      throw new UnauthorizedException(
        'A stream ticket is required. POST /notifications/stream-ticket first.',
      );
    }

    const userId = await this.tickets.consume(ticket);

    if (!userId) {
      this.logger.warn(
        'Rejected an SSE connection with an invalid or spent ticket',
        {
          ip: request.ip,
        },
      );
      throw new UnauthorizedException(
        'This stream ticket is invalid or has already been used.',
      );
    }

    request.user = { sub: userId };
    return true;
  }
}
