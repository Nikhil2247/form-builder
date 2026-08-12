import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { Response } from 'express';

/**
 * Default every response to `Cache-Control: no-store`.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Neither helmet nor Nest sets Cache-Control, so authenticated responses — a
 * submission grid, an org's member list, a user's profile — went out with no
 * caching directive at all. RFC 9111 lets a shared cache store and reuse a
 * directive-less 200 GET on its own heuristics, so any intervening proxy, or a
 * CDN put in front of the API later, is free to keep one tenant's data and hand
 * it to the next request for the same URL. Absence of a header is not a
 * prohibition, and this API's URLs are not user-specific: two members of the
 * same org GET the identical path.
 *
 * ── Why a default rather than a decorator per route ────────────────────────
 * The safe direction is opt-in publicity. The three endpoints that genuinely
 * want caching — `GET /public-forms/:slug`, its choice-items, and
 * `GET /public-apps/:publicSlug` — already declare it with `@Header(...)`, and
 * Nest applies those before the handler runs. This only fills in a value where
 * nothing set one, so a route becomes cacheable by saying so, never by
 * omission.
 */
@Injectable()
export class CacheControlInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const res = context.switchToHttp().getResponse<Response>();
    const apply = () => {
      // A streaming handler (the submissions export) has already flushed its
      // head by the time this runs; setting a header then throws.
      if (res.headersSent) return;
      if (!res.getHeader('Cache-Control')) {
        res.setHeader('Cache-Control', 'no-store');
      }
    };

    // Errors need the header too — a 403 or a 404 body is as tenant-specific as
    // a 200, and `tap`'s error channel is the only place to catch that before
    // the exception filter writes.
    return next.handle().pipe(tap({ next: apply, error: apply }));
  }
}
