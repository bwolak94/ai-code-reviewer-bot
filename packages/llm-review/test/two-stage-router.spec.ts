import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TwoStageRouter } from '../src/routing/two-stage-router.js';
import type { LLMProvider } from '../src/provider/llm-provider.interface.js';
import type { TokenBudgetService } from '../src/budget/token-budget.service.js';
import type { DiffChunk } from '../src/types.js';
import type { Finding } from '../src/schema/finding.schema.js';

function makeDiffChunk(overrides: Partial<DiffChunk> = {}): DiffChunk {
  return {
    file: 'src/domain/user.service.ts',
    hunkText: '@@ -1,5 +1,7 @@\n+import { UserRepository } from "../infra/user.repo";\n',
    startLine: 1,
    endLine: 7,
    estimatedTokens: 50,
    ...overrides,
  };
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
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

const baseInput = {
  deterministicViolations: [],
  archContext: 'Layered architecture',
  neighbouringFiles: [],
  config: {
    triageThreshold: 0.3,
    confidenceThreshold: 0.6,
    maxInlineComments: 10,
    minSeverityInline: 'high' as const,
  },
};

describe('TwoStageRouter', () => {
  let router: TwoStageRouter;
  let mockProvider: {
    triage: ReturnType<typeof vi.fn>;
    review: ReturnType<typeof vi.fn>;
  };
  let mockBudget: {
    checkBudget: ReturnType<typeof vi.fn>;
    recordUsage: ReturnType<typeof vi.fn>;
  };
  let mockLogger: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockProvider = {
      triage: vi.fn().mockResolvedValue({ score: 0.8, rationale: 'Crosses boundaries' }),
      review: vi.fn().mockResolvedValue([makeFinding()]),
    };

    mockBudget = {
      checkBudget: vi.fn().mockResolvedValue({ exceeded: false, remaining: 90_000 }),
      recordUsage: vi.fn().mockResolvedValue(undefined),
    };

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    // Instantiate directly to avoid NestJS DI overhead in unit tests
    router = new TwoStageRouter(
      mockProvider as LLMProvider,
      mockBudget as unknown as TokenBudgetService,
      mockLogger as never,
    );
  });

  it('returns empty array when pre-triage budget is exceeded', async () => {
    mockBudget.checkBudget.mockResolvedValue({ exceeded: true, remaining: 0 });

    const chunks = [makeDiffChunk()];
    const findings = await router.route(chunks, baseInput, 100, 0.3);

    expect(findings).toEqual([]);
    expect(mockProvider.triage).not.toHaveBeenCalled();
    expect(mockProvider.review).not.toHaveBeenCalled();
  });

  it('does not call review for chunks that score below the triage threshold', async () => {
    mockProvider.triage.mockResolvedValue({ score: 0.1, rationale: 'Just boilerplate' });

    const chunks = [makeDiffChunk(), makeDiffChunk({ file: 'src/infra/repo.ts' })];
    const findings = await router.route(chunks, baseInput, 100, 0.3);

    expect(mockProvider.triage).toHaveBeenCalledTimes(2);
    expect(mockProvider.review).not.toHaveBeenCalled();
    expect(findings).toEqual([]);
  });

  it('calls review for chunks that score at or above threshold', async () => {
    mockProvider.triage.mockResolvedValue({ score: 0.3, rationale: 'Exactly at threshold' });
    const finding = makeFinding();
    mockProvider.review.mockResolvedValue([finding]);

    const chunks = [makeDiffChunk()];
    const findings = await router.route(chunks, baseInput, 100, 0.3);

    expect(mockProvider.review).toHaveBeenCalledOnce();
    expect(findings).toHaveLength(1);
    expect(findings[0]).toEqual(finding);
  });

  it('merges findings from multiple module groups', async () => {
    mockProvider.triage.mockResolvedValue({ score: 0.9, rationale: 'Architectural change' });
    const findingA = makeFinding({ file: 'src/a.ts', line: 1 });
    const findingB = makeFinding({ file: 'src/b.ts', line: 2 });

    mockProvider.review
      .mockResolvedValueOnce([findingA])
      .mockResolvedValueOnce([findingB]);

    // Two files from different top-level directories — separate modules
    const chunks = [
      makeDiffChunk({ file: 'moduleA/service.ts' }),
      makeDiffChunk({ file: 'moduleB/repo.ts' }),
    ];
    const findings = await router.route(chunks, baseInput, 100, 0.3);

    expect(mockProvider.review).toHaveBeenCalledTimes(2);
    expect(findings).toHaveLength(2);
  });

  it('skips module review if budget is exceeded before that module batch', async () => {
    // First budget check (pre-triage) passes, subsequent module-batch checks are exceeded
    mockBudget.checkBudget
      .mockResolvedValueOnce({ exceeded: false, remaining: 90_000 }) // pre-triage gate
      .mockResolvedValue({ exceeded: true, remaining: 0 }); // all module-batch gates

    mockProvider.triage.mockResolvedValue({ score: 0.9, rationale: 'Big change' });

    const chunks = [makeDiffChunk({ file: 'moduleA/service.ts' })];
    const findings = await router.route(chunks, baseInput, 100, 0.3);

    expect(mockProvider.review).not.toHaveBeenCalled();
    expect(findings).toEqual([]);
  });

  describe('groupChunksByModule', () => {
    it('groups chunks by first path segment', () => {
      const chunks: DiffChunk[] = [
        makeDiffChunk({ file: 'src/a.ts' }),
        makeDiffChunk({ file: 'src/b.ts' }),
        makeDiffChunk({ file: 'lib/c.ts' }),
      ];

      const groups = router.groupChunksByModule(chunks);
      const srcGroup = groups.find((g) => g.module === 'src');
      const libGroup = groups.find((g) => g.module === 'lib');

      expect(groups).toHaveLength(2);
      expect(srcGroup?.chunks).toHaveLength(2);
      expect(libGroup?.chunks).toHaveLength(1);
    });

    it('uses "root" as module name for top-level files with no directory', () => {
      const chunks: DiffChunk[] = [makeDiffChunk({ file: 'index.ts' })];
      const groups = router.groupChunksByModule(chunks);
      expect(groups[0]?.module).toBe('root');
    });
  });
});
