import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { TokenBudgetService } from '../src/budget/token-budget.service.js';

describe('TokenBudgetService', () => {
  let service: TokenBudgetService;
  let mockEval: ReturnType<typeof vi.fn>;
  let mockLogger: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    // checkBudget uses redis.eval — return [exceeded, remaining] pairs
    mockEval = vi.fn().mockResolvedValue([0, 100_000]); // default: not exceeded

    const mockRedis = {
      eval: mockEval,
    };

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        TokenBudgetService,
        { provide: 'REDIS_CACHE', useValue: mockRedis },
        { provide: 'PINO_LOGGER', useValue: mockLogger },
      ],
    }).compile();

    service = moduleRef.get(TokenBudgetService);
  });

  describe('checkBudget', () => {
    it('returns not-exceeded with remaining tokens when under limit', async () => {
      // Lua: current=10000, estimated=5000 → reserves 5k, remaining = 100000-10000-5000 = 85000
      mockEval.mockResolvedValue([0, 85_000]);

      const result = await service.checkBudget(42, 5000);

      expect(result.exceeded).toBe(false);
      expect(result.remaining).toBe(85_000);
    });

    it('returns not-exceeded when no budget has been used yet', async () => {
      // Lua: current=0, estimated=0 → no INCRBY, remaining = 100000
      mockEval.mockResolvedValue([0, 100_000]);

      const result = await service.checkBudget(42, 0);

      expect(result.exceeded).toBe(false);
      expect(result.remaining).toBe(100_000);
    });

    it('returns exceeded when usage is already at limit', async () => {
      // Lua: current=100000, estimated=1 → 100001 > 100000, exceeded
      mockEval.mockResolvedValue([1, 0]);

      const result = await service.checkBudget(42, 1);

      expect(result.exceeded).toBe(true);
    });

    it('returns exceeded when adding estimated tokens would exceed limit', async () => {
      // Lua: current=90000, estimated=20000 → 110000 > 100000, exceeded
      mockEval.mockResolvedValue([1, 10_000]);

      const result = await service.checkBudget(42, 20_000);

      expect(result.exceeded).toBe(true);
    });

    it('returns not-exceeded when usage equals limit exactly and estimatedTokens is 0', async () => {
      // Lua: current=100000, estimated=0 → 100000 + 0 = 100000, not > 100000 → not exceeded
      mockEval.mockResolvedValue([0, 0]);

      const result = await service.checkBudget(42, 0);

      expect(result.exceeded).toBe(false);
    });

    it('warns when budget is exceeded', async () => {
      mockEval.mockResolvedValue([1, 1]);

      await service.checkBudget(42, 5000);

      expect(mockLogger.warn).toHaveBeenCalledOnce();
    });

    it('passes key, estimatedTokens, max, and TTL to redis.eval', async () => {
      mockEval.mockResolvedValue([0, 99_000]);

      await service.checkBudget(42, 1000);

      expect(mockEval).toHaveBeenCalledOnce();
      const [, , key, estimated, max] = mockEval.mock.calls[0] as unknown[];
      expect(key).toMatch(/^budget:42:/);
      expect(estimated).toBe('1000');
      expect(max).toBe('100000');
    });
  });

  describe('recordUsage', () => {
    it('logs info with installationId, runId, tokensIn, and tokensOut', async () => {
      await service.recordUsage(42, 'run-uuid', 1000, 500);

      expect(mockLogger.info).toHaveBeenCalledOnce();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ installationId: 42, runId: 'run-uuid', tokensIn: 1000, tokensOut: 500 }),
        'token usage recorded',
      );
    });

    it('does not call redis.eval for recordUsage (budget managed by checkBudget)', async () => {
      mockEval.mockClear();

      await service.recordUsage(42, 'run-uuid', 300, 700);

      expect(mockEval).not.toHaveBeenCalled();
    });
  });
});
