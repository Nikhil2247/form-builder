import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, MemoryHealthIndicator, PrismaHealthIndicator } from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private prisma: PrismaHealthIndicator,
    private memory: MemoryHealthIndicator,
    private readonly prismaService: PrismaService,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.prisma.pingCheck('database', this.prismaService.reader as any),
      () => this.memory.checkHeap('memory_heap', 300 * 1024 * 1024), // 300MB limit for heap
      () => this.memory.checkRSS('memory_rss', 300 * 1024 * 1024),   // 300MB limit for RSS
      // In a real app we'd also add Redis check here
    ]);
  }
}
