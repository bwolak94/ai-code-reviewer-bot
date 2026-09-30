import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { LlmReviewService } from '../src/llm-review/llm-review.service.js';
import type { LlmReviewParams } from '../src/llm-review/llm-review.service.js';
import type { Finding } from '@repo/llm-review';

// Mock node:child_process so we don't run real git commands.
// The service uses promisify(execFile), which reads util.promisify.custom
// from the execFile function object. We attach a vi.fn() to that symbol
// so promisify returns our mock directly (avoids callback-convention wiring).
const mockExecFileAsync = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
);

vi.mock('node:child_process', () => {
  const execFile = vi.fn();
  Object.defineProperty(execFile, Symbol.for('nodejs.util.promisify.custom'), {
    value: mockExecFileAsync,
    writable: true,
    configurable: true,
  });
  return { execFile };
});

// Mock @repo/github's parseUnifiedDiff and isLineInDiff
vi.mock('@repo/github', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    parseUnifiedDiff: vi.fn(),
    isLineInDiff: vi.fn(),
  };
});

// Mock @repo/llm-review to avoid loading the full NestJS module
vi.mock('@repo/llm-review', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    // Keep exports but let TwoStageRouter remain as the real class
    // so it can be used as DI token
  };
});

import { parseUnifiedDiff, isLineInDiff } from '@repo/github';
import { TwoStageRouter } from '@repo/llm-review';
const mockParseUnifiedDiff = vi.mocked(parseUnifiedDiff);
const mockIsLineInDiff = vi.mocked(isLineInDiff);

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    source: 'llm',
    file: 'src/domain/user.service.ts',
    line: 5,
    severity: 'high',
    category: 'layering',
    title: 'Domain imports infrastructure',
    rationale: 'Domain layer should not import infrastructure.',
    confidence: 0.9,
    ...overrides,
  };
}

const SIMPLE_UNIFIED_DIFF = `diff --git a/src/domain/user.service.ts b/src/domain/user.service.ts
index abc..def 100644
--- a/src/domain/user.service.ts
+++ b/src/domain/user.service.ts
@@ -1,3 +1,5 @@
 import { Injectable } from '@nestjs/common';
+import { UserRepository } from '../infrastructure/user.repository';

 @Injectable()
+export class UserService {}
`;

const baseParams: LlmReviewParams = {
  installationId: 100,
  runId: 'run-uuid-001',
  repoDir: '/tmp/repo',
  baseSha: 'a'.repeat(40),
  headSha: 'd'.repeat(40),
  diffFiles: ['src/domain/user.service.ts'],
  deterministicViolations: [],
  config: {
    triageThreshold: 0.3,
    confidenceThreshold: 0.6,
    maxInlineComments: 10,
    minSeverityInline: 'high',
  },
};

