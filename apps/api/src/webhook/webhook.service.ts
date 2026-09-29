import { Injectable, Inject } from '@nestjs/common';
import type { Logger as PinoLogger } from 'pino';
import { InstallationService } from '../installation/installation.service.js';

type PullRequestAction =
  | 'opened'
  | 'synchronize'
  | 'reopened'
  | 'ready_for_review'
  | 'closed'
  | string;

type InstallationAction =
  | 'created'
  | 'deleted'
  | 'suspend'
  | 'unsuspend'
  | string;

interface PullRequestPayload {
  action: PullRequestAction;
  installation?: { id: number };
  repository?: { full_name: string; id: number };
  pull_request?: {
    number: number;
    head: { sha: string };
    base: { sha: string; ref: string };
  };
}

interface InstallationPayload {
  action: InstallationAction;
  installation: {
    id: number;
    account: { login: string; type: string };
  };
  repositories?: Array<{ id: number; full_name: string; private: boolean }>;
}

interface CheckRunPayload {
  action: string;
  installation?: { id: number };
  check_run?: { id: number };
  repository?: { full_name: string };
}

/**
 * Routes incoming webhook events to the appropriate service handlers.
 *
 * SEC-013: All received webhook events (accepted and routing decisions) are
 * written to a structured Pino log with fields:
 *   deliveryId, event, action, installationId, accepted, reason
 *
 * This provides an audit trail for forensic investigation of replay attacks
 * or abnormal event patterns.
 */
@Injectable()
export class WebhookService {
  constructor(
    @Inject('PINO_LOGGER')
    private readonly logger: PinoLogger,
    private readonly installationService: InstallationService,
  ) {}

  /**
   * Routes a verified, deduplicated webhook event to the correct handler.
   * The controller always returns 202 immediately; this method handles
   * asynchronous processing after the response has been sent.
   */
  async route(
    event: string,
    action: string,
    payload: unknown,
    deliveryId: string,
  ): Promise<void> {
    const installationId =
      this.extractInstallationId(payload) ?? null;

    // SEC-013: Emit structured audit log for every accepted webhook event.
    this.logger.info(
      {
        deliveryId,
        event,
        action,
        installationId,
        accepted: true,
      },
      'webhook received',
    );

    switch (event) {
      case 'pull_request':
        await this.handlePullRequest(
          payload as PullRequestPayload,
          deliveryId,
        );
        break;

      case 'installation':
        await this.handleInstallation(
          payload as InstallationPayload,
          deliveryId,
        );
        break;

      case 'installation_repositories':
        await this.handleInstallationRepositories(
          payload as InstallationPayload,
          deliveryId,
        );
        break;

      case 'check_run':
        await this.handleCheckRun(
          payload as CheckRunPayload,
          deliveryId,
        );
        break;

      default:
        this.logger.info(
          { deliveryId, event, action, accepted: true, reason: 'unhandled-event' },
          'webhook event has no handler — skipping',
        );
    }
  }

  private async handlePullRequest(
    payload: PullRequestPayload,
    deliveryId: string,
  ): Promise<void> {
    const action = payload.action;

    const reviewableActions: PullRequestAction[] = [
      'opened',
      'synchronize',
      'reopened',
      'ready_for_review',
    ];

    if (!reviewableActions.includes(action)) {
      this.logger.info(
        { deliveryId, event: 'pull_request', action, accepted: true, reason: 'non-reviewable-action' },
        'pull_request event skipped — action does not trigger review',
      );
      return;
    }

    const installationId = payload.installation?.id;
    const repoFullName = payload.repository?.full_name;
    const headSha = payload.pull_request?.head.sha;
    const prNumber = payload.pull_request?.number;

    this.logger.info(
      {
        deliveryId,
        event: 'pull_request',
        action,
        installationId,
        repoFullName,
        headSha,
        prNumber,
      },
      'pull_request event accepted for review',
    );

    // M2 will enqueue a BullMQ job here. In M1 the check run is created
    // directly via packages/github as a "hello world" demonstration.
  }

  private async handleInstallation(
    payload: InstallationPayload,
    deliveryId: string,
  ): Promise<void> {
    const action = payload.action;
    const installationId = payload.installation.id;

    this.logger.info(
      { deliveryId, event: 'installation', action, installationId, accepted: true },
      'installation event received',
    );

    switch (action) {
      case 'created':
        await this.installationService.handleCreated(payload);
        break;
      case 'deleted':
        await this.installationService.handleDeleted(payload);
        break;
      case 'suspend':
        await this.installationService.handleSuspend(payload);
        break;
      case 'unsuspend':
        await this.installationService.handleUnsuspend(payload);
        break;
      default:
        this.logger.info(
          { deliveryId, event: 'installation', action, installationId, reason: 'unknown-action' },
          'installation event has unknown action — skipping',
        );
    }
  }

  private async handleInstallationRepositories(
    payload: InstallationPayload,
    deliveryId: string,
  ): Promise<void> {
    const installationId = payload.installation.id;

    this.logger.info(
      {
        deliveryId,
        event: 'installation_repositories',
        action: payload.action,
        installationId,
        accepted: true,
      },
      'installation_repositories event received',
    );

    // M2 will sync repository rows in the database.
  }

  private async handleCheckRun(
    payload: CheckRunPayload,
    deliveryId: string,
  ): Promise<void> {
    if (payload.action !== 'rerequested') {
      return;
    }

    const installationId = payload.installation?.id;
    const checkRunId = payload.check_run?.id;

    this.logger.info(
      {
        deliveryId,
        event: 'check_run',
        action: 'rerequested',
        installationId,
        checkRunId,
        accepted: true,
      },
      'check_run.rerequested — will re-enqueue review job in M2',
    );

    // M2 will re-enqueue a review job here.
  }

  private extractInstallationId(payload: unknown): number | undefined {
    if (typeof payload !== 'object' || payload === null) {
      return undefined;
    }

    const p = payload as Record<string, unknown>;
    const installation = p['installation'];

    if (typeof installation === 'object' && installation !== null) {
      const id = (installation as Record<string, unknown>)['id'];
      if (typeof id === 'number') {
        return id;
      }
    }

    return undefined;
  }
}
