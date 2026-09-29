import { Injectable, Inject } from '@nestjs/common';
import { simpleGit } from 'simple-git';
import micromatch from 'micromatch';
import type { Logger as PinoLogger } from 'pino';
import type { DiffFilterResult } from '@repo/db';

/**
 * Default ignore globs applied when no `.github/ai-review.yml` config is present.
 * These cover generated files, lockfiles, and test infrastructure that rarely
 * benefit from architectural review.
 */
export const DEFAULT_IGNORE_GLOBS: readonly string[] = [
  '**/*.spec.ts',
  '**/*.test.ts',
  '**/generated/**',
  'migrations/**',
  '**/node_modules/**',
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
];

/**
 * Maximum total changed lines before switching to summary-only mode.
 * PRs exceeding this threshold are too large for line-by-line review.
 */
const MAX_DIFF_LINES = 50_000;

/**
 * Filters the diff of a PR based on ignore globs and enforces a diff size ceiling.
 *
 * Runs `git diff --name-only` and `git diff --stat` within the cloned workspace
 * directory to determine which files changed and how many lines were modified.
 */
@Injectable()
export class DiffFilterService {
  constructor(
    @Inject('PINO_LOGGER')
    private readonly logger: PinoLogger,
  ) {}

  /**
   * Filters changed files in a repository between base and head SHAs.
   *
   * @param repoDir     - Absolute path to the cloned repository workspace
   * @param baseSha     - Base commit SHA (merge base)
   * @param headSha     - Head commit SHA (PR tip)
   * @param ignoreGlobs - Additional globs to ignore (from .github/ai-review.yml)
   * @returns DiffFilterResult with filtered file list and summary mode flag
   */
  async filter(
    repoDir: string,
    baseSha: string,
    headSha: string,
    ignoreGlobs: readonly string[] = [],
  ): Promise<DiffFilterResult> {
    const git = simpleGit(repoDir);

    // Get the list of changed file paths.
    const nameOnlyOutput = await git.diff([
      '--name-only',
      `${baseSha}..${headSha}`,
    ]);

    const allFiles = nameOnlyOutput
      .split('\n')
      .map((f) => f.trim())
      .filter((f) => f.length > 0);

    // Combine default and custom ignore globs.
    const combinedIgnoreGlobs = [...DEFAULT_IGNORE_GLOBS, ...ignoreGlobs];

    // Filter out ignored files using micromatch.
    const filteredFiles = allFiles.filter(
      (file) => !micromatch.isMatch(file, combinedIgnoreGlobs),
    );

    // Count total changed lines using --stat output.
    const totalChangedLines = await this.countChangedLines(
      git,
      baseSha,
      headSha,
    );

    const summaryOnlyMode = totalChangedLines > MAX_DIFF_LINES;

    this.logger.info(
      {
        baseSha,
        headSha,
        totalFiles: allFiles.length,
        filteredFiles: filteredFiles.length,
        totalChangedLines,
        summaryOnlyMode,
      },
      'diff filter complete',
    );

    return { filteredFiles, summaryOnlyMode, totalChangedLines };
  }

  /**
   * Parses `git diff --stat` output to count total insertions + deletions.
   * Falls back to 0 on parse failure rather than crashing the job.
   */
  private async countChangedLines(
    git: ReturnType<typeof simpleGit>,
    baseSha: string,
    headSha: string,
  ): Promise<number> {
    try {
      const statOutput = await git.diff([
        '--stat',
        `${baseSha}..${headSha}`,
      ]);

      // Last line of --stat is: " N files changed, X insertions(+), Y deletions(-)"
      const summaryLine = statOutput.trim().split('\n').at(-1) ?? '';

      let total = 0;

      const insertMatch = /(\d+) insertion/.exec(summaryLine);
      if (insertMatch?.[1] !== undefined) {
        total += parseInt(insertMatch[1], 10);
      }

      const deleteMatch = /(\d+) deletion/.exec(summaryLine);
      if (deleteMatch?.[1] !== undefined) {
        total += parseInt(deleteMatch[1], 10);
      }

      return total;
    } catch (err) {
      this.logger.warn(
        { err, baseSha, headSha },
        'failed to count changed lines — defaulting to 0',
      );
      return 0;
    }
  }
}
