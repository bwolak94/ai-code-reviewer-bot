import { Module } from '@nestjs/common';
import { Redis } from 'ioredis';
import { getEnv } from '../config/env.js';

/**
 * Provides two ioredis client instances:
 *
 * - REDIS_QUEUE  (port 6379, noeviction) — used by DedupService and BullMQ.
 * - REDIS_CACHE  (port 6380, allkeys-lru) — used by token cache, base-graph cache.
 *
 * SEC-002 / INCONSISTENCY-03 fix: Two separate Redis instances are required.
 * A single Redis instance with allkeys-lru eviction would silently evict BullMQ
 * job state under memory pressure, causing lost review jobs. The queue instance
 * must use noeviction to preserve job durability.
 *
 * Passwords are injected via environment variables (SEC-002): never hardcoded.
 */
@Module({
  providers: [
    {
      provide: 'REDIS_QUEUE',
      useFactory: (): Redis => {
        const env = getEnv();
        const client = new Redis(env.REDIS_QUEUE_URL, {
          lazyConnect: true,
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
        });
        return client;
      },
    },
    {
      provide: 'REDIS_CACHE',
      useFactory: (): Redis => {
        const env = getEnv();
        const client = new Redis(env.REDIS_CACHE_URL, {
          lazyConnect: true,
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
        });
        return client;
      },
    },
  ],
  exports: ['REDIS_QUEUE', 'REDIS_CACHE'],
})
export class RedisModule {}
