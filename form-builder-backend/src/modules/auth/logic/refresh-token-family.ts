/**
 * Refresh-token family decisions.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * WHAT WAS WRONG BEFORE: `refresh()` collapsed three completely different
 * situations into one `if`:
 *
 *   if (!tokenRecord || tokenRecord.revokedAt || tokenRecord.expiresAt < now)
 *     throw new UnauthorizedException('Invalid or expired refresh token');
 *
 * A token that had already been rotated away was treated exactly like a token
 * that had simply timed out. That is the difference between "your session ran
 * its course" and "somebody is using a credential they should not have", and
 * the system had no way to tell them apart.
 *
 * Why the distinction matters: rotation on its own does NOT detect theft. If an
 * attacker exfiltrates a refresh token and spends it before the legitimate user
 * next refreshes, the attacker receives a fresh token and the victim's next
 * refresh fails — which, under the old code, looked identical to an expired
 * session. The victim signs in again and shrugs; the attacker keeps rotating a
 * working session indefinitely. The theft is invisible from both ends.
 *
 * The signal is the REPLAY. Under normal operation a rotated token is presented
 * exactly once and never again: the client throws it away the instant it gets a
 * successor. So a second presentation of an already-revoked token means two
 * parties hold the same secret, and the only safe response is to assume the
 * wrong one is the survivor. Burning the whole family (OAuth 2.0 Security BCP
 * §4.13.2) ends both sessions — the victim can sign in again with credentials
 * the attacker does not have, and the attacker is out.
 *
 * WHY THIS FILE IS SEPARATE FROM AuthService: the ordering rules below are the
 * security-relevant part and they are pure — a token's stored state and a clock
 * in, an action out. Kept here they are unit-testable without a database, which
 * is the only way this logic gets regression cover at all (see
 * refresh-token-family.spec.ts).
 */

/** The subset of a RefreshToken row the decision actually depends on. */
export interface RefreshTokenState {
  revokedAt: Date | null;
  expiresAt: Date;
}

/**
 * What `refresh()` should do with a presented token.
 *
 *  reject           — hand back a generic 401 and change nothing. Routine.
 *  claim-rotation   — the token looks live; try to take it (see below). The
 *                     attempt can still lose a race, which is why this is
 *                     "claim" and not "rotate".
 *  burn-family      — a replay. Revoke every live token in the family, audit it,
 *                     and refuse.
 */
export type RefreshAction =
  | { action: 'reject'; reason: 'unknown' | 'expired' }
  | { action: 'claim-rotation' }
  | { action: 'burn-family'; trigger: 'replay' };

/**
 * Decide what a presented refresh token earns.
 *
 * ORDER IS DELIBERATE, and the expiry check comes first on purpose:
 *
 *  1. Unknown hash → reject. Nothing to burn: we cannot attribute an unknown
 *     token to a family, and a random or truncated cookie is the overwhelmingly
 *     common cause. Treating it as an attack would let anyone log out an
 *     arbitrary user by guessing, which is a denial-of-service handed out free.
 *
 *  2. Past its expiry → reject as expired, WITHOUT burning. A timed-out token is
 *     worthless to an attacker — the cascade would protect nothing and would
 *     bury the genuine reuse events under a stream of noise from every browser
 *     tab that woke up after the weekend holding a stale cookie. An alert nobody
 *     reads is not a control. Note this check runs before the revoked check, so
 *     a token that is both expired and revoked is filed under "expired".
 *
 *  3. Already revoked → replay. This is the case the whole feature exists for.
 *     It fires for a rotated predecessor, and also for a token from a family
 *     that was already burned by logout or an admin — in those the cascade
 *     simply matches zero live rows and the audit entry records the prior
 *     reason, so the follow-up is distinguishable from a first detection.
 *
 *  4. Otherwise the token is live as far as this snapshot knows. "As far as this
 *     snapshot knows" is the important qualifier: between reading the row and
 *     writing to it, a concurrent request may have spent the same token. That
 *     race is resolved by the conditional UPDATE, not here — see
 *     `interpretRotationClaim`.
 */
export function decideRefreshAction(
  token: RefreshTokenState | null | undefined,
  now: Date = new Date(),
): RefreshAction {
  if (!token) {
    return { action: 'reject', reason: 'unknown' };
  }

  if (token.expiresAt.getTime() <= now.getTime()) {
    return { action: 'reject', reason: 'expired' };
  }

  if (token.revokedAt) {
    return { action: 'burn-family', trigger: 'replay' };
  }

  return { action: 'claim-rotation' };
}

/**
 * Read the result of the conditional revoke that claims a token for rotation.
 *
 * The claim is a single statement — `UPDATE refresh_tokens SET revoked_at = now,
 * revoked_reason = 'ROTATED' WHERE id = $1 AND revoked_at IS NULL` — expressed
 * through Prisma as `updateMany` with `revokedAt: null` in the WHERE. Prisma's
 * `update` cannot express it: it matches on the primary key alone, so a
 * read-then-write would leave the window between the two wide open.
 *
 * `rowsUpdated` is therefore a compare-and-swap result, not a count anyone cares
 * about numerically:
 *
 *   1 → we moved this row from live to revoked, and no one else can now do the
 *       same. We own the rotation and may mint the successor.
 *   0 → the row was no longer live by the time the UPDATE evaluated. Under
 *       Postgres READ COMMITTED a second writer blocks on the row lock, then
 *       re-checks the predicate against the committed version and drops out
 *       (EvalPlanQual). Somebody else spent this exact token. That is a replay
 *       by the same definition as case 3 above, arrived at a few microseconds
 *       later, and it gets the same treatment.
 *
 * A losing concurrent refresh from the LEGITIMATE client therefore also burns
 * the family. That is intended, and it is the conservative direction: the server
 * cannot distinguish "my own client fired two refreshes at once" from "the
 * attacker and I fired one each", and guessing wrong in the other direction
 * leaves a thief with a live session. In practice the honest client refreshes
 * once per page load, never on a timer or a 401, so the collision is rare and
 * the cost is one re-login.
 */
export function interpretRotationClaim(rowsUpdated: number): RefreshAction {
  return rowsUpdated === 1
    ? { action: 'claim-rotation' }
    : { action: 'burn-family', trigger: 'replay' };
}
