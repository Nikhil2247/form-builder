import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { randomUUID } from 'crypto';

/**
 * Nest's own metadata key for `@Sse()`. Imported by value rather than from
 * `@nestjs/common/constants`, which is not part of the published typings.
 */
const SSE_METADATA = '__sse__';

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, any> {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<any> {
    // ── Server-Sent Events are not a response to be enveloped ────────────────
    // An @Sse() handler returns a long-lived Observable of MessageEvent, and
    // Nest subscribes to whatever this interceptor hands back, writing one SSE
    // frame per emission. Enveloping each one wraps it as
    // `{ data: <MessageEvent>, meta: … }`, which SseStream then reads for its
    // own `data`/`type`/`id` fields and finds only `data` — so every frame goes
    // out double-wrapped as `data: {"data":…}` and the `event:` line vanishes,
    // meaning `EventSource` dispatches every message, heartbeats included, as a
    // generic `message`. The envelope exists to give REST callers one shape;
    // a stream is not one of those callers.
    if (
      this.reflector.get<boolean | undefined>(
        SSE_METADATA,
        context.getHandler(),
      )
    ) {
      return next.handle();
    }

    const req = context.switchToHttp().getRequest();
    // Retrieve the request ID set by the HttpLoggingInterceptor, or fallback
    const requestId = req.headers['x-request-id'] || randomUUID();

    return next.handle().pipe(
      map((data: any) => {
        let responseData = data;
        let paginationMeta = {};

        // Detect prisma-extension-pagination tuple format: [ results, meta ]
        // The meta object from that library always contains an isLastPage boolean.
        if (
          Array.isArray(data) &&
          data.length === 2 &&
          data[1] &&
          typeof data[1] === 'object' &&
          'isLastPage' in data[1]
        ) {
          responseData = data[0];
          paginationMeta = data[1];
        }
        // Detect custom paginated format { data: [...], meta: {...} }
        else if (
          data &&
          typeof data === 'object' &&
          'data' in data &&
          'meta' in data
        ) {
          responseData = data.data;
          paginationMeta = data.meta;
        }

        return {
          data: responseData,
          meta: {
            ...paginationMeta,
            requestId,
            timestamp: new Date().toISOString(),
          },
        };
      }),
    );
  }
}
