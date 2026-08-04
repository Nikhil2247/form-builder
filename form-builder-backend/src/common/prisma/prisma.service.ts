import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { AppLogger } from '../logger/app-logger.service';
import pagination from 'prisma-extension-pagination';

/**
 * Helper to create a Prisma client with logging events attached and 
 * the pagination extension applied.
 */
function createExtendedClient(url: string, logger: AppLogger, instanceName: string) {
  const isDev = process.env.NODE_ENV !== 'production';

  // In production, only emit errors and warnings (no query-level events).
  // In development, emit all events for debugging.
  const logConfig: Prisma.LogDefinition[] = isDev
    ? [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'info' },
        { emit: 'event', level: 'warn' },
      ]
    : [
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
      ];

  const client = new PrismaClient({
    datasourceUrl: url,
    log: logConfig,
  });

  // Query-level logging only in development (or slow queries logged at warn in all envs)
  if (isDev) {
    client.$on('query' as never, (e: Prisma.QueryEvent) => {
      // Intentionally removed slow query warning to reduce noise per user request
    });
  }

  client.$on('error' as never, (e: Prisma.LogEvent) => logger.error(`[${instanceName}] ${e.message}`));
  client.$on('warn' as never, (e: Prisma.LogEvent) => logger.warn(`[${instanceName}] ${e.message}`));
  if (isDev) {
    client.$on('info' as never, (e: Prisma.LogEvent) => logger.info(`[${instanceName}] ${e.message}`));
  }

  return client.$extends(
    pagination({
      pages: {
        limit: 20, // Default limit if not specified
        includePageCount: true,
      },
    })
  );
}

export type ExtendedPrismaClient = ReturnType<typeof createExtendedClient>;

/**
 * PrismaService — two PrismaClient instances for read/write splitting.
 *   writer → PRIMARY db (all mutations)
 *   reader → READ REPLICA or same db in dev
 * 
 * Also includes out-of-the-box pagination using .withPages()
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly writer: ExtendedPrismaClient;
  readonly reader: ExtendedPrismaClient;

  constructor(private readonly logger: AppLogger) {
    this.logger.setContext(PrismaService.name);
    
    this.writer = createExtendedClient(
      process.env.DATABASE_URL!, 
      this.logger, 
      'Writer'
    );
    
    this.reader = createExtendedClient(
      process.env.DATABASE_REPLICA_URL ?? process.env.DATABASE_URL!, 
      this.logger, 
      'Reader'
    );
  }

  async onModuleInit() {
    // Note: client extensions don't expose $connect natively on the type, so we cast to any
    await (this.writer as any).$connect();
    await (this.reader as any).$connect();
    this.logger.info('PostgreSQL writer + reader connected.');
  }

  async onModuleDestroy() {
    await (this.writer as any).$disconnect();
    await (this.reader as any).$disconnect();
    this.logger.info('PostgreSQL connections closed.');
  }
}
