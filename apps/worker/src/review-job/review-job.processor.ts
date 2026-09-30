import path from 'node:path';
import { simpleGit } from 'simple-git';
import { createHash } from 'node:crypto';
import { Inject } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import type { Logger as PinoLogger } from 'pino';
import type { Counter, Histogram } from 'prom-client';
import {
  ReviewRunRepository,
  FindingRepository,
  InstallationRepository,
  withTenantContext,
} from '@repo/db';
import type { ReviewJobPayload, DrizzleDb, NewFinding } from '@repo/db';
import {
  buildGraph,
  evaluateRules,
  graphDelta,
} from '@repo/arch-graph';
import { loadConfig } from '@repo/config';
import {
  publishCheckRunAnnotations,
  determineConclusion,
} from '@repo/github';
import type { ViolationForAnnotation } from '@repo/github';
import type { Finding, ReviewConfig } from '@repo/llm-review';
import { Octokit } from '@octokit/rest';
import { SupersedeService } from './supersede.service.js';
import { CloneService } from '../clone/clone.service.js';
import { WorkspaceService } from '../clone/workspace.service.js';
import { DiffFilterService } from '../diff/diff-filter.service.js';
import { InstallationTokenService } from '../github/installation-token.service.js';
import { GraphCacheService } from '../arch/graph-cache.service.js';
import { FindingDedupService } from '../dedup/dedup.service.js';
import { WorkspaceLimitsService } from '../sandbox/workspace-limits.service.js';
import { LlmReviewService } from '../llm-review/llm-review.service.js';
import {
  METRIC_JOB_COMPLETED,
  METRIC_JOB_FAILED,
  METRIC_FINDINGS_TOTAL,
  METRIC_RUN_DURATION,
} from '../metrics/metrics.tokens.js';

const LLM_TRIAGE_THRESHOLD = 0.5;
const LLM_CONFIDENCE_THRESHOLD = 0.7;

/**
 * Generates a stable SHA-256 fingerprint for an LLM finding.
 * Uses source, category, file, line, and the first 80 chars of the title
 * to produce a deterministic 64-char hex string.
 */
