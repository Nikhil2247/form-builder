import { S3Client } from '@aws-sdk/client-s3';

export const s3Client = new S3Client({
  endpoint: process.env.MINIO_ENDPOINT || 'http://localhost:9000',
  region: process.env.MINIO_REGION || 'us-east-1', // MinIO requires a region, even if dummy
  credentials: {
    accessKeyId: process.env.MINIO_ACCESS_KEY || 'minioadmin',
    secretAccessKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
  },
  forcePathStyle: true, // Required for MinIO
});

export const BUCKET_NAME = process.env.MINIO_BUCKET || 'form-uploads';
