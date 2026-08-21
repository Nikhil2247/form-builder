import { FaqCacheService } from './faq-cache.service';
import type { RedisService } from '../../common/redis/redis.service';

/**
 * No live Redis in this environment (see other Phase notes) — this is a real
 * unit test against a fake in-memory client rather than a structural
 * source-scan, since FaqCacheService has no Nest DI graph worth avoiding.
 * Guards the one thing that would make the platform-wide cache (§6 decision
 * 4) unsafe: a key collision or a miss that should have been a hit.
 */
describe('FaqCacheService', () => {
  function makeService() {
    const store = new Map<string, string>();
    const redis = {
      get: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
      set: jest.fn((key: string, value: string) => {
        store.set(key, value);
        return Promise.resolve();
      }),
    } as unknown as RedisService;
    return { service: new FaqCacheService(redis), redis };
  }

  it('normalizes case and surrounding whitespace to the same key', () => {
    const { service } = makeService();
    const a = service.buildKey('How do I add a required field?', 'help');
    const b = service.buildKey('  how do i add a required field?  ', 'help');
    expect(a).toBe(b);
  });

  it('gives a different key for a different mode hint, so Help and Insights never share an answer', () => {
    const { service } = makeService();
    const a = service.buildKey('how do I add a required field?', 'help');
    const b = service.buildKey('how do I add a required field?', 'insights');
    expect(a).not.toBe(b);
  });

  it('gives a different key for a different question', () => {
    const { service } = makeService();
    const a = service.buildKey('how do I add a required field?', undefined);
    const b = service.buildKey('how do I delete a form?', undefined);
    expect(a).not.toBe(b);
  });

  it('round-trips through the underlying redis client with a 7-day TTL', async () => {
    const { service, redis } = makeService();
    const key = service.buildKey('a question', undefined);

    await expect(service.get(key)).resolves.toBeNull();
    await service.set(key, 'the cached answer');

    expect(redis.set).toHaveBeenCalledWith(
      key,
      'the cached answer',
      60 * 60 * 24 * 7,
    );
    await expect(service.get(key)).resolves.toBe('the cached answer');
  });
});
