/**
 * Namespaced injection tokens for the API metrics module.
 *
 * Kept in a separate file so metrics.controller.ts can import tokens without
 * creating a circular dependency with metrics.module.ts.
 *
 * HIGH-01: Fully-namespaced strings prevent accidental collision with plain
 * string tokens from third-party NestJS modules.
 */
export const PROM_REGISTRY = 'aireview:prom_registry';
export const METRIC_WEBHOOK_RECEIVED = 'aireview:metric:webhook_received';
export const METRIC_JOB_ENQUEUED = 'aireview:metric:job_enqueued';
