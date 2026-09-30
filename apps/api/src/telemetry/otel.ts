/**
 * OpenTelemetry SDK initialisation — stub.
 *
 * Full OTel integration (trace propagation, OTLP exporter, auto-instrumentations)
 * is deferred to a follow-up once @opentelemetry/sdk-node packages are added
 * to the lockfile. This file exports a no-op initTelemetry() so callers compile
 * without changes.
 *
 * When activating: import this file FIRST in main.ts (before any NestJS imports)
 * and call initTelemetry() before NestFactory.create().
 */
// TODO(M5): Replace with real OTel SDK init — add @opentelemetry/sdk-node,
// @opentelemetry/auto-instrumentations-node, and OTLP exporter packages,
// then call sdk.start() here before NestFactory.create().
export function initTelemetry(): void {
  // no-op stub — replace with SDK init when OTel packages are installed
}
