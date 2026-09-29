import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DiffChunk } from '../src/types.js';
import type { ReviewInput } from '../src/provider/llm-provider.interface.js';

// Mock the @anthropic-ai/sdk module
const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      beta: {
        promptCaching: {
          messages: {
            create: mockCreate,
          },
        },
      },
    })),
  };
});

// Import after mocks are set up
const { AnthropicProvider } = await import('../src/provider/anthropic.provider.js');

const DEFAULT_USAGE = { input_tokens: 100, output_tokens: 50 };

function makeDiffChunk(overrides: Partial<DiffChunk> = {}): DiffChunk {
  return {
    file: 'src/domain/user.service.ts',
    hunkText: '@@ -1,5 +1,7 @@\n+import { Repo } from "../infra/repo";\n',
    startLine: 1,
    endLine: 7,
    estimatedTokens: 50,
    ...overrides,
  };
}

function makeReviewInput(overrides: Partial<ReviewInput> = {}): ReviewInput {
  return {
    diffChunks: [makeDiffChunk()],
    deterministicViolations: [],
    archContext: 'Layered architecture with domain, application, infrastructure.',
    neighbouringFiles: [],
    config: {
      triageThreshold: 0.3,
      confidenceThreshold: 0.6,
      maxInlineComments: 10,
      minSeverityInline: 'high',
    },
    ...overrides,
  };
}

const mockBudget = {
  checkBudget: vi.fn().mockResolvedValue({ exceeded: false, remaining: 90_000 }),
  recordUsage: vi.fn().mockResolvedValue(undefined),
};

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

// Raw finding shape as the LLM would return (before Zod adds defaults like source)
const rawValidFinding = {
  file: 'src/domain/user.service.ts',
  line: 5,
  severity: 'high',
  category: 'layering',
  title: 'Domain imports infrastructure',
  rationale: 'Domain layer should not import infrastructure concerns.',
  confidence: 0.9,
};

describe('AnthropicProvider', () => {
  let provider: InstanceType<typeof AnthropicProvider>;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new AnthropicProvider(mockBudget as never, 'test-api-key', mockLogger as never);
  });

  describe('triage', () => {
    it('returns { score, rationale } from valid JSON response', async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: '{"score": 0.8, "rationale": "Crosses layer boundaries"}',
          },
        ],
        usage: DEFAULT_USAGE,
      });

      const result = await provider.triage(makeDiffChunk());

      expect(result.score).toBe(0.8);
      expect(result.rationale).toBe('Crosses layer boundaries');
    });

    it('returns fallback score on JSON parse failure', async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: 'This is not valid JSON at all!',
          },
        ],
        usage: DEFAULT_USAGE,
      });

      const result = await provider.triage(makeDiffChunk());

      expect(result.score).toBe(0.5);
      expect(result.rationale).toBe('parse-error-fallback');
    });

    it('returns fallback score when API call throws', async () => {
      mockCreate.mockRejectedValue(new Error('API rate limit exceeded'));

      const result = await provider.triage(makeDiffChunk());

      expect(result.score).toBe(0.5);
      expect(result.rationale).toBe('parse-error-fallback');
    });

    it('handles multiple text blocks by concatenating them', async () => {
      mockCreate.mockResolvedValue({
        content: [
          { type: 'text', text: '{"score": 0.' },
          { type: 'text', text: '7, "rationale": "Mixed changes"}' },
        ],
        usage: DEFAULT_USAGE,
      });

      const result = await provider.triage(makeDiffChunk());

      expect(result.score).toBe(0.7);
    });
  });

  describe('review', () => {
    it('returns findings from a valid tool_use block', async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: 'tool_use',
            name: 'report_findings',
            input: { findings: [rawValidFinding] },
          },
        ],
        usage: DEFAULT_USAGE,
      });

      const { findings, tokensIn, tokensOut } = await provider.review(makeReviewInput());

      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        file: 'src/domain/user.service.ts',
        line: 5,
        severity: 'high',
        category: 'layering',
      });
      expect(tokensIn).toBe(DEFAULT_USAGE.input_tokens);
      expect(tokensOut).toBe(DEFAULT_USAGE.output_tokens);
    });

    it('drops invalid findings and returns only valid ones', async () => {
      const invalidFinding = {
        file: 'src/domain/user.service.ts',
        line: -1, // invalid — negative line number
        severity: 'invalid-severity', // invalid enum
        category: 'layering',
        title: 'Bad finding',
        rationale: 'This has invalid fields.',
        confidence: 2, // out of range
      };

      mockCreate.mockResolvedValue({
        content: [
          {
            type: 'tool_use',
            name: 'report_findings',
            input: { findings: [invalidFinding, rawValidFinding] },
          },
        ],
        usage: DEFAULT_USAGE,
      });

      const { findings } = await provider.review(makeReviewInput());

      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ line: 5 });
    });

    it('returns empty findings when tool_use block is absent', async () => {
      mockCreate.mockResolvedValue({
        content: [
          { type: 'text', text: 'I found no issues.' },
        ],
        usage: DEFAULT_USAGE,
      });

      const { findings } = await provider.review(makeReviewInput());

      expect(findings).toEqual([]);
    });

    it('returns zero tokens and empty findings when API call throws', async () => {
      mockCreate.mockRejectedValue(new Error('Connection timeout'));

      const result = await provider.review(makeReviewInput());

      expect(result.findings).toEqual([]);
      expect(result.tokensIn).toBe(0);
      expect(result.tokensOut).toBe(0);
    });

    it('returns empty findings array for empty findings in tool_use', async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: 'tool_use',
            name: 'report_findings',
            input: { findings: [] },
          },
        ],
        usage: DEFAULT_USAGE,
      });

      const { findings } = await provider.review(makeReviewInput());

      expect(findings).toEqual([]);
    });
  });
});
