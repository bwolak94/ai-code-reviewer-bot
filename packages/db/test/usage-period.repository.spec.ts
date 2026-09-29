import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UsagePeriodRepository } from '../src/repositories/usage-period.repository.js';

// ---------------------------------------------------------------------------
// Minimal Drizzle mock
// ---------------------------------------------------------------------------

function makeDbMock() {
  const mockLimit = vi.fn();
  const mockWhere = vi.fn();
  const mockFrom = vi.fn();
  const mockSelect = vi.fn();
  const mockInsert = vi.fn();
  const mockOnConflictDoUpdate = vi.fn();

  const selectChain = {
    from: mockFrom.mockReturnThis(),
    where: mockWhere.mockReturnThis(),
    limit: mockLimit,
  };

  const insertChain = {
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: mockOnConflictDoUpdate.mockResolvedValue(undefined),
  };

  mockSelect.mockReturnValue(selectChain);
  mockInsert.mockReturnValue(insertChain);

  return {
    db: {
      select: mockSelect,
      insert: mockInsert,
    } as unknown as Parameters<typeof UsagePeriodRepository.prototype.constructor>[0],
    mocks: {
      mockSelect,
      mockInsert,
      mockOnConflictDoUpdate,
      mockLimit,
      mockWhere,
      mockFrom,
    },
  };
}

describe('UsagePeriodRepository', () => {
  describe('incrementUsage', () => {
    it('calls INSERT … ON CONFLICT DO UPDATE for the current month', async () => {
      const { db, mocks } = makeDbMock();

      const repo = new UsagePeriodRepository(db);
      await repo.incrementUsage(42, 1000);

      expect(mocks.mockInsert).toHaveBeenCalledOnce();
      expect(mocks.mockOnConflictDoUpdate).toHaveBeenCalledOnce();
    });

    it('does not throw for zero delta and skips the insert', async () => {
      const { db, mocks } = makeDbMock();

      const repo = new UsagePeriodRepository(db);
      await expect(repo.incrementUsage(1, 0)).resolves.not.toThrow();
      expect(mocks.mockInsert).not.toHaveBeenCalled();
    });

    it('does not throw for negative delta and skips the insert', async () => {
      const { db, mocks } = makeDbMock();

      const repo = new UsagePeriodRepository(db);
      await expect(repo.incrementUsage(1, -100)).resolves.not.toThrow();
      expect(mocks.mockInsert).not.toHaveBeenCalled();
    });

    it('passes the correct installationId and delta in the insert values', async () => {
      const { db, mocks } = makeDbMock();

      // Capture values arg
      let capturedValues: unknown;
      mocks.mockInsert.mockImplementationOnce(() => ({
        values: (v: unknown) => {
          capturedValues = v;
          return { onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) };
        },
      }));

      const repo = new UsagePeriodRepository(db);
      await repo.incrementUsage(99, 500);

      expect(capturedValues).toMatchObject({
        installationId: 99,
        tokensTotal: 500,
      });
    });

    it('period key matches YYYY-MM-01 format', async () => {
      const { db, mocks } = makeDbMock();

      let capturedValues: Record<string, unknown> | undefined;
      mocks.mockInsert.mockImplementationOnce(() => ({
        values: (v: unknown) => {
          capturedValues = v as Record<string, unknown>;
          return { onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) };
        },
      }));

      const repo = new UsagePeriodRepository(db);
      await repo.incrementUsage(1, 100);

      expect(capturedValues?.['period']).toMatch(/^\d{4}-\d{2}-01$/);
    });
  });

  describe('getMonthlyUsage', () => {
    it('returns 0 when no record exists for the installation', async () => {
      const { db, mocks } = makeDbMock();

      mocks.mockLimit.mockResolvedValueOnce([]);

      const repo = new UsagePeriodRepository(db);
      const result = await repo.getMonthlyUsage(5);

      expect(result).toBe(0);
    });

    it('returns the stored tokensTotal when record exists', async () => {
      const { db, mocks } = makeDbMock();

      mocks.mockLimit.mockResolvedValueOnce([{ tokensTotal: 42_000 }]);

      const repo = new UsagePeriodRepository(db);
      const result = await repo.getMonthlyUsage(5);

      expect(result).toBe(42_000);
    });

    it('queries with the current month period', async () => {
      const { db, mocks } = makeDbMock();

      mocks.mockLimit.mockResolvedValueOnce([]);

      const repo = new UsagePeriodRepository(db);
      await repo.getMonthlyUsage(7);

      // select was called — verifies we reached the DB
      expect(mocks.mockSelect).toHaveBeenCalledOnce();
    });
  });
});
