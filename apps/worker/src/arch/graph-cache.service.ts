import { Injectable, Inject } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { Logger as PinoLogger } from 'pino';
import { getWorkerEnv } from '../config/env.js';
import type { RuleViolation } from '@repo/arch-graph';

const GRAPH_CACHE_TTL_SECONDS = 604_800; // 7 days

interface StoredCacheEntry {
  data: string;
  hmac: string;
}

/**
 * Provides HMAC-signed caching of base graph violation results in Redis.
 *
 * SEC-023: The serialised base graph is signed with an HMAC key derived from
 * GITHUB_WEBHOOK_SECRET, namespaced to prevent cross-use between different
 * Redis values. The HMAC is verified on retrieval; mismatches result in a
 * cache miss + warning log.
 *
 * The HMAC key is derived in the constructor:
 * createHmac('sha256', webhookSecret).update('graph-cache-v1').digest('hex')
 *
 * This is intentionally NOT the raw webhook secret to prevent cross-use.
 */
@Injectable()
export class GraphCacheService {
  // HIGH-4: Store as Buffer (not hex string) to halve heap footprint of
  // sensitive material and avoid a hex-decode on every HMAC computation.
  private readonly hmacKey: Buffer;

  constructor(
    @Inject('REDIS_CACHE')
    private readonly redis: Redis,
    @Inject('PINO_LOGGER')
    private readonly logger: PinoLogger,
  ) {
    const env = getWorkerEnv();
    // SEC-023: Derive a namespaced HMAC key from the webhook secret.
    // Never use the raw webhook secret directly — namespace it so the key
    // cannot be used interchangeably with other HMAC operations.
    this.hmacKey = createHmac('sha256', env.GITHUB_WEBHOOK_SECRET)
      .update('graph-cache-v1')
      .digest(); // Returns Buffer directly
  }

  /**
   * Attempts to retrieve cached base graph violations from Redis.
   *
   * On cache hit: verifies HMAC integrity before returning the violations.
   * On HMAC mismatch: logs a warning and returns null (treat as cache miss).
   * On cache miss: returns null.
   */
  async getBaseGraph(
    repoId: number,
    baseSha: string,
  ): Promise<RuleViolation[] | null> {
    const key = this.buildKey(repoId, baseSha);

    const raw = await this.redis.get(key);
    if (raw === null) {
      return null;
    }

    let entry: StoredCacheEntry;
    try {
      entry = JSON.parse(raw) as StoredCacheEntry;
    } catch {
      this.logger.warn({ key }, 'graph-cache: failed to parse cache entry JSON');
      return null;
    }

    // Verify HMAC integrity
    const expectedHmac = this.computeHmac(entry.data);
    const expectedBuf = Buffer.from(expectedHmac, 'hex');
    const actualBuf = Buffer.from(entry.hmac, 'hex');

    // Ensure same length before timingSafeEqual to avoid throwing
    if (expectedBuf.length !== actualBuf.length) {
      this.logger.warn(
        { key },
        'graph-cache: HMAC length mismatch — cache entry rejected (SEC-023)',
      );
      return null;
    }

    const isValid = timingSafeEqual(expectedBuf, actualBuf);
    if (!isValid) {
      this.logger.warn(
        { key },
        'graph-cache: HMAC verification failed — cache entry rejected (SEC-023)',
      );
      return null;
    }

    try {
      return JSON.parse(entry.data) as RuleViolation[];
    } catch {
      this.logger.warn({ key }, 'graph-cache: failed to parse violation data');
      return null;
    }
  }

  /**
   * Stores base graph violations in Redis with an HMAC signature.
   * TTL: 7 days (604800 seconds).
   */
  async setBaseGraph(
    repoId: number,
    baseSha: string,
    violations: RuleViolation[],
  ): Promise<void> {
    const key = this.buildKey(repoId, baseSha);
    const data = JSON.stringify(violations);
    const hmac = this.computeHmac(data);

    const entry: StoredCacheEntry = { data, hmac };
    await this.redis.set(key, JSON.stringify(entry), 'EX', GRAPH_CACHE_TTL_SECONDS);
  }

  private buildKey(repoId: number, baseSha: string): string {
    // LOW-5: Validate baseSha is a plausible git SHA before embedding in key.
    if (!/^[0-9a-f]{7,40}$/i.test(baseSha)) {
      throw new Error(`Invalid baseSha format: "${baseSha}"`);
    }
    return `bgraph:${repoId}:${baseSha}`;
  }

  private computeHmac(data: string): string {
    return createHmac('sha256', this.hmacKey).update(data).digest('hex');
  }
}
