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

    // ── HTTP Exceptions (e.g. NotFoundException, BadRequestException) ────────
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const response = exception.getResponse();
      message = (response as any).message ?? exception.message;
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
      }
    } else if (status >= 400) {
      // Client errors (4xx) are logged as WARN, except 401 to reduce noise
      if (status !== HttpStatus.UNAUTHORIZED) {
        this.logger.warn(`Client Error [${status}]`, { path: req.url, message, exception });
      }
    }

    res.status(status).json({
      error: { statusCode: status, message, path: req.url },
      meta: { timestamp: new Date().toISOString() },
    });
  }
}
