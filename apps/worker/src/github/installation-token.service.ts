import { Injectable, Inject } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';
import type { Redis } from 'ioredis';
import type { Logger as PinoLogger } from 'pino';
import { AppAuth } from '@repo/github';

/**
 * Format stored in Redis: `<iv-hex>:<authTag-hex>:<ciphertext-hex>`
 * All three components are concatenated with colons for easy splitting.
 */
const ENCRYPTED_TOKEN_DELIMITER = ':';
const IV_LENGTH = 12; // 96-bit IV recommended for AES-256-GCM
const AUTH_TAG_LENGTH = 16; // 128-bit authentication tag
const KEY_BYTE_LENGTH = 32; // 256-bit key for AES-256

/**
 * Provides installation access tokens with:
 * 1. Redis caching at key `token:{installationId}` with TTL = expiry − 5 minutes
 * 2. AES-256-GCM encryption at rest (SEC-003)
 * 3. No raw token ever appearing in logs (SEC-008)
 *
 * The encryption key is sourced from `TOKEN_ENCRYPTION_KEY` (64 hex chars = 32 bytes).
 * Validated at construction time to fail fast on misconfiguration.
 */
@Injectable()
export class InstallationTokenService {
  private readonly encryptionKey: Buffer;

  constructor(
    @Inject('REDIS_CACHE')
    private readonly redis: Redis,
    @Inject('APP_AUTH')
    private readonly appAuth: AppAuth,
    @Inject('PINO_LOGGER')
    private readonly logger: PinoLogger,
    @Inject('TOKEN_ENCRYPTION_KEY')
    tokenEncryptionKey: string,
  ) {
    // SEC-003: Validate key length at startup — fail fast if misconfigured.
    if (tokenEncryptionKey.length !== 64) {
      throw new Error(
        `TOKEN_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). ` +
          `Got ${String(tokenEncryptionKey.length)} characters.`,
      );
    }

    if (!/^[0-9a-fA-F]{64}$/.test(tokenEncryptionKey)) {
      throw new Error(
        'TOKEN_ENCRYPTION_KEY must contain only hex characters (0-9, a-f, A-F).',
      );
    }

    this.encryptionKey = Buffer.from(tokenEncryptionKey, 'hex');

    if (this.encryptionKey.length !== KEY_BYTE_LENGTH) {
      throw new Error(
        `Unexpected key byte length after hex decode: ${String(this.encryptionKey.length)}. Expected ${String(KEY_BYTE_LENGTH)}.`,
      );
    }
  }

  /**
   * Returns a valid installation access token.
   *
   * Flow:
   * 1. Check Redis cache — if hit, decrypt and return.
   * 2. On cache miss, call GitHub API for a fresh token.
   * 3. Encrypt the token with AES-256-GCM.
   * 4. Cache in Redis with TTL = token expiry − 5 minutes.
   *
   * SEC-008: Raw token is NEVER passed to any logger call.
   */
  async getInstallationToken(installationId: number): Promise<string> {
    const cacheKey = `token:${installationId}`;

    const cachedValue = await this.redis.get(cacheKey);
    if (cachedValue !== null) {
      this.logger.debug(
        { installationId },
        'installation token cache hit — decrypting',
      );
      return this.decrypt(cachedValue);
    }

    this.logger.debug(
      { installationId },
      'installation token cache miss — fetching from GitHub',
    );

    const token = await this.appAuth.getInstallationToken(installationId);

    // Calculate TTL: token expiry (60 min) minus 5-minute buffer = 55 minutes.
    // AppAuth in-memory cache returns a token with ~60 min lifetime.
    // We subtract 5 minutes for clock skew / processing margin.
    const ttlSeconds = 55 * 60;

    const encrypted = this.encrypt(token);
    await this.redis.set(cacheKey, encrypted, 'EX', ttlSeconds);

    this.logger.debug(
      { installationId, ttlSeconds },
      'installation token cached (encrypted)',
    );

    // SEC-008: token is returned but never appears in a log field.
    return token;
  }

  /**
   * Evicts a cached token. Call when a 401 is received from GitHub API
   * to force a fresh token exchange on the next request.
   */
  async evictToken(installationId: number): Promise<void> {
    await this.redis.del(`token:${installationId}`);
    this.logger.info(
      { installationId },
      'installation token evicted from cache',
    );
  }

  /**
   * Encrypts a plaintext string using AES-256-GCM.
   * Returns `<iv-hex>:<authTag-hex>:<ciphertext-hex>`.
   */
  private encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);

    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    const authTag = cipher.getAuthTag();

    return [
      iv.toString('hex'),
      authTag.toString('hex'),
      encrypted.toString('hex'),
    ].join(ENCRYPTED_TOKEN_DELIMITER);
  }

  /**
   * Decrypts an AES-256-GCM ciphertext string in `<iv>:<authTag>:<ciphertext>` format.
   * Throws if the authentication tag verification fails (tampered data).
   */
  private decrypt(stored: string): string {
    const parts = stored.split(ENCRYPTED_TOKEN_DELIMITER);
    if (parts.length !== 3) {
      throw new Error(
        `Malformed encrypted token format: expected 3 colon-delimited parts, got ${String(parts.length)}.`,
      );
    }

    const ivHex = parts[0];
    const authTagHex = parts[1];
    const ciphertextHex = parts[2];

    if (
      ivHex === undefined ||
      authTagHex === undefined ||
      ciphertextHex === undefined
    ) {
      throw new Error('Malformed encrypted token: missing component.');
    }

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const ciphertext = Buffer.from(ciphertextHex, 'hex');

    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  }
}
