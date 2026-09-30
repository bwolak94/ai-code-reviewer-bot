import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ReviewJobModule } from './review-job/review-job.module.js';
import { WorkerHealthController } from './health/worker-health.controller.js';
import { WorkerDbModule } from './db/db.module.js';
import { SharedModule } from './shared/shared.module.js';
import { GithubModule } from './github/github.module.js';
import { ArchModule } from './arch/arch.module.js';
import { WorkerLlmReviewModule } from './llm-review/llm-review.module.js';
import { MetricsModule } from './metrics/metrics.module.js';
import { RetentionModule } from './retention/retention.module.js';
import { getWorkerEnv } from './config/env.js';

/**
 * Root module for the worker application.
 *
 * Module hierarchy:
 * - SharedModule    (@Global) — PINO_LOGGER, REDIS_CACHE, APP_AUTH,
 *                               TOKEN_ENCRYPTION_KEY, SHUTDOWN_STATE
 * - WorkerDbModule  — DRIZZLE_DB, InstallationRepository, ReviewRunRepository
 * - GithubModule    — InstallationTokenService
 * - ReviewJobModule — ReviewJobProcessor, SupersedeService, CloneModule, DiffModule
 * - HealthController — GET /health (port 3001)
 */
@Module({
  imports: [
    SharedModule,
    BullModule.forRootAsync({
      useFactory: () => {
        const env = getWorkerEnv();
        const url = new URL(env.REDIS_QUEUE_URL);
        const connection: {
          host: string;
          port: number;
          password?: string;
          maxRetriesPerRequest: null;
        } = {
          host: url.hostname,
          port: parseInt(url.port || '6379', 10),
          maxRetriesPerRequest: null,
        };
        if (url.password) {
          connection.password = decodeURIComponent(url.password);
        }
        return { connection };
      },
    }),
    WorkerDbModule,
    GithubModule,
    ArchModule,
    ReviewJobModule,
    WorkerLlmReviewModule,
    MetricsModule,
    RetentionModule,
  ],
  controllers: [WorkerHealthController],
})
export class AppModule {}
