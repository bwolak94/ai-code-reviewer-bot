import { Injectable } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

/**
 * Thrown when a workspace pipeline exceeds PIPELINE_TIMEOUT_MS.
 */
export class WorkspaceTimeoutError extends Error {
  constructor(jobId: string) {
    super(`Pipeline timeout exceeded for job ${jobId}`);
    this.name = 'WorkspaceTimeoutError';
  }
}

/**
 * Thrown when a workspace directory exceeds MAX_DISK_BYTES.
 */
export class WorkspaceDiskLimitError extends Error {
  constructor(dir: string, bytes: number, limit: number) {
    super(
      `Workspace disk limit exceeded: ${dir} used ${bytes} bytes (limit ${limit} bytes)`,
    );
    this.name = 'WorkspaceDiskLimitError';
  }
}

/**
 * Enforces resource limits for ephemeral workspace directories.
 *
 * Provides a timeout promise for racing against the pipeline, and a disk
 * usage check that can be called after cloning to prevent runaway repos
 * from filling the worker's disk.
 */
@Injectable()
export class WorkspaceLimitsService {
  /** Max disk usage per workspace directory (500 MB). */
  static readonly MAX_DISK_BYTES = 500 * 1024 * 1024;
  /** Hard timeout for clone + analysis pipeline (5 minutes). */
  static readonly PIPELINE_TIMEOUT_MS = 5 * 60 * 1000;

  /**
   * Returns a `{ promise, cancel }` tuple.
   *
   * `promise` rejects after PIPELINE_TIMEOUT_MS with a WorkspaceTimeoutError.
   * Race it against the actual pipeline to enforce a hard wall-clock limit.
   *
   * `cancel` clears the timer so the rejected promise is never settled —
   * call it once the pipeline completes (success or failure) to avoid leaking
   * the timer reference into the next test or GC cycle.
   */
  createTimeoutPromise(jobId: string): { promise: Promise<never>; cancel: () => void } {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const promise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new WorkspaceTimeoutError(jobId));
      }, WorkspaceLimitsService.PIPELINE_TIMEOUT_MS);

      // Allow Node.js to exit even if this timer is still pending.
      if (typeof timer.unref === 'function') {
        timer.unref();
      }
    });

    const cancel = (): void => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    };

    return { promise, cancel };
  }

  /**
   * Checks the total size of a workspace directory recursively.
   * Throws WorkspaceDiskLimitError if it exceeds MAX_DISK_BYTES.
   */
  async checkDiskUsage(dir: string): Promise<void> {
    const totalBytes = await this._computeDirSize(dir);
    if (totalBytes > WorkspaceLimitsService.MAX_DISK_BYTES) {
      throw new WorkspaceDiskLimitError(
        dir,
        totalBytes,
        WorkspaceLimitsService.MAX_DISK_BYTES,
      );
    }
  }

  /** Maximum directory recursion depth for disk-usage computation. */
  static readonly MAX_DEPTH = 50;

  private async _computeDirSize(dir: string, depth = 0): Promise<number> {
    // HIGH-02: Guard against excessively deep directory trees (e.g. recursive symlinks).
    if (depth > WorkspaceLimitsService.MAX_DEPTH) {
      return 0;
    }

    let total = 0;

    let entryNames: string[];
    try {
      entryNames = await fs.readdir(dir, { encoding: 'utf8' });
    } catch {
      // If the directory cannot be read (e.g., does not exist), treat as 0.
      return 0;
    }

    for (const name of entryNames) {
      const fullPath = join(dir, name);
      let stat: Awaited<ReturnType<typeof fs.lstat>> | undefined;
      try {
        // HIGH-02: Use lstat (not stat) to avoid following symlinks, which
        // could allow a symlink loop to escape the workspace directory.
        stat = await fs.lstat(fullPath);
      } catch {
        // Skip entries that cannot be stat'd (broken symlinks, permissions, etc.)
        continue;
      }

      if (stat.isDirectory()) {
        total += await this._computeDirSize(fullPath, depth + 1);
      } else {
        total += stat.size;
      }
    }

    return total;
  }
}