function computeLlmFingerprint(finding: Finding): string {
  return createHash('sha256')
    .update(`llm:${finding.category}:${finding.file}:${finding.line}:${finding.title.slice(0, 80)}`)
    .digest('hex');
}

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
    private readonly findingDedupService: FindingDedupService,
    private readonly workspaceLimitsService: WorkspaceLimitsService,
    private readonly installationRepository: InstallationRepository,
    private readonly llmReviewService: LlmReviewService,
    @Inject(METRIC_JOB_COMPLETED)
    private readonly metricJobCompleted: Counter,
    @Inject(METRIC_JOB_FAILED)
    private readonly metricJobFailed: Counter,
    @Inject(METRIC_FINDINGS_TOTAL)
    private readonly metricFindingsTotal: Counter,
    @Inject(METRIC_RUN_DURATION)
    private readonly metricRunDuration: Histogram,
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

    // Step 2.5: Bail early if the installation has been suspended.
    const installation = await this.installationRepository.findByInstallationId(installationId);
    if (installation?.suspendedAt !== null && installation?.suspendedAt !== undefined) {
      this.logger.info({ installationId }, 'skipping review — installation suspended');
      return;
    }

    // Step 3+: Create workspace, clone, diff — cleanup guaranteed via finally.
    const workspace = await this.workspaceService.create(jobId);

    let runId: string | undefined;
    const pipelineStart = Date.now();

    // HIGH-04: Destructure { promise, cancel } so the timer can be cleared
    // once the pipeline resolves or rejects, preventing a leaking timer.
    const { promise: timeoutPromise, cancel: cancelTimeout } =
      this.workspaceLimitsService.createTimeoutPromise(jobId);

    try {
      await Promise.race([
        this._runPipeline(
          jobId,
          installationId,
          repositoryId,
          prNumber,
          baseSha,
          headSha,
          baseRef,
          headRef,
          token,
          workspace,
          pipelineStart,
          (id: string) => {
            runId = id;
          },
        ),
        timeoutPromise,
      ]);
      cancelTimeout();
    } catch (err) {
      cancelTimeout();
      // Attempt to mark the run as failed if we have a run ID.
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
      this.metricJobFailed.inc({ reason: 'pipeline_error' });
      const durationSeconds = (Date.now() - pipelineStart) / 1000;
      this.metricRunDuration.observe({ conclusion: 'failure' }, durationSeconds);
      throw err;
    } finally {
      // Always clean up the workspace regardless of success or failure.
      await workspace.cleanup();
    }
  }

  private async _runPipeline(
    jobId: string,
    installationId: number,
    repositoryId: number,
    prNumber: number,
    baseSha: string,
    headSha: string,
    baseRef: string,
    headRef: string,
    token: string,
    workspace: { dir: string; cleanup: () => Promise<void> },
    pipelineStart: number,
    setRunId: (id: string) => void,
  ): Promise<void> {
    // Resolve owner and repo name from DB (repositories.fullName = "owner/repo").
    const { owner, repoName } = await withTenantContext(this.db, installationId, async () => {
      return this.resolveRepo(repositoryId);
    });

    // Step 4: Shallow-clone the head ref into a 'head' subdirectory.
    const { repoDir: headDir } = await this.cloneService.clone(
      owner,
      repoName,
      headRef,
      token,
      path.join(workspace.dir, 'head'),
    );

    // Check disk usage after clone completes.
    await this.workspaceLimitsService.checkDiskUsage(workspace.dir);

    // Step 7: Load per-repo config from .github/ai-review.yml.
    const config = loadConfig(headDir);

    // Fetch the base branch into the head clone so we can diff against it.
    // Shallow clone only has --depth=1 of the head branch; the base commit
    // may not exist. Fetching the base ref gives us 'FETCH_HEAD' which is
    // the current tip of the base branch — reliable for all shallow clones.
    const headGit = simpleGit(headDir);
    await headGit.fetch(['origin', baseRef, '--depth=1']);

    // Step 5: Filter the diff using config ignore patterns.
    // Use 'FETCH_HEAD' (base branch tip) instead of baseSha to avoid
    // shallow-clone ancestry issues.
    const diffResult = await this.diffFilterService.filter(
      headDir,
      'FETCH_HEAD',
      'HEAD',
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

    setRunId(run.id);

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

      // HIGH-03: Check disk usage again after base clone — the workspace now
      // contains both head and base checkouts.
      await this.workspaceLimitsService.checkDiskUsage(workspace.dir);

      try {
        const baseGraph = buildGraph({
          workspaceDir: baseDir,
          tsconfigPath: config.tsconfig,
          layers: config.layers,
        });
        baseViolations = evaluateRules(baseGraph, config.rules, baseDir);
      } catch (err) {
        this.logger.warn({ err, baseSha }, 'base graph build failed — skipping arch analysis');
        baseViolations = [];
      }

      await this.graphCacheService.setBaseGraph(
        repositoryId,
        baseSha,
        baseViolations,
      );
    }

    // Step 9: Build head graph.
    let headViolations: typeof baseViolations = [];
    try {
      const headGraph = buildGraph({
        workspaceDir: headDir,
        tsconfigPath: config.tsconfig,
        layers: config.layers,
      });
      headViolations = evaluateRules(headGraph, config.rules, headDir);
    } catch (err) {
      this.logger.warn({ err, headSha }, 'head graph build failed — skipping arch analysis');
    }

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

    // Step 10.7: LLM semantic review (skipped when llm.enabled=false or no API key).
    const llmReviewConfig: ReviewConfig = {
      triageThreshold: LLM_TRIAGE_THRESHOLD,
      confidenceThreshold: LLM_CONFIDENCE_THRESHOLD,
      maxInlineComments: config.review.max_inline_comments,
      minSeverityInline: config.review.min_severity_inline,
    };

    let llmInlineFindings: Finding[] = [];
    let llmSummaryFindings: Finding[] = [];

    if (config.llm.enabled && !diffResult.summaryOnlyMode) {
      try {
        const llmResult = await this.llmReviewService.runLlmReview({
          installationId,
          runId: run.id,
          repoDir: headDir,
          baseSha: 'FETCH_HEAD',
          headSha: 'HEAD',
          diffFiles: diffResult.filteredFiles,
          deterministicViolations: deltaViolations.map((v) => ({
            rule: v.rule,
            file: v.file,
            line: v.line,
            message: v.message,
            severity: v.severity,
          })),
          config: llmReviewConfig,
          archContext: config.llm.context,
        });
        llmInlineFindings = llmResult.inlineFindings;
        llmSummaryFindings = llmResult.summaryOnlyFindings;
      } catch (err) {
        // LLM review is non-fatal — log and continue with graph-only results.
        this.logger.warn({ err, jobId, runId: run.id }, 'LLM review failed — continuing without LLM findings');
      }
    }

    // Compute fingerprints for all LLM findings.
    const llmFindingsWithFingerprint = [...llmInlineFindings, ...llmSummaryFindings].map((f) => ({
      finding: f,
      fingerprint: computeLlmFingerprint(f),
    }));

    // Step 10.5: Deduplicate all findings (graph + LLM inline) before publishing.
    // Must run BEFORE inserting findings for this run so all are correctly marked isNew.
    const dedupResults = await this.findingDedupService.deduplicateFindings(
      repositoryId,
      prNumber,
      [
        ...deltaViolations.map((v) => ({
          fingerprint: v.fingerprint,
          source: 'graph' as const,
          ruleOrCategory: v.rule,
          severity: v.severity,
          file: v.file,
          line: v.line,
          rationale: v.message,
        })),
        ...llmFindingsWithFingerprint.map(({ finding, fingerprint }) => ({
          fingerprint,
          source: 'llm' as const,
          ruleOrCategory: finding.category,
          severity: finding.severity,
          file: finding.file,
          line: finding.line,
          rationale: finding.title,
        })),
      ],
    );

    const suppressedFingerprints = new Set(
      dedupResults
        .filter((r) => r.isSuppressed)
        .map((r) => r.finding.fingerprint),
    );

    const llmInlineFindingsSet = new Set(llmInlineFindings);
    const llmSummaryFindingsSet = new Set(llmSummaryFindings);

    const violationsToPublish: ViolationForAnnotation[] = [
      ...deltaViolations
        .filter((v) => !suppressedFingerprints.has(v.fingerprint))
        .map((v) => ({
          rule: v.rule,
          file: v.file,
          line: v.line,
          message: v.message,
          severity: v.severity,
          fingerprint: v.fingerprint,
        })),
      ...llmFindingsWithFingerprint
        .filter(({ finding }) => llmInlineFindingsSet.has(finding))
        .filter(({ fingerprint }) => !suppressedFingerprints.has(fingerprint))
        .map(({ finding, fingerprint }) => ({
          rule: finding.category,
          file: finding.file,
          line: finding.line,
          message: finding.title,
          severity: finding.severity,
          fingerprint,
        })),
      ...llmFindingsWithFingerprint
        .filter(({ finding }) => llmSummaryFindingsSet.has(finding))
        .filter(({ fingerprint }) => !suppressedFingerprints.has(fingerprint))
        .map(({ finding, fingerprint }) => ({
          rule: finding.category,
          file: finding.file,
          line: finding.line,
          message: finding.title,
          severity: finding.severity,
          fingerprint,
        })),
    ];

    // Step 11: Publish check run annotations.
    const conclusion = determineConclusion(
      violationsToPublish,
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
        violations: violationsToPublish,
        conclusion,
        summaryTitle: 'Architectural Review',
      });
    }

    // Step 12: Persist findings to DB (all findings, including suppressed,
    // so future dedup lookups can reference them).
    const allNewFindings: NewFinding[] = [
      ...deltaViolations.map((v) => ({
        runId: run.id,
        fingerprint: v.fingerprint,
        source: 'graph' as const,
        ruleOrCategory: v.rule,
        severity: v.severity,
        file: v.file,
        line: v.line,
        rationale: v.message,
      })),
      ...llmFindingsWithFingerprint.map(({ finding, fingerprint }) => ({
        runId: run.id,
        fingerprint,
        source: 'llm' as const,
        ruleOrCategory: finding.category,
        severity: finding.severity,
        file: finding.file,
        line: finding.line,
        rationale: finding.title,
      })),
    ];

    if (allNewFindings.length > 0) {
      await withTenantContext(this.db, installationId, async () => {
        await this.findingRepository.insertFindings(run.id, allNewFindings);
      });

      // Record findings metrics by source and severity.
      for (const v of deltaViolations) {
        this.metricFindingsTotal.inc({ source: 'graph', severity: v.severity });
      }
      for (const { finding } of llmFindingsWithFingerprint) {
        this.metricFindingsTotal.inc({ source: 'llm', severity: finding.severity });
      }
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

    const durationSeconds = (Date.now() - pipelineStart) / 1000;
    this.metricJobCompleted.inc({ conclusion });
    this.metricRunDuration.observe({ conclusion }, durationSeconds);
  }

  /**
   * Resolves owner login and repo slug from the DB.
   * repositories.fullName is stored as "owner/repo" by the webhook handler.
   */
  private async resolveRepo(
    repositoryId: number,
  ): Promise<{ owner: string; repoName: string }> {
    const repo = await this.installationRepository.findRepositoryById(repositoryId);
    if (repo === undefined) {
      throw new Error(`resolveRepo: repository not found for id=${repositoryId}`);
    }
    if (!repo.enabled) {
      throw new Error(`resolveRepo: repository id=${repositoryId} is disabled`);
    }
    const slashIdx = repo.fullName.indexOf('/');
    if (slashIdx === -1) {
      throw new Error(`resolveRepo: malformed fullName="${repo.fullName}" for id=${repositoryId}`);
    }
    return {
      owner: repo.fullName.slice(0, slashIdx),
      repoName: repo.fullName.slice(slashIdx + 1),
    };
  }
}
