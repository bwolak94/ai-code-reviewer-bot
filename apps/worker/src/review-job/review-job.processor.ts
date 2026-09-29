import path from 'node:path';
import { Inject } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import type { Logger as PinoLogger } from 'pino';
import {
  ReviewRunRepository,
  FindingRepository,
  withTenantContext,
} from '@repo/db';
import type { ReviewJobPayload, DrizzleDb, NewFinding } from '@repo/db';
import {
  buildGraph,
  evaluateRules,
  graphDelta,
} from '@repo/arch-graph';
import { loadConfig } from '@repo/config';
import { publishCheckRunAnnotations, determineConclusion } from '@repo/github';
import { Octokit } from '@octokit/rest';
import { SupersedeService } from './supersede.service.js';
import { CloneService } from '../clone/clone.service.js';
import { WorkspaceService } from '../clone/workspace.service.js';
import { DiffFilterService } from '../diff/diff-filter.service.js';
import { InstallationTokenService } from '../github/installation-token.service.js';
import { GraphCacheService } from '../arch/graph-cache.service.js';

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
 * 7. Load per-repo config from .github/ai-review.yml
 * 8. Build base graph (cache hit or rebuild)
 * 9. Build head graph
 * 10. Compute graph delta (new violations only)
 * 11. Publish check run annotations
 * 12. Persist findings to DB
 * 13. Update ReviewRun status to 'completed'
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
    private readonly findingRepository: FindingRepository,
    private readonly graphCacheService: GraphCacheService,
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

    let runId: string | undefined;

    try {
      // Resolve owner and repo name from DB
      const owner = await this.resolveOwnerRepo(repositoryId);
      const repoName = await this.resolveRepoName(repositoryId);

      // Step 4: Shallow-clone the head ref into a 'head' subdirectory.
      const { repoDir: headDir } = await this.cloneService.clone(
        owner,
        repoName,
        headRef,
        token,
        path.join(workspace.dir, 'head'),
      );

      // Step 7: Load per-repo config from .github/ai-review.yml.
      const config = loadConfig(headDir);

      // Step 5: Filter the diff using config ignore patterns.
      const diffResult = await this.diffFilterService.filter(
        headDir,
        baseSha,
        headSha,
        config.review.ignore,
      );

      // Step 6: Persist the ReviewRun with status 'running'.
      const run = await withTenantContext(this.db, installationId, async () => {
        return this.reviewRunRepository.createRun({
          repositoryId,
          prNumber,
          baseSha,
          headSha,
          status: 'running',
        });
      });

      runId = run.id;

      // Step 8: Get or build base graph violations.
      let baseViolations = await this.graphCacheService.getBaseGraph(
        repositoryId,
        baseSha,
      );

      if (baseViolations === null) {
        this.logger.debug(
          { repositoryId, baseSha },
          'graph-cache miss — cloning base ref and building base graph',
        );

        // CRIT-3: Clone the base ref into a separate subdirectory so the base
        // graph is built from the actual base commit, not the head checkout.
        const { repoDir: baseDir } = await this.cloneService.clone(
          owner,
          repoName,
          baseRef,
          token,
          path.join(workspace.dir, 'base'),
        );

        const baseGraph = buildGraph({
          workspaceDir: baseDir,
          tsconfigPath: config.tsconfig,
          layers: config.layers,
        });

        baseViolations = evaluateRules(baseGraph, config.rules, baseDir);

        await this.graphCacheService.setBaseGraph(
          repositoryId,
          baseSha,
          baseViolations,
        );
      }

      // Step 9: Build head graph.
      const headGraph = buildGraph({
        workspaceDir: headDir,
        tsconfigPath: config.tsconfig,
        layers: config.layers,
      });
      const headViolations = evaluateRules(headGraph, config.rules, headDir);

      // Step 10: Compute delta — only violations new in head.
      const deltaViolations = graphDelta(baseViolations, headViolations);

      this.logger.info(
        {
          jobId,
          installationId,
          repositoryId,
          prNumber,
          headSha,
          filteredFiles: diffResult.filteredFiles.length,
          summaryOnlyMode: diffResult.summaryOnlyMode,
          baseViolations: baseViolations.length,
          headViolations: headViolations.length,
          deltaViolations: deltaViolations.length,
        },
        'graph analysis complete',
      );

      // Step 11: Publish check run annotations.
      const conclusion = determineConclusion(
        deltaViolations,
        config.review.min_severity_inline,
      );

      const octokit = new Octokit({ auth: token });

      // Only publish if we have a check run ID — it may not be set in all flows.
      const checkRunId = run.checkRunId;
      if (checkRunId !== null && checkRunId !== undefined) {
        await publishCheckRunAnnotations({
          octokit,
          owner,
          repo: repoName,
          checkRunId,
          violations: deltaViolations,
          conclusion,
          summaryTitle: 'Architectural Review',
        });
      }

      // Step 12: Persist findings to DB.
      if (deltaViolations.length > 0) {
        const newFindings: NewFinding[] = deltaViolations.map((v) => ({
          runId: run.id,
          fingerprint: v.fingerprint,
          source: 'graph',
          ruleOrCategory: v.rule,
          severity: v.severity,
          file: v.file,
          line: v.line,
          rationale: v.message,
        }));

        await withTenantContext(this.db, installationId, async () => {
          await this.findingRepository.insertFindings(run.id, newFindings);
        });
      }

      // Step 13: Update ReviewRun status to 'completed'.
      await withTenantContext(this.db, installationId, async () => {
        await this.reviewRunRepository.updateRunStatus(run.id, 'completed');
      });

      this.logger.info(
        {
          jobId,
          installationId,
          repositoryId,
          prNumber,
          headSha,
          runId: run.id,
          conclusion,
        },
        'review job completed',
      );
    } catch (err) {
      // Attempt to mark the run as failed if we have a run ID
      // MED-3: Assign to a const so TypeScript can narrow to `string` without a cast.
      const failedRunId = runId;
      if (failedRunId !== undefined) {
        try {
          await withTenantContext(this.db, installationId, async () => {
            await this.reviewRunRepository.updateRunStatus(failedRunId, 'failed');
          });
        } catch (updateErr) {
          this.logger.error(
            { updateErr, runId },
            'failed to update review run status to failed',
          );
        }
      }
      throw err;
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
    // TODO(M4): Query InstallationRepository for owner.
    return 'unknown-owner';
  }

  private async resolveRepoName(repositoryId: number): Promise<string> {
    void repositoryId;
    // TODO(M4): Query InstallationRepository for repo name.
    return 'unknown-repo';
  }
}
