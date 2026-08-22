import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../../common/infra/prisma/prisma.service';
import { RedisService } from '../../../common/infra/redis/redis.service';
import { QUEUE_NAMES } from '../../../config/bullmq.config';
import { createStorageClient } from '../../../config/storage.config';

/**
 * Platform health and infrastructure statistics.
 *
 * Distinct from /health, which exists for load balancers and answers one
 * question — "should traffic come here?" — in as few milliseconds as possible.
 * This is for a human deciding what is wrong, so it probes each dependency
 * individually, times it, and reports partial failure instead of collapsing
 * everything into a single up/down.
 *
 * NOTHING HERE THROWS. An operator opens this page precisely when something is
 * broken; a 500 because Redis is down would withhold the diagnosis at the exact
 * moment it is needed. Every probe resolves to a status object.
 */

export type ProbeStatus = 'up' | 'degraded' | 'down';

export interface DependencyProbe {
  name: string;
  status: ProbeStatus;
  /** Round-trip in milliseconds; null when the probe never completed. */
  latencyMs: number | null;
  detail?: string;
  error?: string;
}

/** Slower than this and the dependency is working but not healthy. */
const DEGRADED_MS = 500;
const PROBE_TIMEOUT_MS = 5_000;

/** Bound every probe, so one hung socket cannot hang the whole page. */
async function withTimeout<T>(
  operation: Promise<T>,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(`${label} did not respond within ${PROBE_TIMEOUT_MS}ms`),
        ),
      PROBE_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

