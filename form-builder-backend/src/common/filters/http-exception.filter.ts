import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppLogger } from '../logger/app-logger.service';

/**
 * Column names as the user knows them. Anything not listed falls back to a
 * message that names no column at all — better to be vague than to leak the
 * schema to whoever can provoke a duplicate.
 */
const UNIQUE_FIELD_LABELS: Record<string, string> = {
  email: 'email address',
  slug: 'URL',
  public_slug: 'public link',
  value: 'option value',
  key: 'key',
  external_id: 'external ID',
  token: 'token',
  object_key: 'file',
};

/**
 * Turn a P2002 `meta.target` into a sentence.
 *
 * `target` is the conflicting column list — `['email']`, or for a composite
 * constraint `['organization_id', 'slug']`. Tenant-scoping columns are dropped
 * because "organization" is not something the user chose or can change; what
 * they need to hear is which of THEIR values collided.
 */
const SCOPE_COLUMNS = new Set([
  'organization_id',
  'form_id',
  'list_id',
  'app_id',
  'session_id',
  'subject_type_id',
]);

function uniqueConstraintMessage(target: unknown): string {
  const columns = Array.isArray(target)
    ? target.filter((c): c is string => typeof c === 'string')
    : typeof target === 'string'
      ? [target]
      : [];

  const meaningful = columns.filter((c) => !SCOPE_COLUMNS.has(c));
  const labels = meaningful.map((c) => UNIQUE_FIELD_LABELS[c]).filter(Boolean);

  if (labels.length === 0) {
    return 'That already exists. Try a different value.';
  }
  if (labels.length === 1) {
    return `That ${labels[0]} is already in use. Try a different one.`;
  }
  return `That combination of ${labels.join(' and ')} is already in use.`;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: AppLogger) {
    this.logger.setContext(HttpExceptionFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();
    const req = ctx.getRequest();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | object = 'Internal server error';

    /**
     * Structured detail the thrower attached alongside `message`.
     *
     * Three call sites throw `{ message, issues }` — a rejected submission, a
     * rejected app-session submit, and a publish blocked by rule errors — and
     * every one of them had its `issues` array dropped here, because only
     * `message` was read off the response. The respondent was told "some
     * answers are invalid" and never which ones, while the browser held a
     * perfectly good renderer for exactly that list. Anything the thrower put
     * on the response object other than the envelope's own keys is carried
     * through; nothing is invented here.
     */
    let detail: Record<string, unknown> = {};

    // ── HTTP Exceptions (e.g. NotFoundException, BadRequestException) ────────
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const response = exception.getResponse();
      message = (response as any).message ?? exception.message;

      if (response && typeof response === 'object' && !Array.isArray(response)) {
        for (const [key, value] of Object.entries(response as Record<string, unknown>)) {
          if (key === 'message' || key === 'statusCode' || key === 'error') continue;
          detail[key] = value;
        }
      }
    }
    // ── Prisma Error Translation ──────────────────────────────────────────────
    //
    // Two things were wrong with sending these through verbatim. A P2002 read
    // "Unique constraint failed on the fields: organization_id, slug" — which
    // names our columns to anyone who can trigger it, and means nothing to the
    // person who just typed a duplicate URL. And every other Prisma code became
    // "Database error: P2010", a 400 that told the user nothing and told us
    // nothing either, because it was never logged.
    else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002': // Unique constraint failed
          status = HttpStatus.CONFLICT;
          message = uniqueConstraintMessage((exception.meta as any)?.target);
          break;
        case 'P2025': // Record to update not found
          status = HttpStatus.NOT_FOUND;
          message = 'That item no longer exists. It may have been deleted.';
          break;
        case 'P2003': // Foreign key constraint failed
          status = HttpStatus.CONFLICT;
          message =
            'That item is still referenced by something else and cannot be changed yet.';
          break;
        case 'P2000': // Value too long for column
          status = HttpStatus.BAD_REQUEST;
          message = 'One of the values you entered is too long.';
          break;
        default:
          // The user gets a generic sentence; we get the code and meta in the
          // logs, which is the half that actually helps diagnose it.
          status = HttpStatus.BAD_REQUEST;
          message = 'We could not process that request. Please check your input and try again.';
          this.logger.warn(`Unmapped Prisma error [${exception.code}]`, {
            path: req.url,
            code: exception.code,
            meta: exception.meta,
          });
      }
    }
    // ── Generic Errors ────────────────────────────────────────────────────────
    else if (exception instanceof Error) {
      message = exception.message;
    }

    // ── Production Sanitization & Logging ─────────────────────────────────────
    const isProd = process.env.NODE_ENV === 'production';
    
    if (status === HttpStatus.INTERNAL_SERVER_ERROR) {
      // 500s are actual bugs. Log full stack trace as ERROR.
      this.logger.error('Unhandled Exception', exception, { path: req.url });
      
      if (isProd) {
        // Hide internal error details from the client in production
        message = 'Internal server error';
        // A 500 carries no deliberate payload — anything here came from an
        // exception we did not shape, so it does not go out.
        detail = {};
      }
    } else if (status >= 400) {
      // Client errors (4xx) are logged as WARN, except 401 to reduce noise
      if (status !== HttpStatus.UNAUTHORIZED) {
        this.logger.warn(`Client Error [${status}]`, { path: req.url, message, exception });
      }
    }

    res.status(status).json({
      error: { statusCode: status, message, ...detail, path: req.url },
      meta: { timestamp: new Date().toISOString() },
    });
  }
}
