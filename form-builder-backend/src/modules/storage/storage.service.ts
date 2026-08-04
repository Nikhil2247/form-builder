import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createStorageClient } from '../../config/storage.config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { nanoid } from 'nanoid';
import * as path from 'path';

@Injectable()
export class StorageService {
  constructor(private readonly prisma: PrismaService) {}

  async generatePresignedUrl(formId: string, questionId: string, filename: string, mimeType: string, fileSizeMb: number) {
    if (fileSizeMb > 50) {
      throw new BadRequestException('File size exceeds the 50MB limit.');
    }

    const fileSizeBytes = BigInt(Math.floor(fileSizeMb * 1024 * 1024));

    // Verify form exists and get its organization
    const form = await this.prisma.reader.form.findUnique({
      where: { id: formId },
      select: { 
        organizationId: true, 
        status: true,
        expiresAt: true,
        organization: {
          select: { isActive: true, storageQuotaBytes: true, storageUsedBytes: true }
        }
      },
    });

    if (!form || form.status !== 'PUBLISHED') {
      throw new NotFoundException('Form not found or not published.');
    }
    if (!form.organization.isActive) {
      throw new ForbiddenException('Form organization is suspended.');
    }
    if (form.expiresAt && form.expiresAt < new Date()) {
      throw new ForbiddenException('Form has expired.');
    }

    // Storage Quota Check
    const projectedUsage = form.organization.storageUsedBytes + fileSizeBytes;
    if (projectedUsage > form.organization.storageQuotaBytes) {
      throw new ForbiddenException('Organization storage quota exceeded.');
    }

    const extension = path.extname(filename);
    const fileId = nanoid(16);
    const objectKey = `uploads/org_${form.organizationId}/form_${formId}/${fileId}${extension}`;

    const storageWrapper = createStorageClient();
    const bucket = storageWrapper.bucket;
    let url: string;

    if (storageWrapper.type === 's3') {
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: objectKey,
        ContentType: mimeType,
      });
      url = await getSignedUrl(storageWrapper.client, command, { expiresIn: 900 });
    } else {
      url = await storageWrapper.client.presignedPutObject(bucket, objectKey, 900);
    }

    // Track the pending upload in the database
    const dbRecord = await this.prisma.writer.formSubmissionFile.create({
      data: {
        questionId,
        provider: storageWrapper.type === 's3' ? 'AWS_S3' : 'MINIO',
        bucket: bucket,
        objectKey,
        originalName: filename,
        mimeType,
        sizeBytes: fileSizeBytes,
        status: 'PENDING_UPLOAD',
      }
    });

    return {
      uploadUrl: url,
      objectKey,
      fileId: dbRecord.id, // Return the DB record ID so the frontend can include it in the submission payload
    };
  }
}

