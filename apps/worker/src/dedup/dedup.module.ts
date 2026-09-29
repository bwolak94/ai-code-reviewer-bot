import { Module } from '@nestjs/common';
import { FindingDedupService } from './dedup.service.js';
import { FeedbackRepository, FindingRepository } from '@repo/db';
import { WorkerDbModule } from '../db/db.module.js';

/**
 * Provides DedupService and its required repositories for finding deduplication.
 *
 * Depends on WorkerDbModule for DRIZZLE_DB and the FindingRepository token.
 * Provides FeedbackRepository and FEEDBACK_REPOSITORY / FINDING_REPOSITORY tokens
 * used by DedupService via @Inject().
 */
@Module({
  imports: [WorkerDbModule],
  providers: [
    {
      provide: 'FINDING_REPOSITORY',
      useExisting: FindingRepository,
    },
    {
      provide: 'FEEDBACK_REPOSITORY',
      useFactory: (db: ReturnType<typeof import('@repo/db').createDb>['db']) =>
        new FeedbackRepository(db),
      inject: ['DRIZZLE_DB'],
    },
    FindingDedupService,
  ],
  exports: [FindingDedupService, 'FEEDBACK_REPOSITORY'],
})
export class DedupModule {}
