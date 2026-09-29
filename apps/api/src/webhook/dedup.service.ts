import { Injectable, BadRequestException, Inject } from '@nestjs/common';
import type { Redis } from 'ioredis';

/**
 * Validates and deduplicates GitHub webhook delivery IDs using Redis SET NX.
 *
 * SEC-026: The delivery ID is used as part of a Redis key. Without format
 * validation, a crafted value (wildcard `*`, extreme length, control
 * characters) could corrupt the Redis keyspace or exhaust memory.
 *
 * INCONSISTENCY-01 fix: TTL is 86,400 seconds (24h), NOT 3,600 (1h).
 * The implementation-plan.md §8.4 had 3,600 but this conflicts with
 * database-design.md §7.2 (86,400). The security audit INCONSISTENCY-01
 * identifies this; 86,400 is the canonical value.
 */
@Injectable()
export class DedupService {
  /**
   * UUID v4 format: 8-4-4-4-12 hex chars with hyphens.
   * GitHub delivery IDs follow this format exactly.
   */
  private static readonly DELIVERY_ID_PATTERN = /^[0-9a-f-]{36}$/i;
  private static readonly DEDUP_TTL_SECONDS = 86_400;

  constructor(
    @Inject('REDIS_QUEUE')
    private readonly redis: Redis,
  ) {}

  /**
   * Returns `true` if the delivery ID has already been seen (duplicate).
   * Returns `false` if this is the first time the delivery ID is processed
   * and registers it in Redis with a 24-hour TTL.
   *
   * Throws `BadRequestException` (HTTP 400) if the delivery ID does not match
   * the expected UUID format (SEC-026).
   */
  async isDuplicate(deliveryId: string): Promise<boolean> {
    if (!DedupService.DELIVERY_ID_PATTERN.test(deliveryId)) {
      throw new BadRequestException(
        `Invalid X-GitHub-Delivery format: "${deliveryId}". Expected UUID (36 chars, hex + hyphens).`,
      );
    }

    const key = `dedup:delivery:${deliveryId}`;

    // SET key value NX EX ttl: returns 'OK' on first set, null if key existed.
    const result = await this.redis.set(
      key,
      '1',
      'EX',
      DedupService.DEDUP_TTL_SECONDS,
      'NX',
    );

    return result === null;
  }
}
