import { Injectable, Inject } from '@nestjs/common';
import type { Logger as PinoLogger } from 'pino';
import { InstallationRepository } from '@repo/db';

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
 * Persists installation and repository records to PostgreSQL via
 * InstallationRepository (@repo/db). All mutations are structured-logged
 * for audit trail completeness (SEC-013).
 */
@Injectable()
export class InstallationService {
  constructor(
    @Inject('PINO_LOGGER')
    private readonly logger: PinoLogger,
    private readonly installationRepository: InstallationRepository,
  ) {}

  /**
   * Called when a user installs the GitHub App on an account or organization.
   * Upserts the installation row and bulk-upserts repository rows.
   */
  async handleCreated(payload: InstallationEventPayload): Promise<void> {
    const { id, account } = payload.installation;

    await this.installationRepository.upsertInstallation({
      id,
      accountLogin: account.login,
      accountType: account.type,
    });

    const repos = payload.repositories ?? [];
    for (const repo of repos) {
      await this.installationRepository.upsertRepository({
        id: repo.id,
        installationId: id,
        fullName: repo.full_name,
      });
    }

    this.logger.info(
      {
        event: 'installation.created',
        installationId: id,
        accountLogin: account.login,
        accountType: account.type,
        repositoryCount: repos.length,
        audit: true,
      },
      'installation created — persisted to DB',
    );
  }

  /**
   * Called when a user uninstalls the GitHub App.
   * Logs the deletion for audit; cascade deletes handled at DB level.
   */
  async handleDeleted(payload: InstallationEventPayload): Promise<void> {
    const { id, account } = payload.installation;

    this.logger.info(
      {
        event: 'installation.deleted',
        installationId: id,
        accountLogin: account.login,
        audit: true,
      },
      'installation deleted — cascade handled by DB FK constraints',
    );
  }

  /**
   * Called when GitHub suspends an installation (e.g., billing issue).
   * Sets `installation.suspended_at = now()`.
   */
  async handleSuspend(payload: InstallationEventPayload): Promise<void> {
    const { id, account } = payload.installation;
    const suspendedAt = new Date();

    await this.installationRepository.suspendInstallation(id, suspendedAt);

    this.logger.info(
      {
        event: 'installation.suspend',
        installationId: id,
        accountLogin: account.login,
        suspendedAt: suspendedAt.toISOString(),
        audit: true,
      },
      'installation suspended',
    );
  }

  /**
   * Called when GitHub unsuspends a previously suspended installation.
   * Clears `installation.suspended_at`.
   */
  async handleUnsuspend(payload: InstallationEventPayload): Promise<void> {
    const { id, account } = payload.installation;

    await this.installationRepository.unsuspendInstallation(id);

    this.logger.info(
      {
        event: 'installation.unsuspend',
        installationId: id,
        accountLogin: account.login,
        audit: true,
      },
      'installation unsuspended',
    );
  }
}
