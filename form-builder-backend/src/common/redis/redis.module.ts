import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';

/**
 * RedisModule
 * ══════════════════════════════════════════════════════════════════════════════
 * Global module exposing a SINGLE shared ioredis connection.
 *
 * WHY @Global: RedisService opens a real TCP connection in onModuleInit. If it
 * is listed in the `providers` array of individual feature modules, Nest builds
 * a separate instance per module — each with its own socket. Registering it once
 * here and importing nothing keeps exactly one connection per process.
 */
@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
