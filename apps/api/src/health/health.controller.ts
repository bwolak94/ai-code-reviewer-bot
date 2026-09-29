import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';

interface HealthResponse {
  status: 'ok';
  timestamp: string;
}

/**
 * Lightweight liveness probe endpoint.
 * Returns 200 with a JSON body indicating the service is up and the current
 * server timestamp in ISO-8601 format.
 *
 * This endpoint is intentionally unauthenticated — load balancers and
 * container orchestrators need to reach it without credentials.
 */
@Controller('health')
export class HealthController {
  @Get()
  @HttpCode(HttpStatus.OK)
  check(): HealthResponse {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
