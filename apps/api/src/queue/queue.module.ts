import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { LoggerModule } from '../logger/logger.module.js';
import { ReviewQueueService } from './review-queue.service.js';
import { getEnv } from '../config/env.js';

/**
 * Registers the BullMQ 'review' queue producer.
 *
 * Uses `REDIS_QUEUE_URL` (noeviction Redis, port 6379) — NOT `REDIS_CACHE_URL`.
 * This separation is critical: BullMQ job state must never be evicted by LRU
 * policy (INCONSISTENCY-03 fix).
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: () => {
        const env = getEnv();
        return {
          connection: {
            // ioredis connection options accepted by BullMQ forRoot
            // Parse the URL manually to extract host/port/password for ioredis
            // BullMQ expects an IORedis-compatible connection config
            maxRetriesPerRequest: null,
            ...((): { host: string; port: number; password?: string } => {
              const url = new URL(env.REDIS_QUEUE_URL);
              const result: { host: string; port: number; password?: string } =
                {
                  host: url.hostname,
                  port: parseInt(url.port || '6379', 10),
                };
              if (url.password) {
                result.password = decodeURIComponent(url.password);
              }
              return result;
            })(),
          },
        };
      },
    }),
    BullModule.registerQueue({
      name: 'review',
    }),
    LoggerModule,
  ],
  providers: [ReviewQueueService],
  exports: [ReviewQueueService, BullModule],
})
export class QueueModule {}
