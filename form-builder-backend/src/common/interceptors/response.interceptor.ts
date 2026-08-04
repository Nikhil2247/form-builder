import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { randomUUID } from 'crypto';

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, any> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<any> {
    const req = context.switchToHttp().getRequest();
    // Retrieve the request ID set by the HttpLoggingInterceptor, or fallback
    const requestId = req.headers['x-request-id'] || randomUUID();

    return next.handle().pipe(
      map((data: any) => {
        let responseData = data;
        let paginationMeta = {};

        // Detect prisma-extension-pagination tuple format: [ results, meta ]
        // The meta object from that library always contains an isLastPage boolean.
        if (Array.isArray(data) && data.length === 2 && data[1] && typeof data[1] === 'object' && 'isLastPage' in data[1]) {
          responseData = data[0];
          paginationMeta = data[1];
        } 
        // Detect custom paginated format { data: [...], meta: {...} }
        else if (data && typeof data === 'object' && 'data' in data && 'meta' in data) {
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
