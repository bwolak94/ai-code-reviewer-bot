import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';

/**
 * Guards the GET /metrics endpoint from unauthenticated access.
 *
 * If the METRICS_TOKEN environment variable is set, the request must include
 * an `Authorization: Bearer <token>` header matching that value.
 *
 * If METRICS_TOKEN is not configured, access is restricted to requests
 * originating from localhost (127.0.0.1 / ::1) only.
 */
@Injectable()
export class MetricsGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const token = process.env['METRICS_TOKEN'];

    if (token) {
      const auth = req.headers['authorization'] ?? '';
      return auth === `Bearer ${token}`;
    }

    const ip = req.ip ?? req.socket.remoteAddress ?? '';
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  }
}
