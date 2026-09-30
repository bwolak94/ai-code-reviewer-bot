import { Global, Module } from '@nestjs/common';
import {
  collectDefaultMetrics,
  Counter,
  Registry,
} from 'prom-client';
import { MetricsController } from './metrics.controller.js';
import { MetricsGuard } from './metrics.guard.js';
import {
  PROM_REGISTRY,
  METRIC_WEBHOOK_RECEIVED,
  METRIC_JOB_ENQUEUED,
} from './metrics.tokens.js';

// Re-export so callers can import tokens from either metrics.module.ts or
// metrics.tokens.ts — both paths are valid.
export {
  PROM_REGISTRY,
  METRIC_WEBHOOK_RECEIVED,
  METRIC_JOB_ENQUEUED,
} from './metrics.tokens.js';

// MED-01: Worker-only metrics (job_completed, job_failed, findings_total,
// llm_tokens_total, run_duration) are intentionally NOT registered here —
// they belong exclusively in apps/worker/src/metrics/metrics.module.ts.

/**
 * Global Prometheus metrics module for the API application.
 *
 * Registers API-specific custom metrics and exposes them as injectable tokens.
 * Marked @Global() so any module can inject metrics without explicit imports.
 */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [
    MetricsGuard,
    {
      provide: PROM_REGISTRY,
      useFactory: (): Registry => {
        const register = new Registry();
        collectDefaultMetrics({ register });
        return register;
      },
    },
    {
      provide: METRIC_WEBHOOK_RECEIVED,
      useFactory: (register: Registry): Counter => {
        return new Counter({
          name: 'aireview_webhook_received_total',
          help: 'Total number of webhook events received',
          labelNames: ['event', 'action'],
          registers: [register],
        });
      },
      inject: [PROM_REGISTRY],
    },
    {
      provide: METRIC_JOB_ENQUEUED,
      useFactory: (register: Registry): Counter => {
        return new Counter({
          name: 'aireview_job_enqueued_total',
          help: 'Total number of review jobs enqueued',
          labelNames: ['repository_id'],
          registers: [register],
        });
      },
      inject: [PROM_REGISTRY],
    },
  ],
  exports: [
    PROM_REGISTRY,
    METRIC_WEBHOOK_RECEIVED,
    METRIC_JOB_ENQUEUED,
  ],
})
export class MetricsModule {}
