import * as Minio from 'minio';
import { S3Client } from '@aws-sdk/client-s3';

export type StorageClientWrapper =
  | { type: 'minio'; client: Minio.Client; bucket: string }
  | { type: 's3'; client: S3Client; bucket: string };

export function createStorageClient(): StorageClientWrapper {
  if (process.env.STORAGE_PROVIDER === 's3') {
    return {
      type: 's3',
      bucket: process.env.AWS_S3_BUCKET!,
      client: new S3Client({
        region: process.env.AWS_REGION!,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        },
      }),
    };
  }

  // Default: MinIO (self-hosted, S3-compatible)
  return {
    type: 'minio',
    bucket: process.env.MINIO_DEFAULT_BUCKET ?? 'formbuilder-uploads',
    client: new Minio.Client({
      endPoint: process.env.MINIO_ENDPOINT ?? 'localhost',
      port: parseInt(process.env.MINIO_PORT ?? '9000', 10),
      useSSL: process.env.MINIO_USE_SSL === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY!,
      secretKey: process.env.MINIO_SECRET_KEY!,
    }),
  };
}
