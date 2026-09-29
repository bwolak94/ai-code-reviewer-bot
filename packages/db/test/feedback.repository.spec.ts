import { describe, it, expect, vi } from 'vitest';
import { FeedbackRepository } from '../src/repositories/feedback.repository.js';

// ---------------------------------------------------------------------------
// Helpers: build a fresh mock DB on each test to avoid shared state
// ---------------------------------------------------------------------------

function makeDbMock() {
  // select chain: select().from().innerJoin().where().limit()  [for upsertByFingerprint]
  // select chain: select().from().where()                      [for findByFindingId]
  const selectLimit = vi.fn().mockResolvedValue([]);
  const selectWhere = vi.fn().mockReturnValue({ limit: selectLimit });
  const selectInnerJoin = vi.fn().mockReturnValue({ where: selectWhere });
  // from() supports both innerJoin (joining path) and where (direct path)
  const selectFrom = vi.fn().mockReturnValue({ innerJoin: selectInnerJoin, where: selectWhere });

  // insert chain: insert().values().onConflictDoUpdate().returning()
  const insertReturning = vi.fn().mockResolvedValue([]);
  const insertOnConflict = vi.fn().mockReturnValue({ returning: insertReturning });
  const insertValues = vi.fn().mockReturnValue({ onConflictDoUpdate: insertOnConflict });

  // findByFindingId uses select().from().where() — resolves directly from where()
  const db = {
    select: vi.fn().mockReturnValue({ from: selectFrom }),
    insert: vi.fn().mockReturnValue({ values: insertValues }),
  } as unknown as Parameters<typeof FeedbackRepository.prototype.constructor>[0];

  return {
    db,
    selectLimit,
    selectWhere,
    insertReturning,
    insertOnConflict,
    insertValues,
  };
}

const REPO_ID = 42;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FeedbackRepository', () => {
  describe('upsertByFingerprint', () => {
    it('returns null when no finding with the given fingerprint exists in the repository', async () => {
      const { db, selectLimit } = makeDbMock();

      // Finding lookup returns empty (not found)
      selectLimit.mockResolvedValueOnce([]);

      const repo = new FeedbackRepository(db);
      const result = await repo.upsertByFingerprint(
        REPO_ID,
        'a'.repeat(64),
        'ignore',
        'alice',
      );

      expect(result).toBeNull();
    });

    it('does not call insert when no finding is found', async () => {
      const { db, selectLimit, insertValues } = makeDbMock();

      selectLimit.mockResolvedValueOnce([]);

      const repo = new FeedbackRepository(db);
      await repo.upsertByFingerprint(REPO_ID, 'a'.repeat(64), 'ignore', 'alice');

      expect(insertValues).not.toHaveBeenCalled();
    });

    it('upserts feedback when a finding is found in the repository', async () => {
      const { db, selectLimit, insertReturning } = makeDbMock();

      const findingId = 'uuid-finding-1';
      const feedbackRow = {
        id: 'uuid-feedback-1',
        findingId,
        kind: 'ignore',
        actorLogin: 'alice',
      };

      selectLimit.mockResolvedValueOnce([{ id: findingId }]);
      insertReturning.mockResolvedValueOnce([feedbackRow]);

      const repo = new FeedbackRepository(db);
      const result = await repo.upsertByFingerprint(
        REPO_ID,
        'b'.repeat(64),
        'ignore',
        'alice',
      );

      expect(result).toEqual(feedbackRow);
    });

    it('passes kind to onConflictDoUpdate set clause', async () => {
      const { db, selectLimit, insertOnConflict } = makeDbMock();

      selectLimit.mockResolvedValueOnce([{ id: 'uuid-finding-2' }]);

      const repo = new FeedbackRepository(db);
      await repo.upsertByFingerprint(REPO_ID, 'c'.repeat(64), 'up', 'bob');

      expect(insertOnConflict).toHaveBeenCalledOnce();
      expect(insertOnConflict).toHaveBeenCalledWith(
        expect.objectContaining({ set: { kind: 'up' } }),
      );
    });

    it('returns null when insert returning is empty', async () => {
      const { db, selectLimit, insertReturning } = makeDbMock();

      selectLimit.mockResolvedValueOnce([{ id: 'uuid-finding-3' }]);
      insertReturning.mockResolvedValueOnce([]);

      const repo = new FeedbackRepository(db);
      const result = await repo.upsertByFingerprint(REPO_ID, 'd'.repeat(64), 'down', 'charlie');

      expect(result).toBeNull();
    });
  });

  describe('findByFindingId', () => {
    it('returns all feedback rows for a given finding ID', async () => {
      const { db, selectWhere } = makeDbMock();

      const feedbackRows = [
        { id: 'f1', findingId: 'uuid-finding-3', kind: 'up', actorLogin: 'charlie' },
        { id: 'f2', findingId: 'uuid-finding-3', kind: 'ignore', actorLogin: 'diana' },
      ];

      // findByFindingId calls select().from().where() — resolves directly from where()
      selectWhere.mockResolvedValueOnce(feedbackRows);

      const repo = new FeedbackRepository(db);
      const result = await repo.findByFindingId('uuid-finding-3');

      expect(result).toEqual(feedbackRows);
    });

    it('returns an empty array when no feedback exists for the finding', async () => {
      const { db, selectWhere } = makeDbMock();

      selectWhere.mockResolvedValueOnce([]);

      const repo = new FeedbackRepository(db);
      const result = await repo.findByFindingId('uuid-finding-nonexistent');

      expect(result).toEqual([]);
    });
  });
});
