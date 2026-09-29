import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ReviewJobProcessor } from './review-job.processor.js';
import { SupersedeService } from './supersede.service.js';
import { CloneModule } from '../clone/clone.module.js';
import { DiffModule } from '../diff/diff.module.js';
import { WorkerDbModule } from '../db/db.module.js';
import { GithubModule } from '../github/github.module.js';

/**
 * Registers the BullMQ processor and all supporting services for review job processing.
 *
 * The 'review' queue is registered here so NestJS BullMQ can inject the Queue
 * instance into SupersedeService via @InjectQueue('review').
 *
 * SharedModule is @Global(), so PINO_LOGGER, REDIS_CACHE, etc. are available
 * without explicit import here.
 */
@Module({
  imports: [
    BullModule.registerQueue({
      name: 'review',
    }),
    CloneModule,
    DiffModule,
    WorkerDbModule,
    GithubModule,
  ],
  providers: [ReviewJobProcessor, SupersedeService],
  exports: [SupersedeService],
})
export class ReviewJobModule {}
