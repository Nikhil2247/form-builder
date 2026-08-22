import {
  API_KEY_BODY_LENGTH,
  API_KEY_SCOPES,
  encodeBase62,
  evaluateApiKey,
  fingerprintFromHash,
  isApiKeyScope,
  looksLikeApiKey,
  parseScopes,
  shouldRefreshLastUsedAt,
  type ApiKeyRecord,
} from './api-key-policy';

/**
 * Cover for the four checks ApiKeyGuard did not previously make at all —
 * revocation, expiry, organization, and scope — plus the lastUsedAt throttle
 * that replaced its unconditional write.
 *
 * No database and no Redis: everything here is a pure function over plain
 * values, which is the reason the logic was moved out of the guard.
 */
describe('api-key policy', () => {
  const NOW = new Date('2026-08-13T12:00:00.000Z');
  const ORG_A = '11111111-1111-4111-8111-111111111111';
  const ORG_B = '22222222-2222-4222-8222-222222222222';

  const liveKey: ApiKeyRecord = {
    id: 'key-1',
    userId: 'user-1',
    organizationId: ORG_A,
    scopes: 'forms:read,submissions:read',
    expiresAt: null,
    revokedAt: null,
  };

  const evaluate = (
    overrides: Partial<ApiKeyRecord>,
    ctx: { routeOrgId?: string | null; requiredScopes?: string[] } = {},
  ) =>
    evaluateApiKey(
      { ...liveKey, ...overrides },
      {
        routeOrgId: 'routeOrgId' in ctx ? ctx.routeOrgId : ORG_A,
        requiredScopes: ctx.requiredScopes ?? ['forms:read'],
        now: NOW,
      },
    );

  describe('revocation', () => {
    // revokedAt was not even SELECTed by the old guard. Revoking a leaked key
    // through the UI changed a column and nothing else.
    it('rejects a key whose revokedAt has passed', () => {
      const decision = evaluate({
        revokedAt: new Date('2026-08-13T11:59:59.000Z'),
      });

      expect(decision.allowed).toBe(false);
      expect(decision).toMatchObject({ reason: 'REVOKED', status: 401 });
    });

    it('rejects a key revoked at this exact instant', () => {
      expect(evaluate({ revokedAt: NOW })).toMatchObject({ reason: 'REVOKED' });
    });

    it('accepts a key with a null revokedAt', () => {
      expect(evaluate({}).allowed).toBe(true);
    });

    // Revocation is checked before everything else, so a revoked key never
    // produces a scope- or org-shaped error that suggests it is still live.
    it('reports revocation ahead of a scope failure', () => {
      const decision = evaluate(
        { revokedAt: new Date('2026-01-01T00:00:00.000Z') },
        { requiredScopes: ['submissions:export'] },
      );

      expect(decision).toMatchObject({ reason: 'REVOKED' });
    });
  });

  describe('expiry', () => {
    it('rejects a key whose expiresAt has passed', () => {
      const decision = evaluate({
        expiresAt: new Date('2026-08-13T11:00:00.000Z'),
      });

      expect(decision.allowed).toBe(false);
      expect(decision).toMatchObject({ reason: 'EXPIRED', status: 401 });
    });

    it('rejects a key expiring at this exact instant', () => {
      expect(evaluate({ expiresAt: NOW })).toMatchObject({ reason: 'EXPIRED' });
    });

    it('accepts a key expiring in the future', () => {
      expect(
        evaluate({ expiresAt: new Date('2026-08-13T12:00:01.000Z') }).allowed,
      ).toBe(true);
    });

    it('accepts a key with no expiry at all', () => {
      expect(evaluate({ expiresAt: null }).allowed).toBe(true);
    });
  });

  describe('organization match', () => {
    // The single most important check, and the one that was entirely absent:
    // any valid key could read any organization's data.
    it('rejects a key issued for another organization', () => {
      const decision = evaluate({ organizationId: ORG_B });

      expect(decision.allowed).toBe(false);
      expect(decision).toMatchObject({ reason: 'ORG_MISMATCH', status: 403 });
    });

    it('accepts a key whose organization matches the route', () => {
      expect(evaluate({}, { routeOrgId: ORG_A }).allowed).toBe(true);
    });

    // Fail CLOSED. A route with no :orgId cannot have its tenancy checked, so
    // a key must not reach it — the alternative is a check that quietly does
    // nothing on exactly the routes where it cannot be applied.
    it('rejects when the route carries no orgId at all', () => {
      const decision = evaluate({}, { routeOrgId: undefined });

      expect(decision.allowed).toBe(false);
      expect(decision).toMatchObject({
        reason: 'ROUTE_NOT_ORG_SCOPED',
        status: 403,
      });
    });

    it('rejects when the route orgId is an empty string', () => {
      expect(evaluate({}, { routeOrgId: '' })).toMatchObject({
        reason: 'ROUTE_NOT_ORG_SCOPED',
      });
    });

    // Ordering: the org error must not be preceded by a scope error, or the
    // scope response becomes an oracle for "org B exists and this route is
    // real" to a caller holding a key for org A.
    it('reports the org mismatch ahead of a scope failure', () => {
      expect(
        evaluate(
          { organizationId: ORG_B },
          { requiredScopes: ['submissions:export'] },
        ),
      ).toMatchObject({ reason: 'ORG_MISMATCH' });
    });
  });

  describe('scopes', () => {
    it('accepts a key holding the single required scope', () => {
      expect(
        evaluate({}, { requiredScopes: ['submissions:read'] }).allowed,
      ).toBe(true);
    });

    it('rejects a key missing the required scope', () => {
      const decision = evaluate({}, { requiredScopes: ['submissions:export'] });

      expect(decision.allowed).toBe(false);
      expect(decision).toMatchObject({ reason: 'MISSING_SCOPE', status: 403 });
    });

    it('names the missing scope so the caller can fix the key', () => {
      const decision = evaluate({}, { requiredScopes: ['submissions:export'] });

      expect(decision.allowed).toBe(false);
      if (!decision.allowed)
        expect(decision.message).toContain('submissions:export');
    });

    // Multiple scopes are an AND. The export route requires read AND export;
    // holding only one of them is not enough.
    it('requires every listed scope, not just one of them', () => {
      const decision = evaluate(
        { scopes: 'submissions:read' },
        { requiredScopes: ['submissions:read', 'submissions:export'] },
      );

      expect(decision.allowed).toBe(false);
      expect(decision).toMatchObject({ reason: 'MISSING_SCOPE' });
    });

    it('accepts when every listed scope is held', () => {
      expect(
        evaluate(
          { scopes: 'submissions:read,submissions:export' },
          { requiredScopes: ['submissions:read', 'submissions:export'] },
        ).allowed,
      ).toBe(true);
    });

    it('rejects a key with an empty scope string', () => {
      expect(evaluate({ scopes: '' })).toMatchObject({
        reason: 'MISSING_SCOPE',
      });
    });

    // A scope is not a prefix. `forms:read` must not satisfy `forms:readwrite`
    // or vice versa.
    it('does not treat a scope as a prefix of another', () => {
      expect(
        evaluate(
          { scopes: 'forms:read' },
          { requiredScopes: ['forms:readwrite'] },
        ),
      ).toMatchObject({ reason: 'MISSING_SCOPE' });
    });

    it('returns the granted scopes on success, for the request context', () => {
      const decision = evaluate({ scopes: 'forms:read,submissions:read' });

      expect(decision).toEqual({
        allowed: true,
        scopes: ['forms:read', 'submissions:read'],
      });
    });
  });

  describe('parseScopes', () => {
    it('trims, lowercases, and drops empty segments', () => {
      expect(parseScopes('forms:read, ,SUBMISSIONS:READ')).toEqual([
        'forms:read',
        'submissions:read',
      ]);
    });

    it('de-duplicates', () => {
      expect(parseScopes('forms:read,forms:read')).toEqual(['forms:read']);
    });

    it('treats null and empty as no scopes', () => {
      expect(parseScopes(null)).toEqual([]);
      expect(parseScopes('')).toEqual([]);
    });

    // A hand-written support UPDATE that leaves whitespace must not produce a
    // scope named " " which matches nothing and locks the key out silently.
    it('survives a whitespace-only column value', () => {
      expect(parseScopes('   ')).toEqual([]);
    });
  });

  describe('isApiKeyScope', () => {
    it('recognises every documented scope', () => {
      for (const scope of API_KEY_SCOPES) {
        expect(isApiKeyScope(scope)).toBe(true);
      }
    });

    it('rejects an invented scope', () => {
      expect(isApiKeyScope('forms:delete')).toBe(false);
      expect(isApiKeyScope('*')).toBe(false);
    });
  });

  describe('shouldRefreshLastUsedAt', () => {
    // The throttle that stopped every authenticated read from writing to the
    // primary.
    it('writes when the key has never been used', () => {
      expect(shouldRefreshLastUsedAt(null, NOW)).toBe(true);
    });

    it('skips the write when the timestamp is fresher than the window', () => {
      const tenSecondsAgo = new Date(NOW.getTime() - 10_000);
      expect(shouldRefreshLastUsedAt(tenSecondsAgo, NOW)).toBe(false);
    });

    it('writes once the timestamp is older than the window', () => {
      const twoMinutesAgo = new Date(NOW.getTime() - 120_000);
      expect(shouldRefreshLastUsedAt(twoMinutesAgo, NOW)).toBe(true);
    });

    it('writes exactly at the threshold', () => {
      expect(
        shouldRefreshLastUsedAt(new Date(NOW.getTime() - 60_000), NOW),
      ).toBe(true);
    });

    it('honours an explicit threshold', () => {
      const thirtySecondsAgo = new Date(NOW.getTime() - 30_000);
      expect(shouldRefreshLastUsedAt(thirtySecondsAgo, NOW, 10_000)).toBe(true);
      expect(shouldRefreshLastUsedAt(thirtySecondsAgo, NOW, 60_000)).toBe(
        false,
      );
    });

    // Clock skew between pods can put a stored timestamp in the future. That
    // must mean "recently used", not a write storm.
    it('does not write for a timestamp in the future', () => {
      expect(
        shouldRefreshLastUsedAt(new Date(NOW.getTime() + 5_000), NOW),
      ).toBe(false);
    });
  });

  describe('key format', () => {
    it('encodes to a fixed width regardless of leading zero bytes', () => {
      const leadingZeros = new Uint8Array(32);
      leadingZeros[31] = 1;

      expect(encodeBase62(leadingZeros)).toHaveLength(API_KEY_BODY_LENGTH);
      expect(encodeBase62(new Uint8Array(32).fill(0xff))).toHaveLength(
        API_KEY_BODY_LENGTH,
      );
    });

    it('encodes distinct inputs to distinct outputs', () => {
      const a = new Uint8Array(32);
      const b = new Uint8Array(32);
      b[31] = 1;

      expect(encodeBase62(a)).not.toEqual(encodeBase62(b));
    });

    it('produces base62 characters only', () => {
      const bytes = new Uint8Array(32).map((_, i) => (i * 37) % 256);
      expect(encodeBase62(bytes)).toMatch(/^[0-9A-Za-z]+$/);
    });

    it('accepts a well-formed key and rejects everything else', () => {
      expect(looksLikeApiKey('fbk_' + 'a'.repeat(API_KEY_BODY_LENGTH))).toBe(
        true,
      );
      expect(looksLikeApiKey('a'.repeat(API_KEY_BODY_LENGTH))).toBe(false);
      expect(looksLikeApiKey('fbk_short')).toBe(false);
      expect(looksLikeApiKey('fbk_' + 'a'.repeat(200))).toBe(false);
      expect(
        looksLikeApiKey('fbk_has-a-hyphen-in-it-which-base62-never-does'),
      ).toBe(false);
      expect(looksLikeApiKey('')).toBe(false);
    });
  });

  describe('fingerprintFromHash', () => {
    it('is 8 hex characters of the digest and nothing more', () => {
      const hash = 'a'.repeat(64);
      expect(fingerprintFromHash(hash)).toBe('aaaaaaaa');
      expect(fingerprintFromHash(hash)).toHaveLength(8);
    });

    it('distinguishes two different keys', () => {
      expect(fingerprintFromHash('deadbeef' + '0'.repeat(56))).not.toEqual(
        fingerprintFromHash('cafebabe' + '0'.repeat(56)),
      );
    });
  });
});
