import { describe, it, expect, vi, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import {
  WorkspaceLimitsService,
  WorkspaceDiskLimitError,
  WorkspaceTimeoutError,
} from '../src/sandbox/workspace-limits.service.js';

// ---------------------------------------------------------------------------
// createTimeoutPromise tests
// ---------------------------------------------------------------------------

describe('WorkspaceLimitsService.createTimeoutPromise', () => {
  // LOW-04: restore timers in afterEach rather than inside each test body.
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects with WorkspaceTimeoutError after PIPELINE_TIMEOUT_MS', async () => {
    vi.useFakeTimers();

    const service = new WorkspaceLimitsService();
    const { promise } = service.createTimeoutPromise('test-job-id');

    // Advance time past the timeout
    vi.advanceTimersByTime(WorkspaceLimitsService.PIPELINE_TIMEOUT_MS + 1);

    await expect(promise).rejects.toThrow(WorkspaceTimeoutError);
    await expect(promise).rejects.toThrow('test-job-id');
  });

  it('does not reject before PIPELINE_TIMEOUT_MS', async () => {
    vi.useFakeTimers();

    const service = new WorkspaceLimitsService();
    let rejected = false;

    service.createTimeoutPromise('job-123').promise.catch(() => {
      rejected = true;
    });

    // Advance time to just before timeout
    vi.advanceTimersByTime(WorkspaceLimitsService.PIPELINE_TIMEOUT_MS - 100);
    // Allow microtasks to flush
    await Promise.resolve();

    expect(rejected).toBe(false);
  });

  it('includes the jobId in the error message', async () => {
    vi.useFakeTimers();

    const service = new WorkspaceLimitsService();
    const { promise } = service.createTimeoutPromise('specific-job-xyz');

    vi.advanceTimersByTime(WorkspaceLimitsService.PIPELINE_TIMEOUT_MS + 1);

    await expect(promise).rejects.toMatchObject({
      name: 'WorkspaceTimeoutError',
      message: expect.stringContaining('specific-job-xyz') as string,
    });
  });

  it('cancel() prevents the promise from rejecting', async () => {
    vi.useFakeTimers();

    const service = new WorkspaceLimitsService();
    const { promise, cancel } = service.createTimeoutPromise('cancel-job');

    cancel();

    // Advance well past the timeout — promise should stay pending (never reject)
    vi.advanceTimersByTime(WorkspaceLimitsService.PIPELINE_TIMEOUT_MS + 10_000);
    await Promise.resolve();

    let rejected = false;
    promise.catch(() => { rejected = true; });
    await Promise.resolve();

    expect(rejected).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkDiskUsage tests
// ---------------------------------------------------------------------------

describe('WorkspaceLimitsService.checkDiskUsage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves without throwing for a small directory', async () => {
    vi.spyOn(fs, 'readdir').mockResolvedValue(['file1.ts', 'file2.ts'] as never);
    vi.spyOn(fs, 'lstat').mockResolvedValue({ size: 1024, isDirectory: () => false } as never);

    const service = new WorkspaceLimitsService();
    await expect(service.checkDiskUsage('/tmp/test-workspace')).resolves.toBeUndefined();
  });

  it('throws WorkspaceDiskLimitError when directory exceeds MAX_DISK_BYTES', async () => {
    vi.spyOn(fs, 'readdir').mockResolvedValue(['huge-file.bin'] as never);
    vi.spyOn(fs, 'lstat').mockResolvedValue({
      size: WorkspaceLimitsService.MAX_DISK_BYTES + 1,
      isDirectory: () => false,
    } as never);

    const service = new WorkspaceLimitsService();
    await expect(service.checkDiskUsage('/tmp/test-workspace')).rejects.toThrow(
      WorkspaceDiskLimitError,
    );
  });

  it('includes the directory path in WorkspaceDiskLimitError', async () => {
    vi.spyOn(fs, 'readdir').mockResolvedValue(['big.bin'] as never);
    vi.spyOn(fs, 'lstat').mockResolvedValue({
      size: WorkspaceLimitsService.MAX_DISK_BYTES + 100,
      isDirectory: () => false,
    } as never);

    const service = new WorkspaceLimitsService();
    await expect(
      service.checkDiskUsage('/tmp/my-workspace'),
    ).rejects.toMatchObject({
      name: 'WorkspaceDiskLimitError',
      message: expect.stringContaining('/tmp/my-workspace') as string,
    });
  });

  it('resolves for an empty directory', async () => {
    vi.spyOn(fs, 'readdir').mockResolvedValue([] as never);

    const service = new WorkspaceLimitsService();
    await expect(service.checkDiskUsage('/tmp/empty')).resolves.toBeUndefined();
  });

  it('handles nested directories by summing sizes recursively', async () => {
    const readdirSpy = vi.spyOn(fs, 'readdir').mockImplementation(
      async (path: unknown) => {
        if (String(path).endsWith('subdir')) {
          return ['big.bin'] as never;
        }
        return ['subdir', 'root-file.ts'] as never;
      },
    );

    const statSpy = vi.spyOn(fs, 'lstat').mockImplementation(
      async (path: unknown) => {
        if (String(path).endsWith('subdir')) {
          return { size: 0, isDirectory: () => true } as never;
        }
        if (String(path).endsWith('big.bin')) {
          return {
            size: WorkspaceLimitsService.MAX_DISK_BYTES,
            isDirectory: () => false,
          } as never;
        }
        return { size: 1, isDirectory: () => false } as never;
      },
    );

    const service = new WorkspaceLimitsService();
    // Total = MAX_DISK_BYTES + 1 (root-file.ts) → should exceed limit
    await expect(service.checkDiskUsage('/tmp/workspace')).rejects.toThrow(
      WorkspaceDiskLimitError,
    );

    readdirSpy.mockRestore();
    statSpy.mockRestore();
  });

  it('gracefully handles unreadable directories by treating them as size 0', async () => {
    vi.spyOn(fs, 'readdir').mockRejectedValue(new Error('EACCES: permission denied'));

    const service = new WorkspaceLimitsService();
    // Should not throw — unreadable directories count as 0 bytes
    await expect(service.checkDiskUsage('/tmp/unreadable')).resolves.toBeUndefined();
  });
});
