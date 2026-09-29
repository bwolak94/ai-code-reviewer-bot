import {
  Injectable,
  Inject,
  type CanActivate,
  type ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Logger as PinoLogger } from 'pino';
import { getEnv } from '../config/env.js';

/**
 * Guards any route requiring GitHub webhook HMAC verification.
 *
 * Security requirements (from security-audit.md):
 *
 * 1. The raw request body buffer MUST be used for HMAC computation — NOT the
 *    parsed JSON. JSON serialization can reorder keys, producing a different
 *    byte sequence and causing legitimate payloads to fail verification.
 *
 * 2. `crypto.timingSafeEqual` MUST be used for the comparison. A string `===`
 *    check is vulnerable to timing attacks that can reveal the secret byte by
 *    byte through response latency differences.
 *
 * 3. Returns 401 on any failure (missing header, signature mismatch). Never
 *    returns 403 — do not reveal whether the route exists.
 */
@Injectable()
export class WebhookGuard implements CanActivate {
  constructor(
    @Inject('PINO_LOGGER')
    private readonly logger: PinoLogger,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    return this.verifySignature(request);
  }

  /**
   * Verifies the X-Hub-Signature-256 header against the raw request body.
   * Exposed as a public method to allow direct unit testing.
   */
  verifySignature(request: FastifyRequest): boolean {
    // Extract delivery ID for audit log context (may be absent on invalid requests).
    const deliveryId = request.headers['x-github-delivery'] ?? 'unknown';

    const signatureHeader = request.headers['x-hub-signature-256'];

    if (
      signatureHeader === undefined ||
      signatureHeader === null ||
      signatureHeader === ''
    ) {
      this.reject(deliveryId, 'missing-signature');
    }

    const signature = Array.isArray(signatureHeader)
      ? signatureHeader[0]
      : signatureHeader;

    if (signature === undefined || !signature.startsWith('sha256=')) {
      this.reject(deliveryId, 'invalid-signature-format');
    }

    // Raw body must be available as a Buffer. NestJS/Fastify preserves the
    // raw body when `rawBody` option is set or when it is accessed before
    // any body-parsing middleware consumes it.
    const rawBody: Buffer | undefined =
      // @ts-expect-error rawBody is added by our rawBody middleware
      (request.rawBody as Buffer | undefined) ??
      (Buffer.isBuffer(request.body) ? request.body : undefined);

    if (rawBody === undefined) {
      this.reject(deliveryId, 'raw-body-unavailable');
    }

    const env = getEnv();
    const expectedSignature = `sha256=${createHmac('sha256', env.GITHUB_WEBHOOK_SECRET)
      .update(rawBody!)
      .digest('hex')}`;

    const expected = Buffer.from(expectedSignature, 'utf8');
    const actual = Buffer.from(signature!, 'utf8');

    // Buffers must be the same length for timingSafeEqual. A length mismatch
    // itself reveals information, but an invalid format has already been caught
    // above, and a valid sha256= prefix always produces the same length.
    if (expected.length !== actual.length) {
      this.reject(deliveryId, 'signature-mismatch');
    }

    if (!timingSafeEqual(expected, actual)) {
      this.reject(deliveryId, 'signature-mismatch');
    }

    return true;
  }

  /**
   * SEC-030: Emits a structured audit log entry before throwing 401.
   * Every HMAC rejection is recorded with deliveryId and reason so that
   * replay attack probes leave a queryable, structured trail (SEC-013).
   *
   * The `never` return type lets callers use `this.reject(...)` as a
   * terminal statement without a subsequent unreachable `throw`.
   */
  private reject(deliveryId: string | string[], reason: string): never {
    this.logger.warn(
      { deliveryId, accepted: false, reason },
      'webhook rejected — HMAC verification failed',
    );
    throw new UnauthorizedException('Signature verification failed');
  }
}
