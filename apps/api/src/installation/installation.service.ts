import { Injectable, Inject } from '@nestjs/common';
import type { Logger as PinoLogger } from 'pino';

interface InstallationEventPayload {
  installation: {
    id: number;
    account: { login: string; type: string };
  };
  repositories?: Array<{ id: number; full_name: string; private: boolean }>;
}

/**
 * Handles GitHub App installation lifecycle events.
 *
 * In Milestone 1, these are stub implementations that write audit log entries
 * and return immediately. Milestone 2 will add Postgres persistence using
 * the `@repo/db` package.
 *
 * SEC-013: All installation events are logged with structured fields for
 * audit trail completeness.
 */
@Injectable()
export class InstallationService {
  constructor(
    @Inject('PINO_LOGGER')
    private readonly logger: PinoLogger,
  ) {}

  /**
   * Called when a user installs the GitHub App on an account or organization.
   * M2 will: upsert the installation row and bulk-upsert repository rows.
   */
  async handleCreated(payload: InstallationEventPayload): Promise<void> {
    this.logger.info(
      {
        event: 'installation.created',
        installationId: payload.installation.id,
        accountLogin: payload.installation.account.login,
        accountType: payload.installation.account.type,
        repositoryCount: payload.repositories?.length ?? 0,
        audit: true,
      },
      'installation created — DB sync deferred to M2',
    );
  }

  /**
   * Called when a user uninstalls the GitHub App.
   * M2 will: mark the installation as deleted (soft-delete per retention policy).
   */
  async handleDeleted(payload: InstallationEventPayload): Promise<void> {
    this.logger.info(
      {
        event: 'installation.deleted',
        installationId: payload.installation.id,
        accountLogin: payload.installation.account.login,
        audit: true,
      },
      'installation deleted — DB sync deferred to M2',
    );
  }

  /**
   * Called when GitHub suspends an installation (e.g., billing issue).
   * M2 will: set `installation.suspended_at = now()`.
   */
  async handleSuspend(payload: InstallationEventPayload): Promise<void> {
    this.logger.info(
      {
        event: 'installation.suspend',
        installationId: payload.installation.id,
        accountLogin: payload.installation.account.login,
        audit: true,
      },
      'installation suspended — DB sync deferred to M2',
    );
  }

  /**
   * Called when GitHub unsuspends a previously suspended installation.
   * M2 will: set `installation.suspended_at = null`.
   */
  async handleUnsuspend(payload: InstallationEventPayload): Promise<void> {
    this.logger.info(
      {
        event: 'installation.unsuspend',
        installationId: payload.installation.id,
        accountLogin: payload.installation.account.login,
        audit: true,
      },
      'installation unsuspended — DB sync deferred to M2',
    );
  }
}
