import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { ReviewQueueService } from '../src/queue/review-queue.service.js';
import { METRIC_JOB_ENQUEUED } from '../src/metrics/metrics.module.js';
import type { ReviewJobPayload } from '@repo/db';

// ---------------------------------------------------------------------------
// Unit tests for ReviewQueueService metric instrumentation
// ---------------------------------------------------------------------------

function makePayload(overrides: Partial<ReviewJobPayload> = {}): ReviewJobPayload {
  return {
    installationId: 10,
    repositoryId: 20,
    prNumber: 5,
    baseSha: 'base-sha',
    headSha: 'head-sha',
    baseRef: 'main',
    headRef: 'feat/test',
    enqueuedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('ReviewQueueService metrics', () => {
  let service: ReviewQueueService;
  let mockMetricInc: ReturnType<typeof vi.fn>;
  let mockQueueAdd: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    mockMetricInc = vi.fn();
    mockQueueAdd = vi.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReviewQueueService,
        {
          provide: getQueueToken('review'),
          useValue: { add: mockQueueAdd },
        },
        {
          provide: 'PINO_LOGGER',
          useValue: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
        },
        {
          provide: METRIC_JOB_ENQUEUED,
          useValue: { inc: mockMetricInc },
        },
      ],
    }).compile();

    service = moduleRef.get(ReviewQueueService);
  });

  it('increments METRIC_JOB_ENQUEUED with repository_id label after enqueue', async () => {
    await service.enqueueReviewJob(makePayload({ repositoryId: 42 }));

    expect(mockMetricInc).toHaveBeenCalledOnce();
    expect(mockMetricInc).toHaveBeenCalledWith({ repository_id: '42' });
  });

  it('increments METRIC_JOB_ENQUEUED even when queue.add is called with dedup jobId', async () => {
    await service.enqueueReviewJob(makePayload({ repositoryId: 99 }));

    expect(mockQueueAdd).toHaveBeenCalledOnce();
    expect(mockMetricInc).toHaveBeenCalledWith({ repository_id: '99' });
  });
});
