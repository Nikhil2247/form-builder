import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorService,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisHealthIndicator } from './indicators/redis.health';
import { QueueHealthIndicator } from './indicators/queue.health';
import { StorageHealthIndicator } from './indicators/storage.health';
import { getProcessRole } from '../../../config/runtime.config';

/**
 * Liveness and readiness, which are not the same question.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * There used to be one endpoint checking Postgres and memory, wired to whatever
 * probe happened to point at it. That conflation is a well-known way to turn a
 * dependency wobble into an outage: a liveness probe that checks dependencies
 * makes Kubernetes RESTART every replica when Redis hiccups, so the moment the
 * dependency comes back it is met by a fleet of cold pods reconnecting at once.
 * Meanwhile the pods were never the problem.
 *
 *   GET /v1/health/live   — is this process alive? No dependency is consulted,
 *                           so it cannot fail because something else is down.
 *                           Point `livenessProbe` here. It only goes unhealthy
 *                           when the event loop is wedged or the process is
 *                           gone, which is the only condition a restart fixes.
 *
 *   GET /v1/health/ready  — can this process serve traffic? Postgres, Redis,
 *                           the queues, object storage. Point `readinessProbe`
 *                           here: failing pulls the pod out of the Service
 *                           endpoints and nothing else, which is recoverable
 *                           and cheap.
 *                           Note what is NOT here: memory. See the comment at
 *                           the check list — it was, and it made readiness fail
 *                           on a healthy process.
 *
 *   GET /v1/health        — unchanged alias for readiness. Existing probes,
 *                           uptime monitors and the load balancer's own check
 *                           keep working.
 *
 * @SkipThrottle is load-bearing, not tidiness. The global limiter buckets by
 * client IP, and every probe on a node arrives from that node's address. Once
 * that bucket fills, probes get 429s — and a 429 on the liveness probe restarts
 * a perfectly healthy pod.
 */
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private prisma: PrismaHealthIndicator,
    private readonly prismaService: PrismaService,
    private readonly indicators: HealthIndicatorService,
    private readonly redis: RedisHealthIndicator,
    private readonly queues: QueueHealthIndicator,
    private readonly storage: StorageHealthIndicator,
  ) {}

  /**
   * Liveness. Deliberately trivial.
   *
   * It reports rather than checks: if the handler runs at all, the event loop
   * is turning and the process can accept a connection, which is the entire
   * question. Anything added here that can fail is a bug — including memory,
   * whose remedy is a restart only in the case of a genuine leak, and which
   * would otherwise restart-loop a pod that is merely busy.
   */
  @Get('live')
  @HealthCheck()
  live() {
    return this.health.check([
      () =>
        Promise.resolve(
          this.indicators.check('process').up({
            role: getProcessRole(),
            pid: process.pid,
            uptimeSeconds: Math.round(process.uptime()),
          }),
        ),
    ]);
  }

  /**
   * Readiness — every dependency required to serve a request.
   *
   * Terminus runs these concurrently and reports each one separately, so a
   * failing probe body names the dependency that is actually down instead of
   * just saying "error". Each dependency check carries its own deadline (see
   * indicators/deadline.ts) so the endpoint's worst case is bounded by the
   * slowest single check, not by their sum.
   */
  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([
      // reader, not writer: it is the pool that serves read traffic, and on a
      // deployment with a replica it is the one that can be down on its own.
      () => this.prisma.pingCheck('database', this.prismaService.reader as any),
      () => this.redis.isHealthy('redis'),
      () => this.queues.isHealthy('queues'),
      () => this.storage.isHealthy('storage'),

      // ── Memory is deliberately NOT a readiness signal ────────────────────────
      //
      // It used to be, and running the app is what showed why that is wrong: at
      // boot this process reported RSS of ~1.0 GB against a 300 MB threshold, so
      // /health/ready returned 503 while the database, Redis and all three
      // queues were up and the service was perfectly able to answer requests.
      //
      // In Kubernetes that is not a warning, it is an outage: a pod whose
      // readiness probe never passes is never added to the Service, so a deploy
      // rolls forward into zero healthy endpoints. And it fails at exactly the
      // wrong moment — under the load that pushes memory up, readiness drops,
      // traffic shifts to the remaining pods, their memory rises, and they drop
      // out too. A memory-based readiness probe is a cascading-failure amplifier.
      //
      // High memory is a real signal, but it is an ALERTING signal, not an
      // admission-control one. It is already exported as
      // `process_resident_memory_bytes` and `nodejs_heap_size_used_bytes` by
      // MetricsService; alert on those. Genuine exhaustion is handled where it
      // belongs — the container memory limit, which OOM-kills and restarts the
      // pod, and the liveness probe.
    ]);
  }

  /** Backwards-compatible alias. Anything already pointed at /health keeps working. */
  @Get()
  @HealthCheck()
  check() {
    return this.ready();
  }
}
