import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { CheckRunHandler } from '../src/webhook/handlers/check-run.handler.js';
import { ReviewRunRepository } from '@repo/db';
import { ReviewQueueService } from '../src/queue/review-queue.service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePayload(overrides: Record<string, unknown> = {}): unknown {
  return {
    action: 'rerequested',
    installation: { id: 10 },
    repository: { id: 20, full_name: 'owner/repo' },
    check_run: { id: 999, head_sha: 'abc123', name: 'AI Review' },
    ...overrides,
  };
}

const MOCK_RUN = {
  id: 'uuid-run-1',
  repositoryId: 20,
  prNumber: 5,
  baseSha: 'base-sha',
  headSha: 'head-sha',
  checkRunId: 999,
  status: 'completed',
  createdAt: new Date(),
  tokensIn: 0,
  tokensOut: 0,
  durationMs: null,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CheckRunHandler', () => {
  let handler: CheckRunHandler;
  let mockFindRunByCheckRunId: ReturnType<typeof vi.fn>;
  let mockEnqueueReviewJob: ReturnType<typeof vi.fn>;
  let mockRedisSet: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    mockFindRunByCheckRunId = vi.fn().mockResolvedValue(MOCK_RUN);
    mockEnqueueReviewJob = vi.fn().mockResolvedValue(undefined);
    // Default: key not yet set → 'OK' (acquired)
    mockRedisSet = vi.fn().mockResolvedValue('OK');

    const moduleRef = await Test.createTestingModule({
      providers: [
        CheckRunHandler,
        {
          provide: ReviewRunRepository,
          useValue: { findRunByCheckRunId: mockFindRunByCheckRunId },
        },
        {
          provide: ReviewQueueService,
          useValue: { enqueueReviewJob: mockEnqueueReviewJob },
        },
        {
          provide: 'REDIS_CACHE',
          useValue: { set: mockRedisSet },
        },
        {
          provide: 'PINO_LOGGER',
          useValue: {
            info: vi.fn(),
            warn: vi.fn(),
            debug: vi.fn(),
            error: vi.fn(),
          },
        },
      ],
    }).compile();

    handler = moduleRef.get(CheckRunHandler);
  });

  it('re-enqueues a review job when a matching run is found', async () => {
    await handler.handle(makePayload());

    expect(mockEnqueueReviewJob).toHaveBeenCalledOnce();
    expect(mockEnqueueReviewJob).toHaveBeenCalledWith(
      expect.objectContaining({
        installationId: 10,
        repositoryId: 20,
        prNumber: MOCK_RUN.prNumber,
        baseSha: MOCK_RUN.baseSha,
        headSha: MOCK_RUN.headSha,
      }),
    );
  });

  it('does NOT re-enqueue when no run is found for the checkRunId', async () => {
    mockFindRunByCheckRunId.mockResolvedValue(undefined);

    await handler.handle(makePayload());

    expect(mockEnqueueReviewJob).not.toHaveBeenCalled();
  });

  it('does NOT re-enqueue when action is not "rerequested"', async () => {
    await handler.handle(makePayload({ action: 'completed' }));

    expect(mockFindRunByCheckRunId).not.toHaveBeenCalled();
    expect(mockEnqueueReviewJob).not.toHaveBeenCalled();
  });

  it('does NOT re-enqueue when installationId is missing', async () => {
    const payload = {
      action: 'rerequested',
      // no installation
      repository: { id: 20, full_name: 'owner/repo' },
      check_run: { id: 999, head_sha: 'abc123', name: 'AI Review' },
    };

    await handler.handle(payload);

    expect(mockEnqueueReviewJob).not.toHaveBeenCalled();
  });

  it('does NOT re-enqueue when checkRunId is missing', async () => {
    const payload = {
      action: 'rerequested',
      installation: { id: 10 },
      repository: { id: 20 },
      // no check_run
    };

    await handler.handle(payload);

    expect(mockEnqueueReviewJob).not.toHaveBeenCalled();
  });

  it('does NOT re-enqueue when the dedup key is already set (duplicate re-request)', async () => {
    // Simulate key already exists — redis SET NX returns null
    mockRedisSet.mockResolvedValue(null);

    await handler.handle(makePayload());

    expect(mockEnqueueReviewJob).not.toHaveBeenCalled();
  });

  it('sets the dedup key with NX and EX options on the correct checkRunId', async () => {
    await handler.handle(makePayload());

    expect(mockRedisSet).toHaveBeenCalledWith(
      'rerequest:999',
      '1',
      'EX',
      300,
      'NX',
    );
  });

  it('looks up run by the correct checkRunId', async () => {
    await handler.handle(makePayload());

    expect(mockFindRunByCheckRunId).toHaveBeenCalledWith(999);
  });

  it('enqueued job payload contains an enqueuedAt ISO timestamp', async () => {
    await handler.handle(makePayload());

    const callArg = mockEnqueueReviewJob.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(callArg?.['enqueuedAt']).toBeDefined();
    expect(typeof callArg?.['enqueuedAt']).toBe('string');
  });
});
