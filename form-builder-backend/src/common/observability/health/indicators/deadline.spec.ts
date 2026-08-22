import { describeError, withDeadline } from './deadline';

/**
 * `describeError` is a disclosure control, not a formatting helper.
 *
 * `/health/ready` is unauthenticated (see the reviewed entry in
 * tenant-isolation.spec.ts), so everything this function returns is
 * world-readable. These tests exist to make the closed-vocabulary rule
 * enforceable: the interesting cases are the ones asserting that internal
 * detail does NOT come out.
 */
describe('describeError', () => {
  const withCode = (code: string, message: string) =>
    Object.assign(new Error(message), { code });

  it.each([
    [
      'ECONNREFUSED',
      'connect ECONNREFUSED 10.0.3.14:6379',
      'connection refused',
    ],
    ['ETIMEDOUT', 'connect ETIMEDOUT 10.0.3.14:6379', 'connection timed out'],
    [
      'ENOTFOUND',
      'getaddrinfo ENOTFOUND minio.internal.svc.cluster.local',
      'host could not be resolved',
    ],
    ['ECONNRESET', 'socket hang up', 'connection reset'],
    ['EACCES', 'permission denied, open /var/run/secret', 'permission denied'],
    [
      'NoSuchBucket',
      "The specified bucket 'fb-uploads-prod' does not exist",
      'bucket not found',
    ],
    [
      'AccessDenied',
      "user 'formbuilder-prod' cannot access bucket 'fb-uploads'",
      'storage credentials rejected',
    ],
  ])('maps %s to a fixed phrase', (code, message, expected) => {
    expect(describeError(withCode(code, message))).toBe(expected);
  });

  describe('does not disclose internals', () => {
    const leaky = [
      withCode('ECONNREFUSED', 'connect ECONNREFUSED 10.0.3.14:6379'),
      withCode(
        'ENOTFOUND',
        'getaddrinfo ENOTFOUND minio.internal.svc.cluster.local',
      ),
      withCode(
        'AccessDenied',
        "user 'formbuilder-prod' cannot access bucket 'fb-uploads'",
      ),
      new Error('password authentication failed for user "formbuilder"'),
      new Error('Redis connection to 72.61.246.176:6379 failed'),
    ];

    it.each(leaky.map((e) => [e.message, e] as const))(
      'strips detail from: %s',
      (_label, err) => {
        const out = describeError(err);

        // No addresses, ports, hostnames, bucket names or principals.
        expect(out).not.toMatch(/\d+\.\d+\.\d+\.\d+/); // IPv4
        expect(out).not.toMatch(/:\d{2,5}\b/); // port
        expect(out).not.toMatch(/\.(svc|local|com|net|internal)\b/); // hostname
        expect(out).not.toMatch(/formbuilder|fb-uploads|minio|redis/i); // names
      },
    );
  });

  it('collapses anything unrecognised rather than falling through', () => {
    // The closed-vocabulary rule: an unanticipated driver message must not
    // reach the response just because nobody wrote a case for it.
    expect(
      describeError(
        new Error('some novel driver failure with /etc/secrets in it'),
      ),
    ).toBe('unavailable');
    expect(describeError('a bare string')).toBe('unavailable');
    expect(describeError(null)).toBe('unavailable');
    expect(describeError({ nested: { secret: 'value' } })).toBe('unavailable');
  });

  it('passes through the deadline message, which we author ourselves', () => {
    // Contains only a label and a number, and is the single most useful thing
    // an operator can see on a probe body.
    expect(
      describeError(new Error('redis did not respond within 2000ms')),
    ).toBe('redis did not respond within 2000ms');
  });

  it('does not let a forged deadline-shaped message smuggle detail', () => {
    expect(
      describeError(new Error('host 10.0.0.1:6379 did not respond within 5ms')),
    ).toBe('unavailable');
  });
});

describe('withDeadline', () => {
  it('resolves when the work beats the deadline', async () => {
    await expect(
      withDeadline(Promise.resolve('ok'), 50, 'redis'),
    ).resolves.toBe('ok');
  });

  it('rejects with a non-secret message when the work is too slow', async () => {
    const slow = new Promise((resolve) => setTimeout(resolve, 200).unref?.());
    await expect(withDeadline(slow, 10, 'storage')).rejects.toThrow(
      'storage did not respond within 10ms',
    );
  });

  it('propagates a genuine failure rather than waiting for the deadline', async () => {
    await expect(
      withDeadline(Promise.reject(new Error('boom')), 5_000, 'redis'),
    ).rejects.toThrow('boom');
  });
});
