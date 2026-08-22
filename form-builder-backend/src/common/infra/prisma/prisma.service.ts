import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { tenantScopeExtension } from '../../tenancy/tenant-scope.extension';
import { Pool } from 'pg';
import { AppLogger } from '../../observability/logger/app-logger.service';
import pagination from 'prisma-extension-pagination';

/**
 * Per-instance connection ceiling.
 *
 * This service creates TWO clients (writer + reader), so a pod holds at most
 * 2 * POOL_MAX connections. Size this against your Postgres/PgBouncer
 * max_connections divided by peak pod count — the previous setup leaked four
 * duplicate PrismaService instances per pod and could exhaust the server.
 */
const POOL_MAX = parseInt(process.env.DB_POOL_MAX ?? '10', 10);
const POOL_IDLE_TIMEOUT_MS = parseInt(
  process.env.DB_POOL_IDLE_TIMEOUT_MS ?? '30000',
  10,
);
const POOL_CONNECTION_TIMEOUT_MS = parseInt(
  process.env.DB_POOL_CONNECT_TIMEOUT_MS ?? '10000',
  10,
);

/**
 * Build a Prisma 7 client backed by an explicitly-configured pg driver adapter.
 *
 * PRISMA 7 MIGRATION NOTE:
 *  v7 removed the Rust query engine in favour of an in-process query compiler,
 *  and with it the `url`/`datasourceUrl` options. The connection now comes from
 *  a driver adapter, which is strictly better here: we get direct control over
 *  pool size, idle timeout, and statement timeout instead of the opaque
 *  `?connection_limit=` query parameter.
 */
/**
 * Slow-query logging threshold, in milliseconds. **Off by default.**
 *
 * Set `SLOW_QUERY_WARN_MS` to a positive number to turn it on (300 is a
 * sensible starting point when you are actually chasing a regression).
 *
 * Off is the right default for two reasons. It is noisy — the first query after
 * boot always trips it, because it pays for pool creation, TCP, TLS, and
 * Postgres auth, which has nothing to do with the query itself and reads as a
 * scary 4-second warning on a single indexed lookup. And it is not free:
 * enabling the threshold subscribes to Prisma's `query` event, which makes the
 * client serialise the SQL text and parameters of *every* query whether or not
 * it ends up being logged.
 */
const SLOW_QUERY_WARN_MS = parseInt(process.env.SLOW_QUERY_WARN_MS ?? '0', 10);
const SLOW_QUERY_LOGGING =
  Number.isFinite(SLOW_QUERY_WARN_MS) && SLOW_QUERY_WARN_MS > 0;

/**
 * Build the pg pool that backs a client.
 *
 * Split out from the adapter so the pool is OURS rather than one the adapter
 * creates and hides. `PrismaPg` accepts either a config object or a live
 * `pg.Pool`, and the two behave identically at runtime — but only the second
 * leaves us a handle on `totalCount`/`idleCount`/`waitingCount`, which is the
 * only pool-saturation signal available on Prisma 7. (The documented
 * `$metrics.json()` was a Rust query-engine feature and v7 removed the engine
 * along with it; the generated client here has no `$metrics` member at all.)
 * `disposeExternalPool` hands ownership back for shutdown, so `$disconnect()`
 * still ends the pool exactly as it did when the adapter owned it.
 */
function createPool(url: string, instanceName: string): Pool {
  return new Pool({
    connectionString: url,
    max: POOL_MAX,
    idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: POOL_CONNECTION_TIMEOUT_MS,
    // Belt-and-braces against a runaway query pinning a connection forever.
    statement_timeout: parseInt(
      process.env.DB_STATEMENT_TIMEOUT_MS ?? '30000',
      10,
    ),
    application_name: `formbuilder-${instanceName.toLowerCase()}`,
  });
}

