import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { AppLogger } from '../logger/app-logger.service';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: Redis;

  constructor(private readonly logger: AppLogger) {
    this.logger.setContext(RedisService.name);
  }

  onModuleInit() {
    this.client = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: null, // Required by BullMQ
      lazyConnect: false,
      retryStrategy(times) {
        // Exponential backoff retry strategy with a maximum delay of 5000ms
        const delay = Math.min(times * 500, 5000);
        return delay;
      },
    });

    this.client.on('connect', () => this.logger.info('Redis connected.'));
    this.client.on('reconnecting', (time: number) => this.logger.warn(`Redis reconnecting (delay ${time}ms)...`));
    this.client.on('error', (err) => this.logger.error('Redis connection error', err));
  }

  async onModuleDestroy() {
    this.logger.info('Disconnecting Redis...');
    await this.client.quit();
  }

  getClient(): Redis { return this.client; }
  
  async get(key: string) { return this.client.get(key); }
  
  async set(key: string, value: string, ttlSeconds?: number) {
    ttlSeconds ? await this.client.set(key, value, 'EX', ttlSeconds) : await this.client.set(key, value);
  }
  
  async del(key: string) { await this.client.del(key); }
  
  async incr(key: string) { return this.client.incr(key); }
  
  async expire(key: string, ttlSeconds: number) { await this.client.expire(key, ttlSeconds); }

  async ping(): Promise<string> {
    return this.client.ping();
  }
}
