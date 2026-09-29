import { Injectable, Inject } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { Logger as PinoLogger } from 'pino';

export interface WorkspaceHandle {
  dir: string;
  cleanup: () => Promise<void>;
}

/**
 * Manages ephemeral workspace directories under /tmp/aireview/{jobId}.
 *
 * Each job gets an isolated directory so concurrent jobs do not collide.
 * The caller MUST invoke cleanup() in a finally block to prevent disk leaks.
 *
 * SEC-008: Only jobId and dir path are logged — no tokens or URLs.
 */
@Injectable()
export class WorkspaceService {
  private static readonly BASE_DIR = '/tmp/aireview';

  constructor(
    @Inject('PINO_LOGGER')
    private readonly logger: PinoLogger,
  ) {}

  /**
   * Creates a fresh directory at /tmp/aireview/{jobId} and returns a
   * handle with the directory path and a cleanup function.
   *
   * Using the BullMQ jobId as the directory name guarantees uniqueness
   * across concurrent jobs for different PRs.
   */
  async create(jobId: string): Promise<WorkspaceHandle> {
    // Sanitise jobId to prevent path traversal: allow only alphanumeric and :-_
    const safeJobId = jobId.replace(/[^a-zA-Z0-9:_-]/g, '_');
    const dir = join(WorkspaceService.BASE_DIR, safeJobId);

    await fs.mkdir(dir, { recursive: true });

    this.logger.debug({ jobId, dir }, 'workspace created');

    return {
      dir,
      cleanup: async (): Promise<void> => {
        await fs.rm(dir, { recursive: true, force: true });
        this.logger.debug({ jobId, dir }, 'workspace cleaned up');
      },
    };
  }
}
