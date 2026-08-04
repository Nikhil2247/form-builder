import type { ConnectionOptions } from 'bullmq';

export const bullMQConnection: ConnectionOptions = {
  url: process.env.REDIS_URL ?? 'redis://localhost:6379',
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
