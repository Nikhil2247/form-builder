import { Readable } from 'node:stream';
import { Upload } from '@aws-sdk/lib-storage';
import { DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createStorageClient } from '../../../config/storage.config';

/**
 * Object-storage side of an export.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * THE ONE RULE HERE: the file is never fully in memory.
 *
 * The obvious implementation — collect the generator's chunks into a string,
 * `Buffer.from` it, `putObject` the buffer — passes every test on a fixture and
 * kills the worker on the first real export. A 200 000-row CSV is a couple of
 * hundred megabytes, held as a JS string (UTF-16, so double) *and* as a Buffer
 * during the copy. That is the exact failure mode the streaming generator was
 * written to remove from the API; reintroducing it in the worker would move the
 * problem rather than fix it.
 *
 * So both providers get a multipart/streaming upload, which reads the source at
 * the rate the network drains it and holds one part in flight:
 *
 *  • MinIO — `putObject` with a Readable and NO size argument. Given a stream of
 *    unknown length the client switches to multipart and uploads part by part.
 *    Passing a size would force it to buffer to verify the length, which is
 *    precisely what must not happen.
 *
 *  • S3 — `@aws-sdk/lib-storage`'s `Upload`. The plain `PutObjectCommand`
 *    requires `Content-Length` up front for a stream body, which an unfinished
 *    export does not have. `Upload` does CreateMultipartUpload / UploadPart /
 *    Complete, and — importantly — aborts the multipart upload if the source
 *    throws, so a failed export does not leave paid-for orphan parts behind.
 */

export interface UploadedExport {
  bucket: string;
  provider: 'MINIO' | 'S3';
}

/**
 * Part size for the S3 multipart upload.
 *
 * 8 MiB with a queue of 2 means the worker's steady-state footprint for the
 * upload is ~16 MiB regardless of how large the export turns out to be. S3's
 * 10 000-part ceiling puts the maximum file at 80 GB, which is far beyond any
 * plausible export of a form's responses.
 */
const S3_PART_SIZE_BYTES = 8 * 1024 * 1024;
const S3_UPLOAD_CONCURRENCY = 2;

export async function uploadExportStream(
  objectKey: string,
  contentType: string,
  body: Readable,
): Promise<UploadedExport> {
  const storage = createStorageClient();

  if (storage.type === 's3') {
    const upload = new Upload({
      client: storage.client,
      params: {
        Bucket: storage.bucket,
        Key: objectKey,
        Body: body,
        ContentType: contentType,
      },
      partSize: S3_PART_SIZE_BYTES,
      queueSize: S3_UPLOAD_CONCURRENCY,
      // Abort the multipart upload if anything throws. Without this an export
      // that dies half way leaves uploaded parts in the bucket that are
      // invisible to ListObjects, never expire without a lifecycle rule, and
      // are billed as storage forever.
      leavePartsOnError: false,
    });

    await upload.done();
    return { bucket: storage.bucket, provider: 'S3' };
  }

  // `size` is intentionally omitted, not passed as 0 — see the note above.
  await storage.client.putObject(storage.bucket, objectKey, body, undefined, {
    'Content-Type': contentType,
  });

  return { bucket: storage.bucket, provider: 'MINIO' };
}

/**
 * Short-lived download URL for a finished export.
 *
 * `filename` becomes a response-header override on the signed request rather
 * than metadata on the object: the convention for naming downloads can then
 * change without rewriting stored objects, and two users downloading the same
 * export could in principle get different names.
 */
export async function presignExportDownload(
  objectKey: string,
  filename: string,
  contentType: string,
  ttlSeconds: number,
): Promise<string> {
  const storage = createStorageClient();
  // Quotes are the only character that can break out of the header value; a
  // filename built by `exportFilename` is already slug-safe, but this is a
  // response header on a presigned URL and gets belt-and-braces treatment.
  const disposition = `attachment; filename="${filename.replace(/"/g, '')}"`;

  if (storage.type === 's3') {
    return getSignedUrl(
      storage.client,
      new GetObjectCommand({
        Bucket: storage.bucket,
        Key: objectKey,
        ResponseContentDisposition: disposition,
        ResponseContentType: contentType,
      }),
      { expiresIn: ttlSeconds },
    );
  }

  return storage.client.presignedGetObject(
    storage.bucket,
    objectKey,
    ttlSeconds,
    {
      'response-content-disposition': disposition,
      'response-content-type': contentType,
    },
  );
}

/**
 * Delete a stored export. Used by the retention sweeper and by the failure path
 * that cleans up a partially written object.
 *
 * Deliberately tolerant of "already gone": the bucket lifecycle rule is a
 * second, independent layer of retention enforcement, so the sweeper regularly
 * arrives at an object the bucket has already removed. Treating that as an
 * error would fail the sweep and leave the *rows* unmarked, which is the one
 * piece of cleanup the lifecycle rule cannot do for us.
 */
export async function deleteExportObject(objectKey: string): Promise<void> {
  const storage = createStorageClient();

  if (storage.type === 's3') {
    await storage.client.send(
      new DeleteObjectCommand({ Bucket: storage.bucket, Key: objectKey }),
    );
    return;
  }

  await storage.client.removeObject(storage.bucket, objectKey);
}
