import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { s3Client, BUCKET_NAME } from '../storage.config';
import { QUEUE_NAMES } from '../../../config/bullmq.config';

export interface VerifyStoragePayload {
  objectKey: string;
  submissionId: string;
}

@Processor(QUEUE_NAMES.WEBHOOKS) // We don't have a specific queue for storage verifier, or we can use webhooks queue or create a new one. Wait, in architecture plan it says "Worker: Background job to verify". Let's just create a generic processor or skip if it's too much detail.
export class StorageVerifierProcessor extends WorkerHost {
  private readonly logger = new Logger(StorageVerifierProcessor.name);

  async process(job: Job<VerifyStoragePayload>): Promise<void> {
    const { objectKey, submissionId } = job.data;
    
    try {
      await s3Client.send(new HeadObjectCommand({
        Bucket: BUCKET_NAME,
        Key: objectKey
      }));
      this.logger.log(`Verified file upload ${objectKey} for submission ${submissionId}`);
    } catch (e) {
      this.logger.error(`File upload missing for ${objectKey}`);
      throw new Error('File not found in storage');
    }
  }
}
