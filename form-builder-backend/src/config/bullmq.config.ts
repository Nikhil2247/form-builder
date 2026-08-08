import type { ConnectionOptions } from 'bullmq';
// Importing env first is load-bearing: it runs dotenv as a side effect, so
// REDIS_URL is populated before the line below reads it. Without this the
// value is resolved during import — before ConfigModule loads .env — and
// silently falls back to localhost.
import { getRedisUrl } from './env';

export const bullMQConnection: ConnectionOptions = {
  url: getRedisUrl(),
  maxRetriesPerRequest: null,
  lazyConnect: true,
};

export const defaultJobOptions = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 1000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: false,
};

export const QUEUE_NAMES = {
  SUBMISSIONS: 'submissions_queue',
  FILE_VERIFY: 'file_verify_queue',
  WEBHOOKS:    'webhooks_queue',
} as const;
