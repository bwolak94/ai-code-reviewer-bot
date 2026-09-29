import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { TokenBudgetService } from '../src/budget/token-budget.service.js';

describe('TokenBudgetService', () => {
  let service: TokenBudgetService;
  let mockGet: ReturnType<typeof vi.fn>;
  let mockIncrby: ReturnType<typeof vi.fn>;
  let mockExpire: ReturnType<typeof vi.fn>;
  let mockPipelineExec: ReturnType<typeof vi.fn>;
  let mockLogger: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    mockGet = vi.fn().mockResolvedValue(null);
    mockIncrby = vi.fn().mockReturnThis();
    mockExpire = vi.fn().mockReturnThis();
    mockPipelineExec = vi.fn().mockResolvedValue([[null, 50], [null, 1]]);

    const mockPipeline = {
      incrby: mockIncrby,
      expire: mockExpire,
      exec: mockPipelineExec,
    };

    const mockRedis = {
      get: mockGet,
      pipeline: vi.fn().mockReturnValue(mockPipeline),
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
      mockGet.mockResolvedValue('10000'); // 10k tokens used

      const result = await service.checkBudget(42, 5000);

      expect(result.exceeded).toBe(false);
      expect(result.remaining).toBe(90_000); // 100000 - 10000
    });

    it('returns not-exceeded when no budget has been used yet', async () => {
      mockGet.mockResolvedValue(null);

      const result = await service.checkBudget(42, 0);

      expect(result.exceeded).toBe(false);
      expect(result.remaining).toBe(100_000);
    });

    it('returns exceeded when usage is already at limit', async () => {
      mockGet.mockResolvedValue('100000');

      const result = await service.checkBudget(42, 1);

      expect(result.exceeded).toBe(true);
    });

    it('returns exceeded when adding estimated tokens would exceed limit', async () => {
      mockGet.mockResolvedValue('90000'); // 90k used

      const result = await service.checkBudget(42, 20000); // would push to 110k

      expect(result.exceeded).toBe(true);
    });

    it('returns not-exceeded when usage equals limit exactly and estimatedTokens is 0', async () => {
      mockGet.mockResolvedValue('100000');

      // Exactly at limit with 0 extra tokens — current + 0 = 100000, not over
      const result = await service.checkBudget(42, 0);

      expect(result.exceeded).toBe(false);
    });

    it('warns when budget is exceeded', async () => {
      mockGet.mockResolvedValue('99999');

      await service.checkBudget(42, 5000);

      expect(mockLogger.warn).toHaveBeenCalledOnce();
    });
  });

  describe('recordUsage', () => {
    it('calls INCRBY with sum of tokensIn + tokensOut', async () => {
      await service.recordUsage(42, 'run-uuid', 1000, 500);

      expect(mockIncrby).toHaveBeenCalledWith(expect.stringMatching(/^budget:42:/), 1500);
    });

    it('calls EXPIRE with TTL of 32 days', async () => {
      await service.recordUsage(42, 'run-uuid', 100, 100);

      const expectedTtl = 32 * 24 * 60 * 60;
      expect(mockExpire).toHaveBeenCalledWith(
        expect.stringMatching(/^budget:42:/),
        expectedTtl,
      );
    });

    it('executes the pipeline', async () => {
      await service.recordUsage(42, 'run-uuid', 100, 100);

      expect(mockPipelineExec).toHaveBeenCalledOnce();
    });

    it('logs info after recording usage', async () => {
      await service.recordUsage(42, 'run-uuid', 300, 700);

      expect(mockLogger.info).toHaveBeenCalledOnce();
    });
  });
});
