import { Controller, Get, Header, Inject, UseGuards } from '@nestjs/common';
import type { Registry } from 'prom-client';
import { PROM_REGISTRY } from './metrics.tokens.js';
import { MetricsGuard } from './metrics.guard.js';

/**
 * Exposes the Prometheus scrape endpoint at GET /metrics on the worker's
 * health port (3001).
 *
 * Access is guarded by MetricsGuard: requires `Authorization: Bearer <token>`
 * when METRICS_TOKEN is set, or restricts to localhost when it is not.
 */
@Controller('metrics')
export class MetricsController {
  constructor(
    @Inject(PROM_REGISTRY)
    private readonly register: Registry,
  ) {}

  @Get()
  @UseGuards(MetricsGuard)
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  getMetrics(): Promise<string> {
    return this.register.metrics();
  }
}
