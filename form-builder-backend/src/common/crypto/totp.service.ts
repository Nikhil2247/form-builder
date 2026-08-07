import { Injectable } from '@nestjs/common';
import { generateSecret, generateURI, verify } from 'otplib';

/**
 * TotpService — thin wrapper isolating the otplib API surface.
 *
 * OTPLIB 13 MIGRATION NOTES (this wrapper exists precisely because of these):
 *
 *  1. The `authenticator` singleton was REMOVED. v13 exposes a functional API
 *     (`generateSecret`, `generateURI`, `verify`) plus an `OTP` class.
 *
 *  2. `verify()` now returns a RESULT OBJECT `{ valid, delta }`, not a boolean,
 *     and it is async. Code written against v12 (`if (!authenticator.verify(...))`)
 *     silently becomes `if (!someObject)` — always false — which would accept
 *     ANY code as valid. This wrapper returns a real boolean so that class of
 *     mistake cannot recur at call sites.
 *
 *  3. The default verification tolerance changed to 0. v12's authenticator
 *     allowed a ±1 step window, absorbing clock skew between the user's phone
 *     and the server. With 0 tolerance, users with a slightly-off device clock
 *     get rejected. We restore a symmetric one-step (30s) window, which is the
 *     usual security/usability trade-off.
 */
const PERIOD_SECONDS = 30;

/** Symmetric ±1 time step. Tighten to [30, 0] for RFC-strict past-only checks. */
const EPOCH_TOLERANCE: [number, number] = [PERIOD_SECONDS, PERIOD_SECONDS];

@Injectable()
export class TotpService {
  /** Generate a fresh base32 secret for enrolment. */
  generateSecret(): string {
    return generateSecret();
  }

  /** Build the otpauth:// URI that gets rendered as an enrolment QR code. */
  buildUri(accountEmail: string, secret: string, issuer = 'FormBuilder'): string {
    return generateURI({ issuer, label: accountEmail, secret });
  }

  /**
   * Verify a user-supplied 6-digit code.
   * Returns a plain boolean — never leak the result object to callers.
   */
  async verifyToken(token: string, secret: string): Promise<boolean> {
    // Reject obviously malformed input before doing crypto work.
    if (!/^\d{6}$/.test(token?.trim() ?? '')) return false;

    try {
      const result = await verify({
        secret,
        token: token.trim(),
        period: PERIOD_SECONDS,
        epochTolerance: EPOCH_TOLERANCE,
      });
      return result.valid === true;
    } catch {
      // A malformed/undecodable secret must fail closed, never throw into the
      // request path where it could be mistaken for a server error.
      return false;
    }
  }
}
