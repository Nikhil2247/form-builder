import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { createStorageClient } from '../../../config/storage.config';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { QUEUE_NAMES } from '../../../config/bullmq.config';

export interface VerifyFilePayload {
  fileId: string;
  submissionId?: string;
}

/**
 * FileVerifierProcessor
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Confirms that a file the client claimed to upload actually landed in object
 * storage, and reconciles the org's storage accounting.
 *
 * REPLACES: the previous StorageVerifierProcessor, which was declared on the
 * WEBHOOKS queue (it would have competed with WebhooksProcessor and failed every
 * webhook job) and was never registered in StorageModule, so it was dead code.
 *
 * WHY VERIFICATION MATTERS:
 *  The presigned PUT URL is handed to an untrusted client. Neither MinIO's
 *  presignedPutObject nor a plain S3 presigned PUT binds Content-Length, so the
 *  declared size at presign time is a claim, not a guarantee. This worker reads
 *  the ACTUAL object size back from storage and is the only place
 *  Organization.storageUsedBytes is allowed to move.
 */
@Processor(QUEUE_NAMES.FILE_VERIFY, { concurrency: 10 })
export class FileVerifierProcessor extends WorkerHost {
  private readonly logger = new Logger(FileVerifierProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<VerifyFilePayload>): Promise<void> {
    const { fileId, submissionId } = job.data;

    const file = await this.prisma.reader.formSubmissionFile.findUnique({
      where: { id: fileId },
    });

    if (!file) {
      this.logger.warn(`File record ${fileId} no longer exists; nothing to verify.`);
      return;
    }

    if (file.status === 'VERIFIED') {
      // Already verified — but verification and ownership arrive on different
      // jobs now. The presign-scheduled job knows the bytes landed; only the
      // submission-triggered job knows which submission claims them. Returning
      // unconditionally here would strand the file with submissionId = NULL,
      // which is what breaks the download path and the retention sweep.
      if (submissionId && !file.submissionId) {
        await this.prisma.writer.formSubmissionFile.updateMany({
          where: { id: fileId, submissionId: null },
          data: { submissionId },
        });
      }
      return;
    }

    const storage = createStorageClient();

    let actualSize: bigint | null = null;
    let actualMime: string | undefined;

    try {
      if (storage.type === 's3') {
        const head = await storage.client.send(
          new HeadObjectCommand({ Bucket: file.bucket, Key: file.objectKey }),
        );
        actualSize = BigInt(head.ContentLength ?? 0);
        actualMime = head.ContentType;
      } else {
        const stat = await storage.client.statObject(file.bucket, file.objectKey);
        actualSize = BigInt(stat.size);
        actualMime = stat.metaData?.['content-type'];
      }
    } catch {
      // Object absent: the presigned URL expired or the client abandoned the
      // upload. Mark DELETED so the reaper can clean up the row later.
      await this.prisma.writer.formSubmissionFile.update({
        where: { id: fileId },
        data: { status: 'DELETED' },
      });
      this.logger.warn(`Upload never completed for ${file.objectKey}; marked DELETED.`);
      return;
    }

    // ── Enforce the real size against the configured ceiling ────────────────
    const maxBytes = BigInt(parseInt(process.env.MAX_FILE_SIZE_MB ?? '25', 10)) * 1024n * 1024n;
    if (actualSize > maxBytes) {
      await this.prisma.writer.formSubmissionFile.update({
        where: { id: fileId },
        data: {
          status: 'QUARANTINED',
          quarantineReason: `Uploaded size ${actualSize} exceeds the ${maxBytes}-byte limit.`,
          sizeBytes: actualSize,
        },
      });
      this.logger.warn(`File ${fileId} exceeded size limit (${actualSize} bytes); quarantined.`);
      return;
    }

    // ── Content-type must still match what was authorised at presign time ────
    if (actualMime && actualMime.split(';')[0] !== file.mimeType) {
      await this.prisma.writer.formSubmissionFile.update({
        where: { id: fileId },
        data: {
          status: 'QUARANTINED',
          quarantineReason: `Declared "${file.mimeType}" but stored object is "${actualMime}".`,
          sizeBytes: actualSize,
        },
      });
      this.logger.warn(`File ${fileId} MIME mismatch; quarantined.`);
      return;
    }

    // ── Commit: mark verified AND charge the org's storage quota ────────────
    // Both in one transaction so usage can never drift from verified files.
    const orgId = this.orgIdFromObjectKey(file.objectKey);

    // Two jobs can legitimately target the same file — one scheduled at presign
    // time, one when a submission references it. The early VERIFIED check above
    // is not enough on its own: both can read "not yet verified" and then both
    // increment, permanently inflating the org's usage.
    //
    // updateMany with the status in the WHERE clause makes the transition the
    // lock. Exactly one job gets count === 1; the loser charges nothing.
    await this.prisma.writer.$transaction(async (tx: any) => {
      const { count } = await tx.formSubmissionFile.updateMany({
        where: { id: fileId, status: { not: 'VERIFIED' } },
        data: {
          status: 'VERIFIED',
          verifiedAt: new Date(),
          sizeBytes: actualSize,
        },
      });

      // Ownership is recorded regardless of who won the verify race — losing
      // the race must not cost the file its submission link.
      if (submissionId) {
        await tx.formSubmissionFile.updateMany({
          where: { id: fileId, submissionId: null },
          data: { submissionId },
        });
      }

      if (count === 0) {
        this.logger.debug(`File ${fileId} already verified by a concurrent job.`);
        return;
      }

      if (orgId) {
        await tx.organization.update({
          where: { id: orgId },
          data: { storageUsedBytes: { increment: actualSize } },
        });
      }
    });

    this.logger.log(`Verified ${file.objectKey} (${actualSize} bytes).`);
  }

  /**
   * Object keys follow `uploads/org_{orgId}/form_{formId}/{fileId}{ext}`.
   * Parsing the org back out avoids a second DB round-trip on the hot path.
   */
  private orgIdFromObjectKey(objectKey: string): string | null {
    const match = objectKey.match(/uploads\/org_([0-9a-fA-F-]{36})\//);
    return match ? match[1] : null;
  }
}