function createExtendedClient(
  pool: Pool,
  logger: AppLogger,
  instanceName: string,
) {
  const isDev = process.env.NODE_ENV !== 'production';

  const logConfig: Prisma.LogDefinition[] = [
    { emit: 'event', level: 'error' },
    { emit: 'event', level: 'warn' },
    // Only subscribe to query events when someone has asked for them.
    ...(SLOW_QUERY_LOGGING ? [{ emit: 'event', level: 'query' } as const] : []),
    ...(isDev ? [{ emit: 'event', level: 'info' } as const] : []),
  ];

  const adapter = new PrismaPg(pool, {
    disposeExternalPool: true,
    // An idle client dying — a failover, a proxy closing the socket — emits
    // 'error' on the Pool. An EventEmitter 'error' with no listener throws, so
    // without this the process dies over something the pool recovers from on
    // its own by discarding the client.
    onPoolError: (err) =>
      logger.error(`[${instanceName}] idle pool client error`, err),
  });

  const client = new PrismaClient({ adapter, log: logConfig });

  if (SLOW_QUERY_LOGGING) {
    // Skip the very first query on this client. It carries the one-time cost of
    // opening the pool — TCP, TLS, and Postgres authentication — which can be
    // seconds against a managed database and says nothing about the query.
    let warmedUp = false;

    client.$on('query' as never, (e: Prisma.QueryEvent) => {
      if (!warmedUp) {
        warmedUp = true;
        return;
      }
      if (e.duration >= SLOW_QUERY_WARN_MS) {
        logger.warn(`[${instanceName}] Slow query (${e.duration}ms)`, {
          query: e.query.slice(0, 500),
          durationMs: e.duration,
        });
      }
    });
  }

  client.$on('error' as never, (e: Prisma.LogEvent) =>
    logger.error(`[${instanceName}] ${e.message}`),
  );
  client.$on('warn' as never, (e: Prisma.LogEvent) =>
    logger.warn(`[${instanceName}] ${e.message}`),
  );
  if (isDev) {
    client.$on('info' as never, (e: Prisma.LogEvent) =>
      logger.info(`[${instanceName}] ${e.message}`),
    );
  }

  return (
    client
      .$extends(
        pagination({
          pages: {
            limit: 20, // Default limit if not specified
            includePageCount: true,
          },
        }),
      )
      // Applied LAST, which in Prisma means it wraps OUTERMOST: a `query`
      // extension registered later sits above earlier ones in the pipeline. That
      // is the position this one wants — it sees `where` exactly as the calling
      // service wrote it, before pagination has folded in skip/take, so a
      // violation message names the predicate the author is looking at.
      //
      // See common/tenancy/tenant-scope.extension.ts for what it enforces and,
      // more importantly, what it deliberately does not.
      .$extends(
        tenantScopeExtension((message) =>
          logger.warn(`[${instanceName}] ${message}`),
        ),
      )
  );
}

export type ExtendedPrismaClient = ReturnType<typeof createExtendedClient>;

/** A point-in-time reading of one connection pool. Consumed by MetricsService. */
export interface PrismaPoolStats {
  client: 'writer' | 'reader';
  /** Connections currently open, idle or busy. */
  total: number;
  /** Open connections sitting unused. */
  idle: number;
  /** Queries blocked waiting for a free connection — the saturation signal. */
  waiting: number;
  /** Configured ceiling (DB_POOL_MAX). */
  max: number;
}

/**
 * PrismaService — two PrismaClient instances for read/write splitting.
 *   writer → PRIMARY db (all mutations)
 *   reader → READ REPLICA or same db in dev
 *
 * Also includes out-of-the-box pagination using .withPages()
 *
 * IMPORTANT: PrismaModule is @Global. Never list PrismaService in a feature
 * module's `providers` array — that creates a second instance and therefore two
 * more connection pools.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly writer: ExtendedPrismaClient;
  readonly reader: ExtendedPrismaClient;

  /** True when reader and writer point at the same database (no replica configured). */
  private readonly readerIsWriter: boolean;

  private readonly writerPool: Pool;
  private readonly readerPool: Pool;

  constructor(private readonly logger: AppLogger) {
    this.logger.setContext(PrismaService.name);

    const writerUrl = process.env.DATABASE_URL!;
    const readerUrl = process.env.DATABASE_REPLICA_URL ?? writerUrl;
    this.readerIsWriter = readerUrl === writerUrl;

    this.writerPool = createPool(writerUrl, 'Writer');
    this.readerPool = this.readerIsWriter
      ? this.writerPool
      : createPool(readerUrl, 'Reader');

    this.writer = createExtendedClient(this.writerPool, this.logger, 'Writer');
    this.reader = this.readerIsWriter
      ? this.writer
      : createExtendedClient(this.readerPool, this.logger, 'Reader');
  }

  /**
   * Live pool counters, for the Prometheus exporter.
   *
   * Reports one entry when reader and writer share a pool, so a deployment
   * without a replica does not publish a second, identical series under a
   * `reader` label that does not correspond to anything.
   */
  poolStats(): PrismaPoolStats[] {
    const read = (
      client: 'writer' | 'reader',
      pool: Pool,
    ): PrismaPoolStats => ({
      client,
      total: pool.totalCount,
      idle: pool.idleCount,
      waiting: pool.waitingCount,
      max: POOL_MAX,
    });

    return this.readerIsWriter
      ? [read('writer', this.writerPool)]
      : [read('writer', this.writerPool), read('reader', this.readerPool)];
  }

  async onModuleInit() {
    // Client extensions don't surface $connect on the extended type, so cast.
    await (this.writer as any).$connect();
    if (!this.readerIsWriter) await (this.reader as any).$connect();

    this.logger.info(
      this.readerIsWriter
        ? `PostgreSQL connected (single pool, max ${POOL_MAX}). No read replica configured.`
        : `PostgreSQL writer + reader connected (max ${POOL_MAX} each).`,
    );
  }

  async onModuleDestroy() {
    await (this.writer as any).$disconnect();
    if (!this.readerIsWriter) await (this.reader as any).$disconnect();
    this.logger.info('PostgreSQL connections closed.');
  }
}
