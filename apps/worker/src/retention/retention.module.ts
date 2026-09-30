import { Module } from '@nestjs/common';
import { RetentionService } from './retention.service.js';
import { WorkerDbModule } from '../db/db.module.js';

/**
 * Provides data retention scheduling for the worker.
 *
 * RetentionService purges review_runs and cascaded findings older than
 * 90 days. Scheduled nightly at ~03:00 UTC via setInterval.
 */
@Module({
  imports: [WorkerDbModule],
  providers: [RetentionService],
  exports: [RetentionService],
})
export class RetentionModule {}
