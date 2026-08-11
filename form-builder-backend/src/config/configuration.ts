import * as Joi from 'joi';
import { getRedisUrl } from './env';

export const validationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(3000),
  DATABASE_URL: Joi.string().required(),
  DATABASE_REPLICA_URL: Joi.string().optional(),
  REDIS_URL: Joi.string().default('redis://localhost:6379'),
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_TTL_SECONDS: Joi.number().default(86_400),
  JWT_REFRESH_TTL_DAYS: Joi.number().default(1),
  STORAGE_PROVIDER: Joi.string().valid('minio', 's3').default('minio'),
  MINIO_ENDPOINT: Joi.string().default('localhost'),
  MINIO_PORT: Joi.number().default(9000),
  MINIO_USE_SSL: Joi.boolean().default(false),
  MINIO_ACCESS_KEY: Joi.string().required(),
  MINIO_SECRET_KEY: Joi.string().required(),
  MINIO_DEFAULT_BUCKET: Joi.string().default('formbuilder-uploads'),
  AWS_REGION: Joi.string().optional(),
  AWS_ACCESS_KEY_ID: Joi.string().optional(),
  AWS_SECRET_ACCESS_KEY: Joi.string().optional(),
  AWS_S3_BUCKET: Joi.string().optional(),
  MAX_FILE_SIZE_MB: Joi.number().default(25),
  PRESIGNED_URL_TTL_SECONDS: Joi.number().default(900),
  CORS_ORIGINS: Joi.string().default('http://localhost:3001'),
  CLOUDFLARE_TURNSTILE_SECRET: Joi.string().optional(),
  SMTP_HOST: Joi.string().optional(),
  SMTP_PORT: Joi.number().default(587),
  SMTP_USER: Joi.string().optional(),
  SMTP_PASS: Joi.string().optional(),
  SMTP_FROM: Joi.string().default('noreply@formbuilder.com'),
});

export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  database: {
    url: process.env.DATABASE_URL,
    replicaUrl: process.env.DATABASE_REPLICA_URL ?? process.env.DATABASE_URL,
  },
  // Single resolver, shared with the cache, throttler and BullMQ, so nothing
  // can end up pointed at a different server than the rest.
  redis: { url: getRedisUrl() },
  jwt: {
    secret: process.env.JWT_SECRET!,
    accessTtl: parseInt(process.env.JWT_ACCESS_TTL_SECONDS ?? '86400', 10),
    refreshTtlDays: parseInt(process.env.JWT_REFRESH_TTL_DAYS ?? '1', 10),
  },
  smtp: {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT ?? '587', 10),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM ?? 'noreply@formbuilder.com',
  },
  storage: {
    provider: process.env.STORAGE_PROVIDER ?? 'minio',
    maxFileSizeMb: parseInt(process.env.MAX_FILE_SIZE_MB ?? '25', 10),
    presignedUrlTtl: parseInt(process.env.PRESIGNED_URL_TTL_SECONDS ?? '900', 10),
    minio: {
      endpoint: process.env.MINIO_ENDPOINT ?? 'localhost',
      port: parseInt(process.env.MINIO_PORT ?? '9000', 10),
      useSSL: process.env.MINIO_USE_SSL === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY,
      secretKey: process.env.MINIO_SECRET_KEY,
      defaultBucket: process.env.MINIO_DEFAULT_BUCKET ?? 'formbuilder-uploads',
    },
    s3: {
      region: process.env.AWS_REGION,
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      bucket: process.env.AWS_S3_BUCKET,
    },
  },
  cors: { origins: (process.env.CORS_ORIGINS ?? 'http://localhost:3001').split(',') },
});
