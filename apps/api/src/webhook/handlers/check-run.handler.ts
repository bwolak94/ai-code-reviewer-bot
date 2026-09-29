import { Injectable, Inject } from '@nestjs/common';
import type { Logger as PinoLogger } from 'pino';
import type { Redis } from 'ioredis';
import { ReviewRunRepository } from '@repo/db';
import { ReviewQueueService } from '../../queue/review-queue.service.js';

interface CheckRunRerequestedPayload {
  action: string;
  installation?: { id: number };
  repository?: { id: number; full_name: string };
  check_run?: {
    id: number;
    head_sha: string;
    name: string;
  };
}

/** TTL (seconds) for the re-request dedup key — prevents duplicate re-runs within 5 min. */
const REREQUEST_DEDUP_TTL_SECONDS = 300;

/**
 * Handles `check_run.rerequested` webhook events.
 *
 * When a user clicks "Re-run" on a GitHub Check Run, this handler looks up the
 * original review_run row by its checkRunId and re-enqueues the job with the
 * same payload so the review can be performed again.
 *
 * **Note on baseRef / headRef**: The `review_runs` table stores only `baseSha`
 * and `headSha`, not the branch ref names. When re-enqueuing, the SHAs are
 * used as ref values. This is sufficient for the shallow-clone step (which
 * accepts a commit SHA), though symbolic ref names are unavailable.
 */
@Injectable()
export class CheckRunHandler {
  constructor(
    @Inject('PINO_LOGGER')
    private readonly logger: PinoLogger,
    @Inject('REDIS_CACHE')
    private readonly redis: Redis,
    private readonly reviewRunRepository: ReviewRunRepository,
    private readonly reviewQueueService: ReviewQueueService,
  ) {}

  async handle(payload: unknown): Promise<void> {
    const p = payload as CheckRunRerequestedPayload;

    if (p.action !== 'rerequested') {
      return;
    }

    const installationId = p.installation?.id;
    const repositoryId = p.repository?.id;
    const checkRunId = p.check_run?.id;

    if (
      installationId === undefined ||
      repositoryId === undefined ||
      checkRunId === undefined
    ) {
      this.logger.warn(
        { action: p.action, installationId, repositoryId, checkRunId },
        'check_run.rerequested payload missing required fields — skipping',
      );
      return;
    }

    try {
      // Rate-limit / dedup: prevent duplicate re-runs within the TTL window.
      const dedupeKey = `rerequest:${checkRunId}`;
      const acquired = await this.redis.set(
        dedupeKey,
        '1',
        'EX',
        REREQUEST_DEDUP_TTL_SECONDS,
        'NX',
      );

      if (acquired === null) {
        this.logger.warn(
          { checkRunId, installationId },
          'check_run.rerequested: duplicate re-request within dedup window — skipping',
        );
        return;
      }

      // Look up the original review run by checkRunId.
      const run = await this.reviewRunRepository.findRunByCheckRunId(checkRunId);

      if (run === undefined) {
        this.logger.warn(
          { checkRunId, installationId, repositoryId },
          'check_run.rerequested: no review_run found for checkRunId — skipping re-enqueue',
        );
        return;
      }

      this.logger.info(
        {
          checkRunId,
          runId: run.id,
          installationId,
          repositoryId,
          prNumber: run.prNumber,
          headSha: run.headSha,
        },
        'check_run.rerequested: re-enqueuing review job',
      );

      await this.reviewQueueService.enqueueReviewJob({
        installationId,
        repositoryId,
        prNumber: run.prNumber,
        baseSha: run.baseSha,
        headSha: run.headSha,
        // baseRef and headRef are not stored on review_runs; SHAs are used as ref fallback.
        baseRef: run.baseSha,
        headRef: run.headSha,
        enqueuedAt: new Date().toISOString(),
      });
    } catch (err) {
      this.logger.error(
        { err, checkRunId, installationId },
        'check_run.rerequested: error processing re-request',
      );
    }
  }
}
