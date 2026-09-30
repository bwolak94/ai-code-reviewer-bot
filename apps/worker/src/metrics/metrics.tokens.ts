/**
 * Namespaced injection tokens for the worker metrics module.
 *
 * Kept in a separate file so metrics.controller.ts can import tokens without
 * creating a circular dependency with metrics.module.ts.
 *
 * HIGH-01: Fully-namespaced strings prevent accidental collision with plain
 * string tokens from third-party NestJS modules.
 */
export const PROM_REGISTRY = 'aireview:prom_registry';
export const METRIC_JOB_COMPLETED = 'aireview:metric:job_completed';
export const METRIC_JOB_FAILED = 'aireview:metric:job_failed';
export const METRIC_FINDINGS_TOTAL = 'aireview:metric:findings_total';
export const METRIC_LLM_TOKENS_TOTAL = 'aireview:metric:llm_tokens_total';
export const METRIC_RUN_DURATION = 'aireview:metric:run_duration';
