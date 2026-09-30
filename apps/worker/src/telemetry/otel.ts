import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

/**
 * Initialises the OpenTelemetry SDK.
 *
 * Call this as the very first statement in main.ts, before any NestJS or
 * framework imports, so auto-instrumentations (HTTP, net, DNS) are registered
 * before those modules are first loaded.
 *
 * When OTEL_EXPORTER_OTLP_ENDPOINT is not set the function is a no-op — this
 * keeps local dev and CI fast without needing a collector sidecar.
 */
export function initTelemetry(): void {
  if (process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] === undefined) {
    return;
  }

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'ai-code-reviewer-worker',
      [ATTR_SERVICE_VERSION]: process.env['APP_VERSION'] ?? '0.0.0',
    }),
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
      getNodeAutoInstrumentations({
        // fs instrumentation generates excessive noise with no actionable signal.
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();

  process.on('SIGTERM', () => {
    sdk.shutdown().catch(() => { /* ignore shutdown errors */ });
  });
}
