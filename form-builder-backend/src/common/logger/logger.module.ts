import { Module, Global } from '@nestjs/common';
import { WinstonModule } from 'nest-winston';
import { winstonModuleOptions } from './winston.config';
import { AppLogger } from './app-logger.service';
import { WinstonNestAdapter } from './winston-nest.adapter';

/**
 * LoggerModule
 * ══════════════════════════════════════════════════════════════════════════════
 * Global module that wires Winston into the NestJS DI container.
 * Marked @Global() so any module can inject AppLogger without importing LoggerModule.
 *
 * Exports:
 *  • AppLogger        — injectable context-aware logger for services
 *  • WinstonNestAdapter — used by main.ts to replace NestJS's default logger
 */
@Global()
@Module({
  imports: [
    WinstonModule.forRoot(winstonModuleOptions),
  ],
  providers: [
    AppLogger,
    WinstonNestAdapter,
  ],
  exports: [
    AppLogger,
    WinstonNestAdapter,
    WinstonModule,
  ],
})
export class LoggerModule {}
