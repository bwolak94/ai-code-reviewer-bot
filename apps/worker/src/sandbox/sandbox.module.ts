import { Module } from '@nestjs/common';
import { WorkspaceLimitsService } from './workspace-limits.service.js';

/**
 * Provides sandbox resource-limit services for the worker.
 *
 * Currently provides WorkspaceLimitsService which enforces:
 * - Hard pipeline timeout (5 minutes)
 * - Disk usage ceiling per workspace directory (500 MB)
 */
@Module({
  providers: [WorkspaceLimitsService],
  exports: [WorkspaceLimitsService],
})
export class SandboxModule {}
