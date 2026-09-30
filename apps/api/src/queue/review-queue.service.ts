import { Injectable, Inject } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { Logger as PinoLogger } from 'pino';
import type { Counter } from 'prom-client';
import type { ReviewJobPayload } from '@repo/db';
import { METRIC_JOB_ENQUEUED } from '../metrics/metrics.module.js';

/**
 * Enqueues review jobs onto the BullMQ 'review' queue.
 *
 * SEC-004: The job payload contains ONLY IDs — no display names, full repository
 * names, or account logins. These are resolved from the database inside the worker.
 *
 * BullMQ dedup strategy: jobId = `${installationId}_${repositoryId}_${prNumber}_${headSha}`
 * If the same (installation, repo, PR, SHA) tuple is enqueued twice, BullMQ will
 * silently ignore the second add (natural idempotency via jobId uniqueness).
 */
@Injectable()
export class ReviewQueueService {
  constructor(
    @InjectQueue('review')
    private readonly queue: Queue<ReviewJobPayload>,
    @Inject('PINO_LOGGER')
    private readonly logger: PinoLogger,
    @Inject(METRIC_JOB_ENQUEUED)
    private readonly metricJobEnqueued: Counter,
  ) {}

  /**
   * Adds a review job to the queue. Idempotent — duplicate jobIds are ignored.
   */
  async enqueueReviewJob(payload: ReviewJobPayload): Promise<void> {
    const jobId = buildJobId(payload);

    await this.queue.add('review', payload, {
      jobId,
      removeOnComplete: 100,
      removeOnFail: 200,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5_000,
      },
    });

    this.logger.info(
      {
        jobId,
        installationId: payload.installationId,
        repositoryId: payload.repositoryId,
        prNumber: payload.prNumber,
        headSha: payload.headSha,
      },
      'review job enqueued',
    );

    this.metricJobEnqueued.inc({ repository_id: String(payload.repositoryId) });
  }
}

/**
 * Builds the deterministic BullMQ jobId for a review payload.
 * Exported for use in tests and the worker's supersede logic.
 */
export function buildJobId(payload: ReviewJobPayload): string {
  return `${payload.installationId}_${payload.repositoryId}_${payload.prNumber}_${payload.headSha}`;
}
