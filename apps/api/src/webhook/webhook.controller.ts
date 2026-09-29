import {
  Controller,
  Post,
  Headers,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  BadRequestException,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { WebhookGuard } from './webhook.guard.js';
import { DedupService } from './dedup.service.js';
import { WebhookService } from './webhook.service.js';

// TODO: SEC-001 — Add ThrottlerGuard for rate limiting (task-007)
// Implement: 60 events/minute per installation ID, 200/minute per source IP.
// Reference: security-audit.md SEC-001 (Critical) — deferred to task-007 P0.

/**
 * Handles incoming GitHub webhook events.
 *
 * Security model:
 * - WebhookGuard MUST run before the handler — it verifies the HMAC using the
 *   raw request body bytes, not parsed JSON (key reordering would break the sig).
 * - X-GitHub-Delivery is validated as UUID before use as a Redis key (SEC-026).
 * - Duplicate deliveries (same X-GitHub-Delivery) return 202 immediately
 *   without re-processing (idempotency guarantee).
 * - 202 is always returned to GitHub within 200ms; processing is async.
 */
@Controller('webhooks')
@UseGuards(WebhookGuard)
export class WebhookController {
  constructor(
    private readonly dedupService: DedupService,
    private readonly webhookService: WebhookService,
  ) {}

  @Post('github')
  @HttpCode(HttpStatus.ACCEPTED)
  async handleGitHubWebhook(
    @Req() req: FastifyRequest,
    @Headers('x-github-delivery') deliveryId: string | undefined,
    @Headers('x-github-event') event: string | undefined,
    @Body() body: unknown,
  ): Promise<{ status: 'accepted' }> {
    if (deliveryId === undefined || deliveryId === '') {
      throw new BadRequestException('Missing X-GitHub-Delivery header');
    }

    if (event === undefined || event === '') {
      throw new BadRequestException('Missing X-GitHub-Event header');
    }

    // DedupService validates UUID format and throws 400 on malformed IDs
    // (SEC-026). On a duplicate delivery (already seen), returns true.
    const isDuplicate = await this.dedupService.isDuplicate(deliveryId);

    if (isDuplicate) {
      // Return 202 without re-processing — idempotent behaviour.
      return { status: 'accepted' };
    }

    const action =
      typeof body === 'object' &&
      body !== null &&
      'action' in body &&
      typeof (body as Record<string, unknown>)['action'] === 'string'
        ? ((body as Record<string, unknown>)['action'] as string)
        : 'unknown';

    // Fire-and-forget: processing happens asynchronously. GitHub expects the
    // 202 response within a few seconds regardless of processing time.
    void this.webhookService.route(event, action, body, deliveryId).catch(
      (err: unknown) => {
        // Errors in async processing must not crash the process.
        // The 202 has already been sent; log for observability (M7 wiring).
        process.stderr.write(
          `Unhandled error in webhook route [${deliveryId}]: ${
            err instanceof Error ? err.stack : String(err)
          }\n`,
        );
      },
    );

    return { status: 'accepted' };
  }
}
