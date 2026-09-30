import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Custom throttler guard for the GitHub webhook endpoint.
 *
 * Key-generation strategy (SEC-001):
 * - Primary key: X-GitHub-Hook-Installation-Target-Id header, which GitHub
 *   sends on every App webhook delivery and uniquely identifies the
 *   installation. Bucketing by installation isolates rate-limit state so one
 *   installation cannot exhaust capacity for others.
 *   Note: X-GitHub-Delivery cannot be used as the bucket key — it is a unique
 *   UUID per delivery, so each request would get its own fresh bucket.
 * - Fallback: source IP address for requests that lack the installation header
 *   (e.g. GitHub ping events sent during initial App installation).
 *
 * Guard ordering in WebhookController:
 *   1. WebhookThrottlerGuard  — fast header-based key extraction, 429 on excess
 *   2. WebhookGuard           — HMAC signature verification (CPU-heavier)
 * Throttling runs first so that DoS traffic is shed before the HMAC
 * computation runs.
 */
@Injectable()
export class WebhookThrottlerGuard extends ThrottlerGuard {
  /**
   * Override the default IP-based tracker key with a per-installation key.
   *
   * The base class signature uses `Record<string, any>` for the request
   * argument. We access Fastify-specific fields via safe property lookups
   * rather than importing the Fastify type, avoiding the signature mismatch.
   */
  protected override async getTracker(
    req: Record<string, unknown>,
  ): Promise<string> {
    // headers is a plain object on both IncomingMessage and FastifyRequest.
    const headers = req['headers'] as Record<string, string | string[] | undefined> | undefined;

    const installationTargetId =
      headers?.['x-github-hook-installation-target-id'];

    const targetId = Array.isArray(installationTargetId)
      ? installationTargetId[0]
      : installationTargetId;

    if (typeof targetId === 'string' && targetId.length > 0) {
      return `installation:${targetId}`;
    }

    // Fall back to the remote IP. Fastify exposes this as `req.ip`;
    // Node's raw IncomingMessage uses `req.socket.remoteAddress`.
    const ip =
      (req['ip'] as string | undefined) ??
      ((req['socket'] as Record<string, unknown> | undefined)?.['remoteAddress'] as string | undefined) ??
      'unknown';

    return ip;
  }
}
