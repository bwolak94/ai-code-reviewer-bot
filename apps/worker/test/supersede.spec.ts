import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { SupersedeService } from '../src/review-job/supersede.service.js';
import type { ReviewJobPayload } from '@repo/db';

// ---------------------------------------------------------------------------
// Helpers to build fake BullMQ Job objects
// ---------------------------------------------------------------------------

function makeJob(
  installationId: number,
  repositoryId: number,
  prNumber: number,
  headSha: string,
): {
  opts: { jobId: string };
  data: ReviewJobPayload;
  remove: ReturnType<typeof vi.fn>;
} {
  const jobId = `${installationId}:${repositoryId}:${prNumber}:${headSha}`;
  return {
    opts: { jobId },
    data: {
      installationId,
      repositoryId,
      prNumber,
      baseSha: 'base-sha',
      headSha,
      baseRef: 'main',
      headRef: 'feat/branch',
      enqueuedAt: new Date().toISOString(),
    },
    remove: vi.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SupersedeService', () => {
  let service: SupersedeService;
  let mockGetJobs: ReturnType<typeof vi.fn>;

  const INSTALL_ID = 100;
  const REPO_ID = 200;
  const PR_NUMBER = 42;
  const CURRENT_SHA = 'sha-current';
  const STALE_SHA = 'sha-stale';
  const OTHER_SHA = 'sha-other';

  beforeEach(async () => {
    mockGetJobs = vi.fn();

    const moduleRef = await Test.createTestingModule({
      providers: [
        SupersedeService,
        {
          provide: getQueueToken('review'),
          useValue: {
            getJobs: mockGetJobs,
          },
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

    service = moduleRef.get(SupersedeService);
  });

  it('removes a waiting job with the same PR prefix but a different headSha', async () => {
    const staleJob = makeJob(INSTALL_ID, REPO_ID, PR_NUMBER, STALE_SHA);
    mockGetJobs.mockResolvedValue([staleJob]);

    await service.cancelStalePrJobs(INSTALL_ID, REPO_ID, PR_NUMBER, CURRENT_SHA);

    expect(staleJob.remove).toHaveBeenCalledOnce();
  });

  it('does NOT remove a job whose headSha matches the current headSha', async () => {
    const sameJob = makeJob(INSTALL_ID, REPO_ID, PR_NUMBER, CURRENT_SHA);
    mockGetJobs.mockResolvedValue([sameJob]);

    await service.cancelStalePrJobs(INSTALL_ID, REPO_ID, PR_NUMBER, CURRENT_SHA);

    expect(sameJob.remove).not.toHaveBeenCalled();
  });

  it('does NOT remove a job with a different prNumber even if installationId and repositoryId match', async () => {
    const differentPrJob = makeJob(INSTALL_ID, REPO_ID, 99, OTHER_SHA);
    mockGetJobs.mockResolvedValue([differentPrJob]);

    await service.cancelStalePrJobs(INSTALL_ID, REPO_ID, PR_NUMBER, CURRENT_SHA);

    expect(differentPrJob.remove).not.toHaveBeenCalled();
  });

  it('removes multiple stale jobs for the same PR', async () => {
    const stale1 = makeJob(INSTALL_ID, REPO_ID, PR_NUMBER, 'sha-v1');
    const stale2 = makeJob(INSTALL_ID, REPO_ID, PR_NUMBER, 'sha-v2');
    const current = makeJob(INSTALL_ID, REPO_ID, PR_NUMBER, CURRENT_SHA);
    mockGetJobs.mockResolvedValue([stale1, stale2, current]);

    await service.cancelStalePrJobs(INSTALL_ID, REPO_ID, PR_NUMBER, CURRENT_SHA);

    expect(stale1.remove).toHaveBeenCalledOnce();
    expect(stale2.remove).toHaveBeenCalledOnce();
    expect(current.remove).not.toHaveBeenCalled();
  });

  it('does not throw if a stale job.remove() fails (race condition)', async () => {
    const staleJob = makeJob(INSTALL_ID, REPO_ID, PR_NUMBER, STALE_SHA);
    staleJob.remove.mockRejectedValue(new Error('Job already processing'));
    mockGetJobs.mockResolvedValue([staleJob]);

    await expect(
      service.cancelStalePrJobs(INSTALL_ID, REPO_ID, PR_NUMBER, CURRENT_SHA),
    ).resolves.not.toThrow();
  });
});