describe('LlmReviewService', () => {
  let service: LlmReviewService;
  let mockRouterRoute: ReturnType<typeof vi.fn>;
  let mockLogger: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    mockRouterRoute = vi.fn().mockResolvedValue([]);

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        LlmReviewService,
        {
          provide: TwoStageRouter,
          useValue: { route: mockRouterRoute },
        },
        { provide: 'PINO_LOGGER', useValue: mockLogger },
      ],
    }).compile();

    service = moduleRef.get(LlmReviewService);
  });

  it('returns empty results when diffFiles is empty', async () => {
    const result = await service.runLlmReview({ ...baseParams, diffFiles: [] });
    expect(result.inlineFindings).toEqual([]);
    expect(result.summaryOnlyFindings).toEqual([]);
    expect(mockRouterRoute).not.toHaveBeenCalled();
  });

  it('returns empty results when git diff produces empty output', async () => {
    mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' });

    const result = await service.runLlmReview(baseParams);
    expect(result.inlineFindings).toEqual([]);
    expect(result.summaryOnlyFindings).toEqual([]);
  });

  it('places findings whose lines are in the diff into inlineFindings', async () => {
    mockExecFileAsync.mockResolvedValue({ stdout: SIMPLE_UNIFIED_DIFF, stderr: '' });

    const inlineFinding = makeFinding({ file: 'src/domain/user.service.ts', line: 2 });

    mockParseUnifiedDiff.mockReturnValue([
      {
        path: 'src/domain/user.service.ts',
        hunks: [
          {
            header: '@@ -1,3 +1,5 @@',
            startLine: 1,
            lines: [
              { type: 'context', headLine: 1, content: "import { Injectable } from '@nestjs/common';" },
              { type: 'added', headLine: 2, content: "import { UserRepository } from '../infrastructure/user.repository';" },
              { type: 'context', headLine: 3, content: '' },
              { type: 'context', headLine: 4, content: '@Injectable()' },
              { type: 'added', headLine: 5, content: 'export class UserService {}' },
            ],
          },
        ],
        headLineSet: new Set([1, 2, 3, 4, 5]),
      },
    ]);

    mockRouterRoute.mockResolvedValue([inlineFinding]);
    mockIsLineInDiff.mockReturnValue(true); // line 2 is in diff

    const result = await service.runLlmReview(baseParams);

    expect(result.inlineFindings).toHaveLength(1);
    expect(result.inlineFindings[0]).toEqual(inlineFinding);
    expect(result.summaryOnlyFindings).toHaveLength(0);
  });

  it('demotes findings whose lines are NOT in the diff to summaryOnlyFindings', async () => {
    mockExecFileAsync.mockResolvedValue({ stdout: SIMPLE_UNIFIED_DIFF, stderr: '' });

    const outOfDiffFinding = makeFinding({
      file: 'src/domain/user.service.ts',
      line: 999, // not in any diff hunk
    });

    mockParseUnifiedDiff.mockReturnValue([
      {
        path: 'src/domain/user.service.ts',
        hunks: [
          {
            header: '@@ -1,3 +1,5 @@',
            startLine: 1,
            lines: [
              { type: 'added', headLine: 2, content: 'some code' },
            ],
          },
        ],
        headLineSet: new Set([1, 2, 3]),
      },
    ]);

    mockRouterRoute.mockResolvedValue([outOfDiffFinding]);
    mockIsLineInDiff.mockReturnValue(false); // line 999 not in diff

    const result = await service.runLlmReview(baseParams);

    expect(result.inlineFindings).toHaveLength(0);
    expect(result.summaryOnlyFindings).toHaveLength(1);
    expect(result.summaryOnlyFindings[0]).toEqual(outOfDiffFinding);
  });

  it('splits mixed findings correctly between inline and summaryOnly', async () => {
    mockExecFileAsync.mockResolvedValue({ stdout: SIMPLE_UNIFIED_DIFF, stderr: '' });

    const inlineFinding = makeFinding({ file: 'src/domain/user.service.ts', line: 2 });
    const summaryFinding = makeFinding({ file: 'src/domain/user.service.ts', line: 999 });

    mockParseUnifiedDiff.mockReturnValue([
      {
        path: 'src/domain/user.service.ts',
        hunks: [
          {
            header: '@@ -1,3 +1,5 @@',
            startLine: 1,
            lines: [
              { type: 'context' as const, headLine: 1, content: 'import something;' },
              { type: 'added' as const, headLine: 2, content: 'import { UserRepository } from "../infra/user.repository";' },
              { type: 'added' as const, headLine: 3, content: 'export class UserService {}' },
            ],
          },
        ],
        headLineSet: new Set([1, 2, 3]),
      },
    ]);

    mockRouterRoute.mockResolvedValue([inlineFinding, summaryFinding]);

    // Return true for line 2 (inline), false for line 999 (summary-only)
    mockIsLineInDiff
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    const result = await service.runLlmReview(baseParams);

    expect(result.inlineFindings).toHaveLength(1);
    expect(result.summaryOnlyFindings).toHaveLength(1);
  });

  it('skips files where git diff throws and continues with remaining files', async () => {
    mockExecFileAsync
      .mockRejectedValueOnce(new Error('git error'))
      .mockResolvedValueOnce({ stdout: SIMPLE_UNIFIED_DIFF, stderr: '' });

    mockParseUnifiedDiff.mockReturnValue([
      {
        path: 'src/b.ts',
        hunks: [{ header: '@@ -1,1 +1,2 @@', startLine: 1, lines: [{ type: 'added' as const, headLine: 1, content: 'new line' }] }],
        headLineSet: new Set([1]),
      },
    ]);

    mockRouterRoute.mockResolvedValue([]);

    const result = await service.runLlmReview({
      ...baseParams,
      diffFiles: ['src/a.ts', 'src/b.ts'],
    });

    expect(mockLogger.warn).toHaveBeenCalledOnce();
    expect(result.inlineFindings).toEqual([]);
  });
});
