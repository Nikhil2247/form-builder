import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createStorageClient } from '../../config/storage.config';
import { PrismaService } from '../../common/infra/prisma/prisma.service';
import { QUEUE_NAMES } from '../../config/bullmq.config';
import { nanoid } from 'nanoid';
import * as path from 'path';

/**
 * Conservative default MIME allowlist.
 *
 * A form author may narrow this per question via `acceptedMimeTypes`, but can
 * never widen it beyond this set. Notably absent: text/html and image/svg+xml,
 * both of which execute script if the bucket is ever served over a browsable
 * origin (stored XSS on your own domain).
 */
const DEFAULT_ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'application/zip',
  'video/mp4',
  'audio/mpeg',
  'audio/wav',
]);

/** Extensions that must never be issued a presigned URL, whatever MIME claims. */
const BLOCKED_EXTENSIONS = new Set([
  '.html',
  '.htm',
  '.xhtml',
  '.svg',
  '.js',
  '.mjs',
  '.exe',
  '.dll',
  '.so',
  '.sh',
  '.bat',
  '.cmd',
  '.com',
  '.scr',
  '.msi',
  '.jar',
  '.php',
  '.phtml',
  '.asp',
  '.aspx',
  '.jsp',
  '.cgi',
  '.pl',
  '.py',
  '.rb',
  '.ps1',
]);

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NAMES.FILE_VERIFY)
    private readonly fileVerifyQueue: Queue,
  ) {}

  /**
   * Create the configured bucket if it does not exist yet.
   *
   * Without this, a fresh MinIO instance reports "Down" on the storage health
   * probe forever — nothing else in the deployment ever creates the bucket,
   * so a brand-new environment starts broken until someone runs `mc mb` by
   * hand. Best-effort and never fatal: a storage outage at boot should not
   * crash the API process that is supposed to report the outage.
   */
  async onModuleInit() {
    try {
      const storage = createStorageClient();

      if (storage.type === 'minio') {
        const exists = await storage.client.bucketExists(storage.bucket);
        if (!exists) {
          await storage.client.makeBucket(storage.bucket);
          this.logger.log(`Created MinIO bucket "${storage.bucket}"`);
        }
        return;
      }

      // S3: bucket creation is normally provisioned via IaC and region-bound,
      // but the same "nobody created it" failure is worth recovering from
      // automatically rather than leaving the deployment down.
      const { HeadBucketCommand, CreateBucketCommand } = await import(
        '@aws-sdk/client-s3'
      );
      try {
        await storage.client.send(
          new HeadBucketCommand({ Bucket: storage.bucket }),
        );
      } catch {
        await storage.client.send(
          new CreateBucketCommand({ Bucket: storage.bucket }),
        );
        this.logger.log(`Created S3 bucket "${storage.bucket}"`);
      }
    } catch (err) {
      this.logger.warn(
        `Could not verify or create the storage bucket at startup: ${(err as Error).message}`,
      );
    }
  }

  async generatePresignedUrl(
    formId: string,
    questionId: string,
    filename: string,
    mimeType: string,
    fileSizeBytes: number,
  ) {
    // ── Size: honour the configured limit instead of a hardcoded 50MB ───────
    const maxMb = parseInt(process.env.MAX_FILE_SIZE_MB ?? '25', 10);
    const maxBytes = maxMb * 1024 * 1024;

    if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0) {
      throw new BadRequestException('A valid file size is required.');
    }
    if (fileSizeBytes > maxBytes) {
      throw new BadRequestException(`File exceeds the ${maxMb}MB limit.`);
    }

    // ── Form must exist, be published, and belong to an active org ──────────
    const form = await this.prisma.reader.form.findUnique({
      where: { id: formId },
      select: {
        organizationId: true,
        status: true,
        expiresAt: true,
        deletedAt: true,
        currentVersion: true,
        organization: {
          select: {
            isActive: true,
            storageQuotaBytes: true,
            storageUsedBytes: true,
          },
        },
        versions: {
          orderBy: { version: 'desc' },
          take: 5,
          select: { version: true, questionsJson: true },
        },
      },
    });

    if (!form || form.deletedAt || form.status !== 'PUBLISHED') {
      throw new NotFoundException('Form not found or not accepting uploads.');
    }
    if (!form.organization.isActive) {
      throw new ForbiddenException('Form organization is suspended.');
    }
    if (form.expiresAt && form.expiresAt < new Date()) {
      throw new ForbiddenException('Form has expired.');
    }

    // ── The question must exist in the published version AND be a file field.
    //    Without this, any published formId could be used to write arbitrary
    //    objects into the bucket under a fabricated question id. ──────────────
    const activeVersion =
      form.versions.find((v) => v.version === form.currentVersion) ??
      form.versions[0];
    const questions = Array.isArray(activeVersion?.questionsJson)
      ? (activeVersion.questionsJson as any[])
      : [];

    const question = questions.find((q) => q?.id === questionId);
    if (!question) {
      throw new BadRequestException('Unknown question for this form.');
    }
    if (question.type !== 'FILE_UPLOAD') {
      throw new BadRequestException(
        'This question does not accept file uploads.',
      );
    }

    // ── MIME + extension allowlist ──────────────────────────────────────────
    const normalizedMime = (mimeType ?? '').split(';')[0].trim().toLowerCase();
    const questionAllowed: string[] | undefined = Array.isArray(
      question.acceptedMimeTypes,
    )
      ? question.acceptedMimeTypes
      : undefined;

    const allowed = questionAllowed
      ? new Set(
          questionAllowed
            .map((m) => m.toLowerCase())
            .filter((m) => DEFAULT_ALLOWED_MIME.has(m)),
        )
      : DEFAULT_ALLOWED_MIME;

    if (!allowed.has(normalizedMime)) {
      throw new BadRequestException(
        `File type "${normalizedMime}" is not permitted.`,
      );
    }

    // Per-question size override may only tighten the global cap.
    if (typeof question.maxFileSizeMb === 'number') {
      const questionMax = Math.min(question.maxFileSizeMb, maxMb) * 1024 * 1024;
      if (fileSizeBytes > questionMax) {
        throw new BadRequestException(
          `File exceeds this question's ${question.maxFileSizeMb}MB limit.`,
        );
      }
    }

    const safeName = sanitizeFilename(filename);
    const extension = path.extname(safeName).toLowerCase();
    if (BLOCKED_EXTENSIONS.has(extension)) {
      throw new BadRequestException(
        `Files with the "${extension}" extension are not permitted.`,
      );
    }

    // ── Storage quota ───────────────────────────────────────────────────────
    // storageUsedBytes only counts VERIFIED files, and verification happens
    // minutes after the URL is issued. Checking it alone lets an unauthenticated
    // caller mint an unbounded number of presigned URLs inside that window —
    // every one of them passing a quota that has not yet moved.
    //
    // So reserve the bytes that are already promised but not yet counted. The
    // org is encoded in the object key (uploads/org_{orgId}/...), which is the
    // only org linkage FormSubmissionFile has.
    const inFlight = await this.prisma.reader.formSubmissionFile.aggregate({
      _sum: { sizeBytes: true },
      where: {
        status: 'PENDING_UPLOAD',
        objectKey: { startsWith: `uploads/org_${form.organizationId}/` },
        // Expired reservations are dead weight — the URL can no longer be used.
        expiresAt: { gt: new Date() },
      },
    });

    const reserved = inFlight._sum.sizeBytes ?? 0n;
    const projected =
      form.organization.storageUsedBytes +
      reserved +
      BigInt(Math.floor(fileSizeBytes));

    if (projected > form.organization.storageQuotaBytes) {
      throw new ForbiddenException('Organization storage quota exceeded.');
    }

    // ── Issue the presigned URL ─────────────────────────────────────────────
    const fileId = nanoid(16);
    const objectKey = `uploads/org_${form.organizationId}/form_${formId}/${fileId}${extension}`;

    const storageWrapper = createStorageClient();
    const bucket = storageWrapper.bucket;
    const ttl = parseInt(process.env.PRESIGNED_URL_TTL_SECONDS ?? '900', 10);
    let url: string;

    if (storageWrapper.type === 's3') {
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: objectKey,
        ContentType: normalizedMime,
        // Binds the signature to the declared length so the client cannot
        // upload a 5GB object against a 1MB claim.
        ContentLength: Math.floor(fileSizeBytes),
      });
      url = await getSignedUrl(storageWrapper.client, command, {
        expiresIn: ttl,
        signableHeaders: new Set(['content-type', 'content-length']),
      });
    } else {
      // MinIO's presignedPutObject cannot bind Content-Length; the
      // FileVerifierProcessor reads the real size back and quarantines
      // anything oversized.
      url = await storageWrapper.client.presignedPutObject(
        bucket,
        objectKey,
        ttl,
      );
    }

    const expiresAt = new Date(Date.now() + ttl * 1000);

    const dbRecord = await this.prisma.writer.formSubmissionFile.create({
      data: {
        questionId,
        provider: storageWrapper.type === 's3' ? 'S3' : 'MINIO',
        bucket,
        objectKey,
        originalName: safeName,
        mimeType: normalizedMime,
        sizeBytes: BigInt(Math.floor(fileSizeBytes)),
        status: 'PENDING_UPLOAD',
        expiresAt,
      },
    });

    // ── Schedule reconciliation ─────────────────────────────────────────────
    // SubmissionProcessor also enqueues a verify job, but only for files that a
    // submission actually references. A file uploaded and then abandoned would
    // otherwise sit at PENDING_UPLOAD forever: never verified, never counted
    // against the quota, never reaped — which is precisely what makes an
    // unauthenticated upload endpoint an unbounded storage sink.
    //
    // Firing after the URL expires means the outcome is final: either the
    // object is there (verify, charge the quota) or it never arrived (mark
    // DELETED). The processor is idempotent, so the submission-triggered job
    // and this one cannot double-charge.
    await this.fileVerifyQueue.add(
      'verify-file',
      { fileId: dbRecord.id },
      {
        delay: (ttl + 60) * 1000,
        jobId: `presign-verify:${dbRecord.id}`,
        removeOnComplete: true,
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
      },
    );

    return {
      uploadUrl: url,
      objectKey,
      fileId: dbRecord.id,
      expiresAt,
      maxBytes,
    };
  }

  /**
   * Time-limited download URL for a file, scoped to the caller's organization.
   * There was previously no download path at all.
   */
  async generateDownloadUrl(orgId: string, fileId: string) {
    const file = await this.prisma.reader.formSubmissionFile.findUnique({
      where: { id: fileId },
      select: {
        id: true,
        bucket: true,
        objectKey: true,
        originalName: true,
        status: true,
        submission: { select: { form: { select: { organizationId: true } } } },
      },
    });

    if (!file) throw new NotFoundException('File not found.');

    // Tenant check: the file must hang off a submission belonging to this org.
    const owningOrg = file.submission?.form.organizationId;
    if (!owningOrg || owningOrg !== orgId) {
      throw new NotFoundException('File not found.');
    }

    if (file.status === 'QUARANTINED') {
      throw new ForbiddenException(
        'This file was quarantined and cannot be downloaded.',
      );
    }
    if (file.status !== 'VERIFIED') {
      throw new NotFoundException('File is not available yet.');
    }

    const storage = createStorageClient();
    const ttl = 300;

    if (storage.type === 's3') {
      return {
        downloadUrl: await getSignedUrl(
          storage.client,
          new GetObjectCommand({ Bucket: file.bucket, Key: file.objectKey }),
          { expiresIn: ttl },
        ),
        expiresIn: ttl,
      };
    }

    return {
      downloadUrl: await storage.client.presignedGetObject(
        file.bucket,
        file.objectKey,
        ttl,
      ),
      expiresIn: ttl,
    };
  }
}

/**
 * Strip path separators, control characters, and leading dots so a filename can
 * never traverse out of its prefix or produce a hidden object key.
 */
function sanitizeFilename(name: string): string {
  const base = path.basename(name ?? 'file');
  const cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/^\.+/, '')
    .trim();
  return (cleaned || 'file').slice(0, 200);
}
