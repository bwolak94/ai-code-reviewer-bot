import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { WebhookGuard } from '../webhook/webhook.guard.js';
import { InstallationService } from './installation.service.js';

/**
 * Internal controller for installation lifecycle events.
 *
 * SEC-021: This controller is guarded by WebhookGuard (HMAC verification).
 * Without this guard, any unauthenticated caller could trigger tenant lifecycle
 * mutations (create, delete, suspend installations). The guard ensures all
 * requests carry a valid X-Hub-Signature-256 header signed with the shared
 * GITHUB_WEBHOOK_SECRET.
 *
 * Note: In the current architecture, installation events are routed through
 * WebhookController → WebhookService → InstallationService. This controller
 * exists as an additional direct entry point for internal tooling and is kept
 * guarded as a defensive measure per SEC-021.
 */
@Controller('installations')
@UseGuards(WebhookGuard)
export class InstallationController {
  constructor(private readonly installationService: InstallationService) {}

  @Post('lifecycle')
  @HttpCode(HttpStatus.ACCEPTED)
  async handleLifecycle(
    @Body() body: { action: string; installation: { id: number; account: { login: string; type: string } }; repositories?: Array<{ id: number; full_name: string; private: boolean }> },
  ): Promise<{ status: 'accepted' }> {
    switch (body.action) {
      case 'created':
        await this.installationService.handleCreated(body);
        break;
      case 'deleted':
        await this.installationService.handleDeleted(body);
        break;
      case 'suspend':
        await this.installationService.handleSuspend(body);
        break;
      case 'unsuspend':
        await this.installationService.handleUnsuspend(body);
        break;
      default:
        break;
    }

    return { status: 'accepted' };
  }
}
