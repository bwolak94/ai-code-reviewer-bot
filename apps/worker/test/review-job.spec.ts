import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { ReviewJobProcessor } from '../src/review-job/review-job.processor.js';
import { SupersedeService } from '../src/review-job/supersede.service.js';
import { CloneService } from '../src/clone/clone.service.js';
import { WorkspaceService } from '../src/clone/workspace.service.js';
import { DiffFilterService } from '../src/diff/diff-filter.service.js';
import { InstallationTokenService } from '../src/github/installation-token.service.js';
import { ReviewRunRepository } from '@repo/db';
import type { ReviewJobPayload } from '@repo/db';

// Mock withTenantContext to call through immediately — avoids needing a real
// DB transaction in unit tests while still exercising the repository call.
vi.mock('@repo/db', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    withTenantContext: vi.fn(
      async (
        _db: unknown,
        _installationId: unknown,
        fn: (db: unknown) => Promise<unknown>,
      ) => fn(_db),
    ),
  };
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeJob(overrides: Partial<ReviewJobPayload> = {}): {
  id: string;
  data: ReviewJobPayload;
} {
  return {
    id: 'test-job-id',
    data: {
      installationId: 100,
      repositoryId: 200,
      prNumber: 42,
      baseSha: 'base-sha-abc',
      headSha: 'head-sha-xyz',
      baseRef: 'main',
      headRef: 'feat/my-feature',
      enqueuedAt: new Date().toISOString(),
      ...overrides,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ReviewJobProcessor', () => {
  let processor: ReviewJobProcessor;

  let mockCancelStalePrJobs: ReturnType<typeof vi.fn>;
  let mockGetInstallationToken: ReturnType<typeof vi.fn>;
  let mockWorkspaceCreate: ReturnType<typeof vi.fn>;
  let mockClone: ReturnType<typeof vi.fn>;
  let mockFilter: ReturnType<typeof vi.fn>;
  let mockCreateRun: ReturnType<typeof vi.fn>;
  let workspaceCleanup: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();

    workspaceCleanup = vi.fn().mockResolvedValue(undefined);
    mockCancelStalePrJobs = vi.fn().mockResolvedValue(undefined);
    mockGetInstallationToken = vi.fn().mockResolvedValue('ghs_token');
    mockWorkspaceCreate = vi.fn().mockResolvedValue({
      dir: '/tmp/aireview/test-job-id',
      cleanup: workspaceCleanup,
    });
    mockClone = vi.fn().mockResolvedValue({ repoDir: '/tmp/aireview/test-job-id' });
    mockFilter = vi.fn().mockResolvedValue({
      filteredFiles: ['src/app.ts', 'src/utils.ts'],
      summaryOnlyMode: false,
      totalChangedLines: 120,
    });
    mockCreateRun = vi.fn().mockResolvedValue({
      id: 'uuid-run-id',
      repositoryId: 200,
      prNumber: 42,
      baseSha: 'base-sha-abc',
      headSha: 'head-sha-xyz',
      status: 'running',
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReviewJobProcessor,
        {
          provide: SupersedeService,
          useValue: { cancelStalePrJobs: mockCancelStalePrJobs },
        },
        {
          provide: InstallationTokenService,
          useValue: { getInstallationToken: mockGetInstallationToken },
        },
        {
          provide: WorkspaceService,
          useValue: { create: mockWorkspaceCreate },
        },
        {
          provide: CloneService,
          useValue: { clone: mockClone },
        },
        {
          provide: DiffFilterService,
          useValue: { filter: mockFilter },
        },
        {
          provide: ReviewRunRepository,
          useValue: { createRun: mockCreateRun },
        },
        {
          provide: 'DRIZZLE_DB',
          useValue: {},
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
        // BullMQ queue token is not directly needed by the processor in tests
        // but the module wiring may require it; provide a stub.
        {
          provide: getQueueToken('review'),
          useValue: { getJobs: vi.fn().mockResolvedValue([]) },
        },
      ],
    }).compile();

    processor = moduleRef.get(ReviewJobProcessor);
  });

  it('calls SupersedeService.cancelStalePrJobs BEFORE CloneService.clone', async () => {
    const callOrder: string[] = [];

    mockCancelStalePrJobs.mockImplementationOnce(async () => {
      callOrder.push('supersede');
    });
    mockClone.mockImplementationOnce(async () => {
      callOrder.push('clone');
      return { repoDir: '/tmp/aireview/test-job-id' };
    });

    await processor.process(makeJob() as never);

    expect(callOrder.indexOf('supersede')).toBeLessThan(
      callOrder.indexOf('clone'),
    );
  });

  it('calls workspace cleanup in finally even when CloneService throws', async () => {
    mockClone.mockRejectedValueOnce(new Error('network error — clone failed'));

    await expect(processor.process(makeJob() as never)).rejects.toThrow(
      'network error — clone failed',
    );

    expect(workspaceCleanup).toHaveBeenCalledOnce();
  });

  it('calls ReviewRunRepository.createRun with status "running"', async () => {
    await processor.process(makeJob() as never);

    expect(mockCreateRun).toHaveBeenCalledOnce();
    const createRunArg = mockCreateRun.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(createRunArg['status']).toBe('running');
  });

  it('calls workspace cleanup on successful completion', async () => {
    await processor.process(makeJob() as never);

    expect(workspaceCleanup).toHaveBeenCalledOnce();
  });

  it('calls workspace cleanup even when DiffFilterService throws', async () => {
    mockFilter.mockRejectedValueOnce(new Error('diff computation failed'));

    await expect(processor.process(makeJob() as never)).rejects.toThrow(
      'diff computation failed',
    );

    expect(workspaceCleanup).toHaveBeenCalledOnce();
  });

  it('passes the correct PR identifiers to SupersedeService', async () => {
    const job = makeJob({
      installationId: 111,
      repositoryId: 222,
      prNumber: 77,
      headSha: 'specific-sha',
    });

    await processor.process(job as never);

    expect(mockCancelStalePrJobs).toHaveBeenCalledWith(
      111,
      222,
      77,
      'specific-sha',
    );
  });
});