async function probe(
  name: string,
  run: () => Promise<string | undefined>,
): Promise<DependencyProbe> {
  const startedAt = Date.now();
  try {
    const detail = await withTimeout(run(), name);
    const latencyMs = Date.now() - startedAt;
    return {
      name,
      status: latencyMs > DEGRADED_MS ? 'degraded' : 'up',
      latencyMs,
      detail,
    };
  } catch (error) {
    return {
      name,
      status: 'down',
      latencyMs: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

@Injectable()
export class SystemService {
  private readonly logger = new Logger(SystemService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @InjectQueue(QUEUE_NAMES.SUBMISSIONS)
    private readonly submissionsQueue: Queue,
    @InjectQueue(QUEUE_NAMES.WEBHOOKS) private readonly webhooksQueue: Queue,
    @InjectQueue(QUEUE_NAMES.FILE_VERIFY)
    private readonly fileVerifyQueue: Queue,
  ) {}

  /** Live dependency probes, run in parallel. */
  async getHealth() {
    const [database, replica, redis, storage] = await Promise.all([
      probe('PostgreSQL (primary)', async () => {
        await this.prisma.writer.$queryRaw`SELECT 1`;
        return 'Accepting writes';
      }),
      probe('PostgreSQL (reader)', async () => {
        const rows = await this.prisma.reader.$queryRaw<
          Array<{ replica: boolean }>
        >`SELECT pg_is_in_recovery() AS replica`;
        // Reader and writer share a connection unless DATABASE_REPLICA_URL is
        // set, so say which it is rather than implying a replica exists.
        return rows[0]?.replica
          ? 'Streaming replica'
          : 'Same server as primary';
      }),
      probe('Redis', async () => {
        const pong = await this.redis.ping();
        return pong === 'PONG'
          ? 'Responding to PING'
          : `Unexpected reply: ${pong}`;
      }),
      probe('Object storage', async () => {
        const storageClient = createStorageClient();
        if (storageClient.type === 's3') {
          // A HEAD on the bucket is the cheapest proof of both reachability
          // and credentials.
          const { HeadBucketCommand } = await import('@aws-sdk/client-s3');
          await storageClient.client.send(
            new HeadBucketCommand({ Bucket: storageClient.bucket }),
          );
          return `S3 bucket "${storageClient.bucket}"`;
        }
        const exists = await storageClient.client.bucketExists(
          storageClient.bucket,
        );
        if (!exists)
          throw new Error(`Bucket "${storageClient.bucket}" does not exist`);
        return `MinIO bucket "${storageClient.bucket}"`;
      }),
    ]);

    const dependencies = [database, replica, redis, storage];

    // Worst-case wins: one hard failure makes the platform "down" even if
    // everything else is fine, because that is what an operator needs to see.
    const overall: ProbeStatus = dependencies.some((d) => d.status === 'down')
      ? 'down'
      : dependencies.some((d) => d.status === 'degraded')
        ? 'degraded'
        : 'up';

    return {
      status: overall,
      checkedAt: new Date().toISOString(),
      dependencies,
    };
  }

  /** Process and runtime facts about the pod serving this request. */
  getProcessStats() {
    const memory = process.memoryUsage();
    const toMb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10;

    return {
      // In a multi-pod deployment this describes ONE pod — whichever answered.
      // Aggregate numbers need a metrics backend, not an API call.
      nodeVersion: process.version,
      platform: `${process.platform} ${process.arch}`,
      pid: process.pid,
      processRole: process.env.PROCESS_ROLE ?? 'api',
      environment: process.env.NODE_ENV ?? 'development',
      uptimeSeconds: Math.floor(process.uptime()),
      memory: {
        heapUsedMb: toMb(memory.heapUsed),
        heapTotalMb: toMb(memory.heapTotal),
        rssMb: toMb(memory.rss),
        externalMb: toMb(memory.external),
      },
    };
  }

  /**
   * Queue depths.
   *
   * `failed` is the number worth watching: BullMQ is configured with
   * removeOnFail: false, so failures accumulate until someone looks.
   */
  async getQueueStats() {
    const queues: Array<{ name: string; queue: Queue }> = [
      { name: 'Submissions', queue: this.submissionsQueue },
      { name: 'Webhooks', queue: this.webhooksQueue },
      { name: 'File verification', queue: this.fileVerifyQueue },
    ];

    const stats = await Promise.all(
      queues.map(async ({ name, queue }) => {
        try {
          // `paused` is a queue-level flag in BullMQ 6, not a job state, so it
          // comes from isPaused() rather than the counts.
          const [counts, isPaused] = await withTimeout(
            Promise.all([
              queue.getJobCounts(
                'waiting',
                'active',
                'completed',
                'failed',
                'delayed',
              ),
              queue.isPaused(),
            ]),
            `${name} queue`,
          );
          return {
            name,
            reachable: true,
            waiting: counts.waiting ?? 0,
            active: counts.active ?? 0,
            completed: counts.completed ?? 0,
            failed: counts.failed ?? 0,
            delayed: counts.delayed ?? 0,
            paused: isPaused,
          };
        } catch (error) {
          // Queue counts live in Redis. If Redis is down this is the second
          // place it shows, and reporting zeroes would look like an idle queue.
          this.logger.warn(`Could not read ${name} queue counts`, error);
          return {
            name,
            reachable: false,
            waiting: 0,
            active: 0,
            completed: 0,
            failed: 0,
            delayed: 0,
            paused: false,
          };
        }
      }),
    );

    return { queues: stats };
  }

  /**
   * Database size and row counts for the biggest tables.
   *
   * Uses the planner's row ESTIMATES (pg_class.reltuples), not COUNT(*).
   * Counting form_submissions exactly means a sequential scan of the largest
   * table in the schema every time an admin opens this page.
   */
  async getDatabaseStats() {
    try {
      const [sizeRows, tableRows, connectionRows] = await Promise.all([
        this.prisma.reader.$queryRaw<Array<{ size: string; bytes: bigint }>>`
          SELECT pg_size_pretty(pg_database_size(current_database())) AS size,
                 pg_database_size(current_database()) AS bytes
        `,
        this.prisma.reader.$queryRaw<
          Array<{
            table_name: string;
            estimated_rows: bigint;
            total_size: string;
          }>
        >`
          SELECT c.relname AS table_name,
                 GREATEST(c.reltuples, 0)::bigint AS estimated_rows,
                 pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r'
          ORDER BY pg_total_relation_size(c.oid) DESC
          LIMIT 12
        `,
        this.prisma.reader.$queryRaw<
          Array<{ total: bigint; active: bigint; idle: bigint }>
        >`
          SELECT count(*)::bigint AS total,
                 count(*) FILTER (WHERE state = 'active')::bigint AS active,
                 count(*) FILTER (WHERE state = 'idle')::bigint AS idle
          FROM pg_stat_activity
          WHERE datname = current_database()
        `,
      ]);

      const connections = connectionRows[0];

      return {
        reachable: true,
        size: sizeRows[0]?.size ?? 'unknown',
        sizeBytes: Number(sizeRows[0]?.bytes ?? 0),
        connections: {
          total: Number(connections?.total ?? 0),
          active: Number(connections?.active ?? 0),
          idle: Number(connections?.idle ?? 0),
        },
        tables: tableRows.map((row) => ({
          name: row.table_name,
          estimatedRows: Number(row.estimated_rows),
          size: row.total_size,
        })),
      };
    } catch (error) {
      this.logger.warn('Could not read database statistics', error);
      return {
        reachable: false,
        size: 'unknown',
        sizeBytes: 0,
        connections: { total: 0, active: 0, idle: 0 },
        tables: [] as Array<{
          name: string;
          estimatedRows: number;
          size: string;
        }>,
      };
    }
  }

  /** Redis memory, clients and hit rate, parsed out of INFO. */
  async getRedisStats() {
    try {
      const raw = await withTimeout(
        this.redis.getClient().info(),
        'Redis INFO',
      );
      const info = parseRedisInfo(raw);

      const hits = Number(info.keyspace_hits ?? 0);
      const misses = Number(info.keyspace_misses ?? 0);
      const lookups = hits + misses;

      return {
        reachable: true,
        version: info.redis_version ?? 'unknown',
        usedMemory: info.used_memory_human ?? 'unknown',
        peakMemory: info.used_memory_peak_human ?? 'unknown',
        connectedClients: Number(info.connected_clients ?? 0),
        uptimeSeconds: Number(info.uptime_in_seconds ?? 0),
        opsPerSecond: Number(info.instantaneous_ops_per_sec ?? 0),
        // Null rather than 0% on a cold instance — "no lookups yet" and
        // "every lookup missed" are very different situations.
        hitRate: lookups > 0 ? Math.round((hits / lookups) * 1000) / 10 : null,
      };
    } catch (error) {
      this.logger.warn('Could not read Redis statistics', error);
      return {
        reachable: false,
        version: 'unknown',
        usedMemory: 'unknown',
        peakMemory: 'unknown',
        connectedClients: 0,
        uptimeSeconds: 0,
        opsPerSecond: 0,
        hitRate: null as number | null,
      };
    }
  }

  /** Everything the system page needs, in one round trip. */
  async getOverview() {
    const [health, queues, database, redis] = await Promise.all([
      this.getHealth(),
      this.getQueueStats(),
      this.getDatabaseStats(),
      this.getRedisStats(),
    ]);

    return {
      health,
      process: this.getProcessStats(),
      queues: queues.queues,
      database,
      redis,
    };
  }
}

/** INFO returns `key:value` lines grouped under `# Section` headers. */
function parseRedisInfo(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    result[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return result;
}
