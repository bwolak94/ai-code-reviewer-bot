import { Inject } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import type { Logger as PinoLogger } from 'pino';
import { ReviewRunRepository, withTenantContext } from '@repo/db';
import type { ReviewJobPayload, DrizzleDb } from '@repo/db';
import { SupersedeService } from './supersede.service.js';
import { CloneService } from '../clone/clone.service.js';
import { WorkspaceService } from '../clone/workspace.service.js';
import { DiffFilterService } from '../diff/diff-filter.service.js';
import { InstallationTokenService } from '../github/installation-token.service.js';

/**
 * BullMQ job processor for the 'review' queue.
 *
 * Processing steps (per plan.md Section 15):
 * 1. Cancel stale PR jobs (supersede logic)
 * 2. Get an installation token (with encrypted Redis cache)
 * 3. Create an ephemeral workspace directory
 * 4. Shallow-clone the repository
 * 5. Filter the diff (strip generated/lock files, check size ceiling)
 * 6. Persist a ReviewRun row in PostgreSQL with status 'running'
 * 7. (M3+) Invoke arch-graph and llm-review packages
 *
 * The workspace is always cleaned up in a finally block (WorkspaceService).
 */
@Processor('review')
export class ReviewJobProcessor extends WorkerHost {
  constructor(
    @Inject('PINO_LOGGER')
    private readonly logger: PinoLogger,
    @Inject('DRIZZLE_DB')
    private readonly db: DrizzleDb,
    private readonly supersedeService: SupersedeService,
    private readonly installationTokenService: InstallationTokenService,
    private readonly workspaceService: WorkspaceService,
    private readonly cloneService: CloneService,
    private readonly diffFilterService: DiffFilterService,
    private readonly reviewRunRepository: ReviewRunRepository,
  ) {
    super();
  }

  /**
   * Exposes the underlying BullMQ Worker's pause() method so that the SIGTERM
   * handler in main.ts can call it before app.close(). BullMQ semantics:
   * pause() stops fetching new jobs but allows in-flight jobs to complete,
   * which is the correct first step for graceful shutdown.
   */
  async pauseWorker(): Promise<void> {
    await this.worker.pause();
  }

  async process(job: Job<ReviewJobPayload>): Promise<void> {
    const {
      installationId,
      repositoryId,
      prNumber,
      baseSha,
      headSha,
      baseRef,
      headRef,
    } = job.data;

    const jobId = job.id ?? 'unknown';

    this.logger.info(
      { jobId, installationId, repositoryId, prNumber, headSha },
      'review job started',
    );

    // Step 1: Cancel stale jobs for the same PR prefix.
    await this.supersedeService.cancelStalePrJobs(
      installationId,
      repositoryId,
      prNumber,
      headSha,
    );

    // Step 2: Obtain a valid installation token (encrypted Redis cache).
    const token = await this.installationTokenService.getInstallationToken(
      installationId,
    );

    // Step 3+: Create workspace, clone, diff — cleanup guaranteed via finally.
    const workspace = await this.workspaceService.create(jobId);

    try {
      // Step 4: Shallow-clone the head ref.
      // The base is needed for diff computation — we clone the head and use
      // `git fetch` to get the base SHA without a separate full clone.
      const { repoDir } = await this.cloneService.clone(
        // owner/repo is resolved by deriving it from the repository — in M3 this
        // will query the DB. For now we embed a placeholder that tests can mock.
        await this.resolveOwnerRepo(repositoryId),
        await this.resolveRepoName(repositoryId),
        headRef,
        token,
        workspace.dir,
      );

      // Step 5: Filter the diff.
      // TODO(M3): Load per-repo config from .github/ai-review.yml via
      // @repo/config and forward config.review.ignore globs here. Until
      // M3 the DiffFilterService only applies DEFAULT_IGNORE_GLOBS.
      const diffResult = await this.diffFilterService.filter(
        repoDir,
        baseSha,
        headSha,
        [], // M3: replace with configLoader.load(repoDir).review.ignore
      );

      // Step 6: Persist the ReviewRun with status 'running'.
      // withTenantContext sets SET LOCAL app.current_installation_id so that
      // PostgreSQL RLS policies apply correctly for multi-tenant isolation.
      await withTenantContext(this.db, installationId, async () => {
        await this.reviewRunRepository.createRun({
          repositoryId,
          prNumber,
          baseSha,
          headSha,
          status: 'running',
        });
      });

      this.logger.info(
        {
          jobId,
          installationId,
          repositoryId,
          prNumber,
          headSha,
          filteredFiles: diffResult.filteredFiles.length,
          summaryOnlyMode: diffResult.summaryOnlyMode,
        },
        'review job pipeline stage complete — awaiting M3 LLM review',
      );
    } finally {
      // Always clean up the workspace regardless of success or failure.
      await workspace.cleanup();
    }
  }

  /**
   * Placeholder for M3: resolves the owner (org/user) from the repository ID.
   * In M3 this will be a DB query joining repositories → installations.
   */
  private async resolveOwnerRepo(repositoryId: number): Promise<string> {
    void repositoryId;
    // TODO(M3): Query InstallationRepository for owner.
    return 'unknown-owner';
  }

  private async resolveRepoName(repositoryId: number): Promise<string> {
    void repositoryId;
    // TODO(M3): Query InstallationRepository for repo name.
    return 'unknown-repo';
  }
}
