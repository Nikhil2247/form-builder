import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppLogger } from '../logger/app-logger.service';

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
    else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002': // Unique constraint failed
          status = HttpStatus.CONFLICT;
          message = `Unique constraint failed on the fields: ${(exception.meta as any)?.target?.join(', ') ?? 'unknown'}`;
          break;
        case 'P2025': // Record to update not found
          status = HttpStatus.NOT_FOUND;
          message = 'Record not found';
          break;
        default:
          status = HttpStatus.BAD_REQUEST;
          message = `Database error: ${exception.code}`;
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
