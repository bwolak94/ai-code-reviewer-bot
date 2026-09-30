import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { RetentionService } from '../src/retention/retention.service.js';

// Mock @repo/db to provide a sql tag and avoid a real DB import
vi.mock('@repo/db', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    sql: Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => ({
        queryChunks: strings,
        params: values,
        toSQL: () => ({
          sql: strings.reduce((acc, s, i) => acc + s + (i < values.length ? '$' + String(i + 1) : ''), ''),
          params: values,
        }),
      }),
      { raw: (s: string) => s },
    ),
  };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RetentionService', () => {
  let service: RetentionService;
  let mockExecute: ReturnType<typeof vi.fn>;
  let mockLogger: {
    info: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vi.useFakeTimers();

    mockExecute = vi.fn().mockResolvedValue({ rowCount: 5 });

    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };

    const mockDb = {
      execute: mockExecute,
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        RetentionService,
        {
          provide: 'DRIZZLE_DB',
          useValue: mockDb,
        },
        {
          provide: 'PINO_LOGGER',
          useValue: mockLogger,
        },
      ],
    }).compile();

    service = moduleRef.get(RetentionService);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('calls db.execute to run the DELETE query', async () => {
    await service.purgeOldRuns();

    expect(mockExecute).toHaveBeenCalledOnce();
  });

  it('passes a DELETE FROM review_runs SQL template to db.execute', async () => {
    await service.purgeOldRuns();

    const sqlObj = mockExecute.mock.calls[0]?.[0] as { toSQL: () => { sql: string } };
    expect(sqlObj.toSQL().sql).toMatch(/DELETE FROM review_runs/i);
  });

  it('parameterizes the cutoff timestamp (no string interpolation of days)', async () => {
    await service.purgeOldRuns();

    const sqlObj = mockExecute.mock.calls[0]?.[0] as { toSQL: () => { sql: string; params: unknown[] } };
    const { sql: sqlText, params } = sqlObj.toSQL();
    // SQL should NOT contain the raw number '90'
    expect(sqlText).not.toMatch(/\b90\b/);
    // A timestamp parameter should be passed
    expect(params.length).toBeGreaterThan(0);
  });

  it('logs a completion message with row count after successful purge', async () => {
    await service.purgeOldRuns();

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        retentionDays: 90,
      }),
      'retention purge completed',
    );
  });

  it('logs an error and does not throw when the DB query fails', async () => {
    mockExecute.mockRejectedValueOnce(new Error('DB connection lost'));

    // Should not throw — errors are caught and logged
    await expect(service.purgeOldRuns()).resolves.toBeUndefined();

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) as Error }),
      'retention purge failed',
    );
  });

  it('schedules a setTimeout in onModuleInit', () => {
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

    service.onModuleInit();

    // onModuleInit should schedule a setTimeout for the first 03:00 UTC run
    expect(setTimeoutSpy).toHaveBeenCalledOnce();

    setTimeoutSpy.mockRestore();
  });

  it('fires purgeOldRuns when the scheduled timeout elapses', async () => {
    service.onModuleInit();

    // Advance past the largest possible delay (< 24h)
    vi.advanceTimersByTime(25 * 60 * 60 * 1000);
    // Allow async microtasks to settle
    await Promise.resolve();
    await Promise.resolve();

    expect(mockExecute).toHaveBeenCalled();
  });

  it('clears the interval in onModuleDestroy without throwing', () => {
    service.onModuleInit();
    // Trigger the setTimeout to set the interval
    vi.advanceTimersByTime(25 * 60 * 60 * 1000);

    expect(() => service.onModuleDestroy()).not.toThrow();
  });
});
