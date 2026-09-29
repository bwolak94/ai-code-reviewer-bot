import { execFileSync } from 'node:child_process';
import { Injectable, Inject } from '@nestjs/common';
import type { Logger as PinoLogger } from 'pino';
import { TwoStageRouter } from '@repo/llm-review';
import type { DiffChunk, DeterministicViolation, ReviewConfig } from '@repo/llm-review';
import type { Finding } from '@repo/llm-review';
import { parseUnifiedDiff, isLineInDiff } from '@repo/github';
import type { FileDiff } from '@repo/github';

export interface LlmReviewParams {
  installationId: number;
  runId: string;
  repoDir: string;
  baseSha: string;
  headSha: string;
  diffFiles: string[];
  deterministicViolations: DeterministicViolation[];
  config: ReviewConfig;
  archContext?: string | undefined;
}

export interface LlmReviewResult {
  inlineFindings: Finding[];
  summaryOnlyFindings: Finding[];
}

@Injectable()
export class LlmReviewService {
  constructor(
    private readonly twoStageRouter: TwoStageRouter,
    @Inject('PINO_LOGGER')
    private readonly logger: PinoLogger,
  ) {}

  async runLlmReview(params: LlmReviewParams): Promise<LlmReviewResult> {
    const {
      installationId,
      runId,
      repoDir,
      baseSha,
      headSha,
      diffFiles,
      deterministicViolations,
      config,
      archContext = '',
    } = params;

    // Build diff chunks from each file
    const allChunks: DiffChunk[] = [];
    const fileDiffMap = new Map<string, FileDiff>();

    for (const filePath of diffFiles) {
      let diffText: string;
      try {
        diffText = execFileSync(
          'git',
          ['diff', baseSha, headSha, '--', filePath],
          { cwd: repoDir, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 },
        );
      } catch (err) {
        this.logger.warn({ err, filePath }, 'failed to get diff for file — skipping');
        continue;
      }

      if (!diffText.trim()) {
        continue;
      }

      const parsedDiffs = parseUnifiedDiff(diffText);
      for (const fileDiff of parsedDiffs) {
        fileDiffMap.set(fileDiff.path, fileDiff);

        for (const hunk of fileDiff.hunks) {
          const hunkText = hunk.header + '\n' + hunk.lines.map((l) => {
            if (l.type === 'added') return `+${l.content}`;
            if (l.type === 'removed') return `-${l.content}`;
            return ` ${l.content}`;
          }).join('\n');

          const nonRemovedCount = hunk.lines.filter((l) => l.type !== 'removed').length;
          const chunk: DiffChunk = {
            file: fileDiff.path,
            hunkText,
            startLine: hunk.startLine,
            endLine: Math.max(hunk.startLine, hunk.startLine + nonRemovedCount - 1),
            estimatedTokens: Math.ceil(hunkText.length / 4),
          };
          allChunks.push(chunk);
        }
      }
    }

    if (allChunks.length === 0) {
      this.logger.info({ installationId, runId }, 'no diff chunks to review');
      return { inlineFindings: [], summaryOnlyFindings: [] };
    }

    const baseInput = {
      deterministicViolations,
      archContext,
      neighbouringFiles: [],
      config,
    };

    const findings = await this.twoStageRouter.route(
      allChunks,
      baseInput,
      installationId,
      config.triageThreshold,
    );

    const inlineFindings: Finding[] = [];
    const summaryOnlyFindings: Finding[] = [];

    for (const finding of findings) {
      const fileDiff = fileDiffMap.get(finding.file);
      if (fileDiff !== undefined && isLineInDiff(fileDiff, finding.line)) {
        inlineFindings.push(finding);
      } else {
        summaryOnlyFindings.push(finding);
      }
    }

    this.logger.info(
      {
        installationId,
        runId,
        total: findings.length,
        inline: inlineFindings.length,
        summaryOnly: summaryOnlyFindings.length,
      },
      'LLM review complete',
    );

    return { inlineFindings, summaryOnlyFindings };
  }
}
