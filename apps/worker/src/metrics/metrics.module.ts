import { Global, Module } from '@nestjs/common';
import {
  collectDefaultMetrics,
  Counter,
  Histogram,
  Registry,
} from 'prom-client';
import { MetricsController } from './metrics.controller.js';
import { MetricsGuard } from './metrics.guard.js';
import {
  PROM_REGISTRY,
  METRIC_JOB_COMPLETED,
  METRIC_JOB_FAILED,
  METRIC_FINDINGS_TOTAL,
  METRIC_LLM_TOKENS_TOTAL,
  METRIC_RUN_DURATION,
} from './metrics.tokens.js';

// Re-export so callers can import tokens from either metrics.module.ts or
// metrics.tokens.ts — both paths are valid.
export {
  PROM_REGISTRY,
  METRIC_JOB_COMPLETED,
  METRIC_JOB_FAILED,
  METRIC_FINDINGS_TOTAL,
  METRIC_LLM_TOKENS_TOTAL,
  METRIC_RUN_DURATION,
} from './metrics.tokens.js';

/**
 * Global Prometheus metrics module for the worker application.
 *
 * Registers all custom worker metrics and exposes them as injectable tokens.
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
      provide: METRIC_JOB_COMPLETED,
      useFactory: (register: Registry): Counter => {
        return new Counter({
          name: 'aireview_job_completed_total',
          help: 'Total number of review jobs completed',
          labelNames: ['conclusion'],
          registers: [register],
        });
      },
      inject: [PROM_REGISTRY],
    },
    {
      provide: METRIC_JOB_FAILED,
      useFactory: (register: Registry): Counter => {
        return new Counter({
          name: 'aireview_job_failed_total',
          help: 'Total number of review jobs failed',
          // LOW-03: labelNames includes 'reason' for future failure categorisation.
          labelNames: ['reason'],
          registers: [register],
        });
      },
      inject: [PROM_REGISTRY],
    },
    {
      provide: METRIC_FINDINGS_TOTAL,
      useFactory: (register: Registry): Counter => {
        return new Counter({
          name: 'aireview_findings_total',
          help: 'Total number of findings produced',
          labelNames: ['source', 'severity'],
          registers: [register],
        });
      },
      inject: [PROM_REGISTRY],
    },
    {
      provide: METRIC_LLM_TOKENS_TOTAL,
      useFactory: (register: Registry): Counter => {
        return new Counter({
          name: 'aireview_llm_tokens_total',
          help: 'Total LLM tokens consumed',
          labelNames: ['direction'],
          registers: [register],
        });
      },
      inject: [PROM_REGISTRY],
    },
    {
      provide: METRIC_RUN_DURATION,
      useFactory: (register: Registry): Histogram => {
        return new Histogram({
          name: 'aireview_run_duration_seconds',
          help: 'Duration of review job pipeline in seconds',
          labelNames: ['conclusion'],
          buckets: [1, 5, 10, 30, 60, 120, 300],
          registers: [register],
        });
      },
      inject: [PROM_REGISTRY],
    },
  ],
  exports: [
    PROM_REGISTRY,
    METRIC_JOB_COMPLETED,
    METRIC_JOB_FAILED,
    METRIC_FINDINGS_TOTAL,
    METRIC_LLM_TOKENS_TOTAL,
    METRIC_RUN_DURATION,
  ],
})
export class MetricsModule {}
