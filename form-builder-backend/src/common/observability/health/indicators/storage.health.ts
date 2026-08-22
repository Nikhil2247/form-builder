import { Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { AppLogger } from '../../logger/app-logger.service';
import type { HealthIndicatorResult } from '@nestjs/terminus';
import { HeadBucketCommand } from '@aws-sdk/client-s3';
import { createStorageClient } from '../../../../config/storage.config';
import type { StorageClientWrapper } from '../../../../config/storage.config';
import { intEnv } from '../../../../config/env';
import { describeError, withDeadline } from './deadline';

/**
 * Object-storage readiness (MinIO or S3).
 *
 * The bucket is checked, not merely the endpoint: a reachable S3 with a missing
 * or mis-named bucket fails every presigned upload the same way an unreachable
 * one does, and `HeadBucket` / `bucketExists` costs one HEAD request. Neither
 * lists objects, so the check stays O(1) whatever the bucket contains.
 *
 * ── Timeout ───────────────────────────────────────────────────────────────
 * Short and non-negotiable (HEALTH_STORAGE_TIMEOUT_MS, default 2s). Object
 * storage is the dependency most likely to go slow rather than down — a
 * saturated MinIO or a cross-region S3 will accept the connection and then
 * think about it — and an unbounded probe would sit there holding the socket
 * while Kubernetes waits on its own probe timeout.
 *
 * ── Why the client is built lazily and cached ─────────────────────────────
 * `createStorageClient()` reads credentials from the environment with `!`
 * assertions and the MinIO constructor validates them, so building it in the
 * constructor would turn a storage misconfiguration into a DI failure that
 * takes the whole app down at boot — including the very probe meant to report
 * it. Built on first use, the failure is a `down` result with a message. Cached
 * afterwards so a probe every few seconds does not allocate an S3 client each
 * time.
 */
@Injectable()
export class StorageHealthIndicator {
  private readonly timeoutMs = intEnv('HEALTH_STORAGE_TIMEOUT_MS', 2000);

  private storage?: StorageClientWrapper;

  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly logger: AppLogger,
  ) {
    this.logger.setContext(StorageHealthIndicator.name);
  }

  async isHealthy<Key extends string = string>(
    key: Key,
  ): Promise<HealthIndicatorResult<Key>> {
    const check = this.healthIndicatorService.check(key);
    const startedAt = Date.now();

    let storage: StorageClientWrapper;
    try {
      storage = this.storage ??= createStorageClient();
    } catch (err) {
      // Logged in full — see the note on logging below.
      this.logger.error(
        'Storage client could not be constructed',
        err as Error,
      );
      return check.down({ message: 'misconfigured' });
    }

    try {
      await withDeadline(
        this.headBucket(storage),
        this.timeoutMs,
        'Object storage',
      );
      return check.up({ responseTimeMs: Date.now() - startedAt });
    } catch (err) {
      // ── This log is what makes the sanitised response acceptable ────────────
      //
      // The probe body deliberately says only "bucket not found" or
      // "unavailable". Without this line that would be the ONLY signal anyone
      // ever sees, and a readiness failure nobody can diagnose is worse than one
      // that overshares — the sanitisation would have traded a small disclosure
      // risk for an operational dead end.
      //
      // The split is: sanitised phrase to the world, full detail (provider,
      // bucket, driver error, stack) to the operator's log stream, which is
      // already authenticated by virtue of being their log stream.
      this.logger.error(
        `Object storage readiness check failed (provider=${storage.type}, bucket=${storage.bucket})`,
        err as Error,
      );
      return check.down({ message: describeError(err) });
    }
  }

  // ── Why `provider` and `bucket` are not in the payload ─────────────────────
  //
  // They were, and a live run of /v1/health/ready returned:
  //
  //   "storage": { "provider": "minio", "bucket": "formbuilder-uploads",
  //                "message": "unavailable", "status": "down" }
  //
  // The message was correctly sanitised (see describeError) and then the bucket
  // name was published beside it anyway — which rather defeats the point. This
  // endpoint is unauthenticated by necessity, so a bucket name here is a bucket
  // name given to anyone who can reach the probe: the first thing worth knowing
  // if you are looking for a misconfigured public bucket, and it costs the
  // operator nothing to omit, because the value came from their own env var.
  //
  // Which provider and which bucket is deployment configuration, not runtime
  // state. It belongs in logs and in `STORAGE_PROVIDER` / the bucket setting,
  // not in a world-readable response body.

  private async headBucket(storage: StorageClientWrapper): Promise<void> {
    if (storage.type === 's3') {
      // Throws NotFound/Forbidden when the bucket is absent or unreadable,
      // which is the answer we want either way.
      await storage.client.send(
        new HeadBucketCommand({ Bucket: storage.bucket }),
      );
      return;
    }

    const exists = await storage.client.bucketExists(storage.bucket);
    if (!exists) {
      // Carries `code` so describeError can name this precisely as
      // "bucket not found" rather than collapsing it to "unavailable". The
      // distinction is worth preserving: an unreachable endpoint and a missing
      // bucket look identical in a probe body but need completely different
      // fixes, and this is the single most common storage misconfiguration —
      // credentials are right, endpoint is right, nobody created the bucket.
      //
      // The name goes in the log line, never in the thrown message, since the
      // message is what reaches the unauthenticated response.
      throw Object.assign(new Error('bucket does not exist'), {
        code: 'NoSuchBucket',
      });
    }
  }
}
