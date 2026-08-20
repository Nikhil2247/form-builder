import * as Minio from 'minio';
import { S3Client } from '@aws-sdk/client-s3';

export type StorageClientWrapper =
  | { type: 'minio'; client: Minio.Client; bucket: string }
  | { type: 's3'; client: S3Client; bucket: string };

/**
 * `minio-js` rejects an `endPoint` containing a scheme ("Invalid endPoint")
 * because it takes the scheme separately, via `useSSL`. MINIO_ENDPOINT has
 * been set to a full URL (e.g. `https://files.example.com`) in at least one
 * deployment, which turns into a hard "Down" on the storage health probe with
 * credentials and connectivity both fine. Stripping the scheme here — and
 * honouring it for `useSSL` when MINIO_USE_SSL was not set explicitly — means
 * a full URL and a bare host both work, instead of failing in a way that
 * looks identical to the endpoint being unreachable.
 */
function parseMinioEndpoint(): { host: string; useSSL: boolean } {
  const raw = process.env.MINIO_ENDPOINT ?? 'localhost';
  const match = raw.match(/^(https?):\/\/(.+)$/i);

  if (!match) {
    return {
      host: raw,
      useSSL: process.env.MINIO_USE_SSL === 'true',
    };
  }

  const [, scheme, host] = match;
  return {
    host: host.replace(/\/+$/, ''),
    useSSL:
      process.env.MINIO_USE_SSL !== undefined
        ? process.env.MINIO_USE_SSL === 'true'
        : scheme.toLowerCase() === 'https',
  };
}

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
  const { host, useSSL } = parseMinioEndpoint();
  return {
    type: 'minio',
    bucket: process.env.MINIO_DEFAULT_BUCKET ?? 'formbuilder-uploads',
    client: new Minio.Client({
      endPoint: host,
      port: parseInt(process.env.MINIO_PORT ?? '9000', 10),
      useSSL,
      accessKey: process.env.MINIO_ACCESS_KEY!,
      secretKey: process.env.MINIO_SECRET_KEY!,
    }),
  };
}
