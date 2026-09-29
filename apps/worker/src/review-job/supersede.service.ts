import { Injectable, Inject } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue, Job } from 'bullmq';
import type { Logger as PinoLogger } from 'pino';
import type { ReviewJobPayload } from '@repo/db';

/**
 * Cancels stale review jobs for the same PR when a newer head SHA arrives.
 *
 * When GitHub fires synchronize/push events on a PR, multiple jobs may be
 * enqueued in quick succession. This service implements the
 * `queued → superseded` transition (plan.md Section 5).
 *
 * A job is considered stale if:
 *   - Its jobId prefix matches `${installationId}:${repositoryId}:${prNumber}:`
 *   - Its headSha differs from the current (newer) job's headSha
 */
@Injectable()
export class SupersedeService {
  constructor(
    @InjectQueue('review')
    private readonly queue: Queue<ReviewJobPayload>,
    @Inject('PINO_LOGGER')
    private readonly logger: PinoLogger,
  ) {}

  /**
   * Cancels all waiting/delayed jobs for the same PR that have a different headSha.
   *
   * @param installationId - GitHub App installation ID
   * @param repositoryId   - GitHub repository ID
   * @param prNumber       - Pull request number
   * @param currentHeadSha - The headSha of the currently processing job (keep this)
   */
  async cancelStalePrJobs(
    installationId: number,
    repositoryId: number,
    prNumber: number,
    currentHeadSha: string,
  ): Promise<void> {
    const prefix = `${installationId}:${repositoryId}:${prNumber}:`;

    // Fetch all jobs in waiting + delayed states — these can still be cancelled.
    const jobs = await this.queue.getJobs(['waiting', 'delayed']);

    const staleJobs: Job<ReviewJobPayload>[] = jobs.filter((job) => {
      const jobId = job.opts.jobId;
      if (typeof jobId !== 'string') {
        return false;
      }
      // Only consider jobs with the same PR prefix.
      if (!jobId.startsWith(prefix)) {
        return false;
      }
      // Keep the job if it matches the current headSha (same commit, no-op).
      return job.data.headSha !== currentHeadSha;
    });

    for (const staleJob of staleJobs) {
      try {
        await staleJob.remove();
        this.logger.info(
          {
            jobId: staleJob.opts.jobId,
            staleSha: staleJob.data.headSha,
            currentSha: currentHeadSha,
            installationId,
            repositoryId,
            prNumber,
          },
          'superseded stale review job removed',
        );
      } catch (err) {
        // Race condition: the job may have already been picked up by another worker.
        // Log as warn but do not rethrow — this is a best-effort cancellation.
        this.logger.warn(
          {
            jobId: staleJob.opts.jobId,
            err,
          },
          'failed to remove stale job — may have already been processed',
        );
      }
    }
  }
}
