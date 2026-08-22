import {
  decideRefreshAction,
  interpretRotationClaim,
} from './refresh-token-family';

/**
 * Cover for the decision that used to not exist.
 *
 * `refresh()` previously rejected unknown, expired and already-revoked tokens
 * with one shared `if`, so a replayed (stolen) token was indistinguishable from
 * a session that had simply timed out. These tests pin the three outcomes apart
 * — and pin the ORDER of the checks, which is the part most likely to get
 * quietly rearranged by a later edit that looks harmless.
 */
describe('decideRefreshAction', () => {
  const now = new Date('2026-01-01T12:00:00.000Z');
  const later = new Date('2026-01-02T12:00:00.000Z');
  const earlier = new Date('2026-01-01T11:00:00.000Z');

  it('rejects an unknown token as unknown, without burning anything', () => {
    // Nothing to burn: an unknown hash cannot be attributed to a family. If it
    // could trigger a cascade, guessing cookie values would be a free way to
    // log other people out.
    expect(decideRefreshAction(null, now)).toEqual({
      action: 'reject',
      reason: 'unknown',
    });
    expect(decideRefreshAction(undefined, now)).toEqual({
      action: 'reject',
      reason: 'unknown',
    });
  });

  it('rejects an expired token as expired rather than as a replay', () => {
    const result = decideRefreshAction(
      { revokedAt: null, expiresAt: earlier },
      now,
    );
    expect(result).toEqual({ action: 'reject', reason: 'expired' });
  });

  it('treats a token expiring exactly now as expired', () => {
    // The boundary is <=, so a token whose deadline is this instant is done.
    // Anything else lets a token be spent at the same millisecond it dies.
    const result = decideRefreshAction(
      { revokedAt: null, expiresAt: now },
      now,
    );
    expect(result).toEqual({ action: 'reject', reason: 'expired' });
  });

  it('burns the family when a live-but-revoked token is replayed', () => {
    const result = decideRefreshAction(
      { revokedAt: earlier, expiresAt: later },
      now,
    );
    expect(result).toEqual({ action: 'burn-family', trigger: 'replay' });
  });

  it('files a token that is BOTH expired and revoked under expired', () => {
    // Order matters. An expired token is worthless to an attacker, so cascading
    // on it protects nothing and buries real reuse events under noise from every
    // browser tab that woke up holding a stale cookie.
    const result = decideRefreshAction(
      { revokedAt: earlier, expiresAt: earlier },
      now,
    );
    expect(result).toEqual({ action: 'reject', reason: 'expired' });
  });

  it('claims rotation for a live, unexpired token', () => {
    const result = decideRefreshAction(
      { revokedAt: null, expiresAt: later },
      now,
    );
    expect(result).toEqual({ action: 'claim-rotation' });
  });

  it('defaults `now` to the current time', () => {
    // The default exists so callers cannot accidentally pass a stale clock;
    // a token expiring in the future is live without an explicit `now`.
    const wellInTheFuture = new Date(Date.now() + 60_000);
    expect(
      decideRefreshAction({ revokedAt: null, expiresAt: wellInTheFuture }),
    ).toEqual({
      action: 'claim-rotation',
    });
  });
});

/**
 * The race arm. `rowsUpdated` is the result of a conditional UPDATE
 * (`WHERE id = ? AND revoked_at IS NULL`) used as a compare-and-swap, so its
 * only meaningful values are "I took the token" and "somebody else already had".
 */
describe('interpretRotationClaim', () => {
  it('grants rotation to the caller that moved the row', () => {
    expect(interpretRotationClaim(1)).toEqual({ action: 'claim-rotation' });
  });

  it('treats losing the compare-and-swap as a replay', () => {
    // Zero rows means the token was no longer live when the UPDATE evaluated —
    // two parties spent the same secret. Indistinguishable from theft from the
    // server's side, so it gets the same conservative response.
    expect(interpretRotationClaim(0)).toEqual({
      action: 'burn-family',
      trigger: 'replay',
    });
  });

  it('refuses to treat a multi-row update as a successful claim', () => {
    // Cannot happen while `id` is the primary key — but if a future edit ever
    // widens that WHERE clause, the safe reading of "I revoked several tokens
    // at once" is that something is wrong, not that rotation succeeded.
    expect(interpretRotationClaim(2)).toEqual({
      action: 'burn-family',
      trigger: 'replay',
    });
  });
});
