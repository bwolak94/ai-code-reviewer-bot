import { Module } from '@nestjs/common';
import { WebhookModule } from './webhook/webhook.module.js';
import { InstallationModule } from './installation/installation.module.js';
import { HealthModule } from './health/health.module.js';
import { LoggerModule } from './logger/logger.module.js';
import { RedisModule } from './redis/redis.module.js';
import { getEnv } from './config/env.js';

/**
 * Root application module.
 *
 * Module hierarchy:
 * - LoggerModule    — provides PINO_LOGGER token (SEC-008 redaction configured here)
 * - RedisModule     — provides REDIS_QUEUE and REDIS_CACHE ioredis clients
 * - WebhookModule   — POST /webhooks/github (HMAC guard, dedup, routing)
 * - InstallationModule — installation lifecycle (guarded by WebhookGuard per SEC-021)
 * - HealthModule    — GET /health
 */
@Module({
  imports: [
    LoggerModule,
    RedisModule,
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
