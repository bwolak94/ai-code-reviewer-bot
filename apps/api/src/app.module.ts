import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import type { Redis } from 'ioredis';
import { WebhookModule } from './webhook/webhook.module.js';
import { InstallationModule } from './installation/installation.module.js';
import { HealthModule } from './health/health.module.js';
import { LoggerModule } from './logger/logger.module.js';
import { RedisModule } from './redis/redis.module.js';
import { DbModule } from './db/db.module.js';
import { MetricsModule } from './metrics/metrics.module.js';
import { getEnv } from './config/env.js';

/**
 * Root application module.
 *
 * Module hierarchy:
 * - LoggerModule    — provides PINO_LOGGER token (SEC-008 redaction configured here)
 * - RedisModule     — provides REDIS_QUEUE and REDIS_CACHE ioredis clients
 * - ThrottlerModule — global rate limiting (SEC-001); 120 req / 60 s per installation
 * - WebhookModule   — POST /webhooks/github (HMAC guard, dedup, routing)
 * - InstallationModule — installation lifecycle (guarded by WebhookGuard per SEC-021)
 * - HealthModule    — GET /health
 */
@Module({
  imports: [
    LoggerModule,
    RedisModule,
    DbModule,
    MetricsModule,
    // SEC-001: global rate-limit configuration. Limits are intentionally generous
    // (2 req/sec average) to accommodate burst delivery from GitHub while
    // preventing a single misbehaving installation from exhausting resources.
    // WebhookThrottlerGuard in WebhookController uses per-installation bucketing.
    // Redis-backed storage (via REDIS_CACHE) ensures limits are enforced across
    // all horizontally-scaled API pods, not just within a single process.
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: ['REDIS_CACHE'],
      useFactory: (redis: Redis) => ({
        throttlers: [
          {
            ttl: 60_000, // milliseconds — 60-second sliding window
            limit: 120,  // max requests per window per tracked key
          },
        ],
        storage: new ThrottlerStorageRedisService(redis),
      }),
    }),
    WebhookModule,
    InstallationModule,
    HealthModule,
  ],
  providers: [
    {
      provide: 'APP_ENV',
      useFactory: () => getEnv(),
    },
  ],
  exports: ['APP_ENV'],
})
export class AppModule {}
