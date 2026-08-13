/**
 * Bound a dependency check in time.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A readiness probe that HANGS is worse than one that fails. Kubernetes will
 * not mark the pod unready until the probe's own `timeoutSeconds` elapses, and
 * in the meantime every probe interval starts another attempt against the same
 * unreachable dependency — so a stalled object store quietly turns into a pile
 * of half-open sockets on every replica. Failing fast and loudly gets the pod
 * out of the load balancer while the connection budget is still intact.
 *
 * The losing promise is deliberately not cancelled: neither the MinIO client
 * nor ioredis takes an AbortSignal, and the underlying socket carries its own
 * connect timeout. What matters is that the probe answers on schedule.
 */
export function withDeadline<T>(
  work: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} did not respond within ${ms}ms`)),
      ms,
    );
    // unref so a pending deadline cannot hold the process open during shutdown.
    timer.unref();

    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        // Normalised to an Error so the rejection reason is always something
        // `describeError` and the logger can handle. A driver that rejects with
        // a bare string or an object would otherwise produce a stack-less
        // failure that is impossible to attribute.
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

/**
 * Classify a dependency failure into a fixed, non-secret phrase.
 *
 * ── Why this is not `err.message` ──────────────────────────────────────────
 * `/health/ready` is unauthenticated by necessity: the kubelet holds no
 * credentials, and a probe that could 401 would restart-loop a healthy pod. So
 * whatever this returns is world-readable, and driver error messages are not
 * safe to publish. Real examples from the clients in use here:
 *
 *   connect ECONNREFUSED 10.0.3.14:6379
 *   getaddrinfo ENOTFOUND minio.internal.svc.cluster.local
 *   AccessDenied: user 'formbuilder-prod' cannot access bucket 'fb-uploads'
 *
 * Each one hands an unauthenticated caller a piece of the internal topology —
 * private addresses, service names, bucket names, IAM principals. That is a
 * free network map for anyone who can reach the probe, and it costs nothing to
 * withhold: the operator needs the detail, and the operator has the logs.
 *
 * So the mapping is a closed vocabulary. Anything unrecognised collapses to
 * "unavailable" rather than falling through to the raw text — a denylist would
 * eventually meet a message nobody anticipated, and the failure mode of getting
 * that wrong is silent disclosure.
 *
 * Callers that want the real cause should log `err` themselves.
 */
export function describeError(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  const raw = err instanceof Error ? err.message : String(err);

  // Node/libuv socket-level codes, plus the two S3 responses worth telling
  // apart operationally (a missing bucket and a permissions problem need
  // different fixes, and neither phrase names the bucket or the principal).
  switch (typeof code === 'string' ? code : '') {
    case 'ECONNREFUSED':
      return 'connection refused';
    case 'ETIMEDOUT':
    case 'ESOCKETTIMEDOUT':
      return 'connection timed out';
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'host could not be resolved';
    case 'ECONNRESET':
      return 'connection reset';
    case 'EACCES':
    case 'EPERM':
      return 'permission denied';
    case 'NoSuchBucket':
    case 'NotFound':
      return 'bucket not found';
    case 'AccessDenied':
    case 'InvalidAccessKeyId':
    case 'SignatureDoesNotMatch':
      return 'storage credentials rejected';
  }

  // The deadline above raises a plain Error whose text we author ourselves, and
  // which contains only a label and a number. Matched on shape rather than
  // passed through by default, so the closed-vocabulary rule still holds.
  if (/^[\w -]+ did not respond within \d+ms$/.test(raw)) return raw;

  return 'unavailable';
}
