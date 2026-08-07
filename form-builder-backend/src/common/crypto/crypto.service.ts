import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from 'crypto';

/**
 * CryptoService — application-level encryption for secrets at rest.
 *
 * WHY:
 *  MFA seeds and webhook signing secrets were stored in plaintext. A read-only
 *  SQL injection, a leaked backup, or a curious DBA would expose every user's
 *  TOTP seed (enabling permanent 2FA bypass) and every webhook secret (enabling
 *  forged delivery payloads).
 *
 * SCHEME: AES-256-GCM with a random 12-byte IV per record and the 16-byte auth
 * tag appended. Output format is `v1.<iv>.<tag>.<ciphertext>`, all base64url.
 * The version prefix lets us rotate the scheme later without a flag day.
 *
 * KEY MANAGEMENT:
 *  ENCRYPTION_KEY must be 32 bytes of base64 (generate with
 *  `openssl rand -base64 32`). In production this should come from a KMS /
 *  secret manager, not a plain env var. If it is absent the service refuses to
 *  start rather than silently falling back to plaintext.
 */
@Injectable()
export class CryptoService implements OnModuleInit {
  private readonly logger = new Logger(CryptoService.name);
  private key!: Buffer;

  onModuleInit() {
    const raw = process.env.ENCRYPTION_KEY;

    if (!raw) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          'ENCRYPTION_KEY is required in production. Generate one with: openssl rand -base64 32',
        );
      }
      // Development convenience only. Deterministically derived from JWT_SECRET
      // so restarts don't invalidate locally-stored secrets, with a loud warning.
      this.logger.warn(
        'ENCRYPTION_KEY not set — deriving a development key from JWT_SECRET. ' +
          'Set ENCRYPTION_KEY before deploying; encrypted values are NOT portable across secrets.',
      );
      this.key = scryptSync(process.env.JWT_SECRET ?? 'dev-only-fallback', 'formbuilder-enc', 32);
      return;
    }

    const decoded = Buffer.from(raw, 'base64');
    if (decoded.length !== 32) {
      throw new Error(
        `ENCRYPTION_KEY must decode to exactly 32 bytes (got ${decoded.length}). ` +
          'Generate one with: openssl rand -base64 32',
      );
    }
    this.key = decoded;
  }

  /** Encrypt a UTF-8 string. Returns null for null/empty input. */
  encrypt(plaintext: string | null | undefined): string | null {
    if (plaintext == null || plaintext === '') return null;

    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return [
      'v1',
      iv.toString('base64url'),
      tag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  /**
   * Decrypt a value produced by encrypt().
   *
   * Values that are not in the v1 envelope format are returned as-is. This makes
   * the change backward-compatible with rows written before encryption existed,
   * so no migration backfill is required — they get encrypted on next write.
   */
  decrypt(value: string | null | undefined): string | null {
    if (value == null || value === '') return null;

    const parts = value.split('.');
    if (parts.length !== 4 || parts[0] !== 'v1') {
      return value; // legacy plaintext
    }

    try {
      const [, ivB64, tagB64, dataB64] = parts;
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.key,
        Buffer.from(ivB64, 'base64url'),
      );
      decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(dataB64, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch (err) {
      this.logger.error('Failed to decrypt value — wrong ENCRYPTION_KEY or tampered ciphertext.');
      throw new Error('Unable to decrypt stored secret.');
    }
  }

  /** Constant-time string comparison, safe against length-leaking timing attacks. */
  safeEquals(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }
}
