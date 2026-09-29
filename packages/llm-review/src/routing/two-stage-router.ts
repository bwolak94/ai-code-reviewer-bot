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
  ): Promise<Finding[]> {
    // Pre-triage budget gate
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
          const findings = await this.provider.review(reviewInput);
          allFindings.push(...findings);

          this.logger.info(
            { installationId, module: group.module, findings: findings.length },
            'module review complete',
          );
        }),
      ),
    );

    return allFindings;
  }

  groupChunksByModule(
    chunks: DiffChunk[],
  ): Array<{ module: string; chunks: DiffChunk[] }> {
    const moduleMap = new Map<string, DiffChunk[]>();

    for (const chunk of chunks) {
      const parts = chunk.file.split('/');
      // If the file has no directory component (no '/'), use 'root' as module name
      const moduleName = parts.length > 1 ? (parts[0] ?? 'root') : 'root';
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
