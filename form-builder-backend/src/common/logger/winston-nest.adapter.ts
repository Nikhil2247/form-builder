import { LoggerService, Injectable, Inject } from '@nestjs/common';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger as WinstonLogger } from 'winston';

/**
 * WinstonNestAdapter
 * ══════════════════════════════════════════════════════════════════════════════
 * Bridges NestJS's built-in LoggerService interface to Winston.
 * Used in NestFactory.create() so that NestJS's own framework logs
 * (bootstrap messages, dependency injection, route mapping, etc.)
 * all flow through Winston instead of the default console logger.
 *
 * This means every log message in the application — framework + business logic —
 * uses the same format, same transports, same rotation, same JSON structure.
 *
 * USAGE (in main.ts):
 *   const app = await NestFactory.create(AppModule, {
 *     bufferLogs: true,
 *   });
 *   app.useLogger(app.get(WinstonNestAdapter));
 */
@Injectable()
export class WinstonNestAdapter implements LoggerService {
  constructor(@Inject(WINSTON_MODULE_PROVIDER) private readonly winston: WinstonLogger) {}

  log(message: any, context?: string) {
    this.winston.info(this.stringify(message), { context });
  }

  error(message: any, trace?: string, context?: string) {
    this.winston.error(this.stringify(message), { context, stack: trace });
  }

  warn(message: any, context?: string) {
    this.winston.warn(this.stringify(message), { context });
  }

  debug(message: any, context?: string) {
    this.winston.debug(this.stringify(message), { context });
  }

  verbose(message: any, context?: string) {
    this.winston.verbose(this.stringify(message), { context });
  }

  fatal(message: any, context?: string) {
    this.winston.error(this.stringify(message), { context, fatal: true });
  }

  private stringify(message: any): string {
    if (typeof message === 'string') return message;
    try { return JSON.stringify(message); } catch { return String(message); }
  }
}
