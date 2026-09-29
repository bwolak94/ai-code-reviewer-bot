import pLimit from 'p-limit';
import { Injectable, Inject } from '@nestjs/common';
import type { Logger as PinoLogger } from 'pino';
import { LLM_PROVIDER } from '../constants.js';
import type { LLMProvider, ReviewInput } from '../provider/llm-provider.interface.js';
import { TokenBudgetService } from '../budget/token-budget.service.js';
import type { Finding } from '../schema/finding.schema.js';
import type { DiffChunk } from '../types.js';

const TRIAGE_CONCURRENCY = 5;
const REVIEW_CONCURRENCY = 2;
const TRIAGE_THRESHOLD = 0.3;

// LOW-03: known monorepo top-level namespaces whose second path segment is the real module name.
const MONOREPO_NAMESPACES = new Set(['packages', 'apps', 'libs']);

@Injectable()
export class TwoStageRouter {
  private readonly triageLimit = pLimit(TRIAGE_CONCURRENCY);
  private readonly reviewLimit = pLimit(REVIEW_CONCURRENCY);

  constructor(
    @Inject(LLM_PROVIDER)
    private readonly provider: LLMProvider,
    private readonly budget: TokenBudgetService,
    @Inject('PINO_LOGGER')
    private readonly logger: PinoLogger,
  ) {}

  async route(
    chunks: DiffChunk[],
    baseInput: Omit<ReviewInput, 'diffChunks'>,
    installationId: number,
    threshold = TRIAGE_THRESHOLD,
    runId = '',
  ): Promise<Finding[]> {
    // Pre-triage budget gate (atomically reserves estimated tokens)
    const totalEstimated = chunks.reduce((sum, c) => sum + c.estimatedTokens, 0);
    const preBudget = await this.budget.checkBudget(installationId, totalEstimated);

    if (preBudget.exceeded) {
      this.logger.warn(
        { installationId, totalEstimated },
        'pre-triage budget exceeded — skipping LLM review',
      );
      return [];
    }

    // Stage 1: triage all chunks in parallel (bounded concurrency)
    const triageResults = await Promise.all(
      chunks.map((chunk) =>
        this.triageLimit(async () => {
          const result = await this.provider.triage(chunk);
          return { chunk, result };
        }),
      ),
    );

    const relevantChunks = triageResults
      .filter(({ result }) => result.score >= threshold)
      .map(({ chunk }) => chunk);

    this.logger.info(
      {
        installationId,
        total: chunks.length,
        relevant: relevantChunks.length,
        threshold,
      },
      'triage complete',
    );

    if (relevantChunks.length === 0) {
      return [];
    }

    // Stage 2: group by module and review with bounded concurrency
    const moduleGroups = this.groupChunksByModule(relevantChunks);
    const allFindings: Finding[] = [];
    let totalTokensIn = 0;
    let totalTokensOut = 0;

    await Promise.all(
      moduleGroups.map((group) =>
        this.reviewLimit(async () => {
          const moduleBudget = await this.budget.checkBudget(installationId, 0);
          if (moduleBudget.exceeded) {
            this.logger.warn(
              { installationId, module: group.module },
              'module-batch budget exceeded — skipping',
            );
            return;
          }

          const reviewInput: ReviewInput = { ...baseInput, diffChunks: group.chunks };
          const { findings, tokensIn, tokensOut } = await this.provider.review(reviewInput);
          allFindings.push(...findings);
          totalTokensIn += tokensIn;
          totalTokensOut += tokensOut;

          this.logger.info(
            { installationId, module: group.module, findings: findings.length },
            'module review complete',
          );
        }),
      ),
    );

    // HIGH-02: record actual token usage for telemetry after all reviews complete.
    await this.budget.recordUsage(installationId, runId, totalTokensIn, totalTokensOut);

    // MED-06: filter findings below the configured confidence threshold.
    const { confidenceThreshold } = baseInput.config;
    return allFindings.filter((f) => f.confidence >= confidenceThreshold);
  }

  groupChunksByModule(
    chunks: DiffChunk[],
  ): Array<{ module: string; chunks: DiffChunk[] }> {
    const moduleMap = new Map<string, DiffChunk[]>();

    for (const chunk of chunks) {
      const parts = chunk.file.split('/');
      // LOW-03: for monorepo paths (packages/X/..., apps/X/...), the second segment
      // is the real module name; the first is just a namespace directory.
      let moduleName: string;
      if (parts.length > 2 && parts[0] !== undefined && MONOREPO_NAMESPACES.has(parts[0])) {
        moduleName = parts[1] ?? 'root';
      } else if (parts.length > 1) {
        moduleName = parts[0] ?? 'root';
      } else {
        moduleName = 'root';
      }

      const existing = moduleMap.get(moduleName);
      if (existing !== undefined) {
        existing.push(chunk);
      } else {
        moduleMap.set(moduleName, [chunk]);
      }
    }

    return Array.from(moduleMap.entries()).map(([module, moduleChunks]) => ({
      module,
      chunks: moduleChunks,
    }));
  }
}
