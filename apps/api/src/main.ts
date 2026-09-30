import { initTelemetry } from './telemetry/otel.js';
initTelemetry();
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { pino } from 'pino';
import { AppModule } from './app.module.js';
import { validateEnv } from './config/env.js';

const env = validateEnv();

/**
 * Bootstrap logger used only during startup. Module-level logging uses the
 * PINO_LOGGER token provided by LoggerModule.
 *
 * SEC-008: Pino is configured with redact paths to prevent installation tokens
 * and authorization credentials from appearing in log output. This same
 * configuration is mirrored in LoggerModule for the DI-injected logger.
 */
const bootstrapLogger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  redact: {
    paths: [
      'token',
      'authorization',
      '*.accessToken',
      '*.token',
      'req.headers.authorization',
    ],
    censor: '[REDACTED]',
  },
  ...(env.NODE_ENV !== 'production'
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : {}),
});

async function bootstrap(): Promise<void> {
  const adapter = new FastifyAdapter({
    logger: false,
    // Preserve the raw body buffer for HMAC verification in WebhookGuard.
    // Without this, the guard cannot access the raw bytes used for signature
    // computation — parsed JSON may have reordered keys.
    bodyLimit: 10 * 1024 * 1024, // 10 MB
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    adapter,
    {
      bufferLogs: true,
    },
  );

  app.useLogger({
    log: (msg: string) => bootstrapLogger.info(msg),
    error: (msg: string, trace?: string) =>
      bootstrapLogger.error({ trace }, msg),
    warn: (msg: string) => bootstrapLogger.warn(msg),
    debug: (msg: string) => bootstrapLogger.debug(msg),
    verbose: (msg: string) => bootstrapLogger.trace(msg),
  });

  // init() registers NestJS's default JSON parser. We then replace it with a
  // raw-body parser so WebhookGuard can verify the HMAC signature against the
  // original bytes (parsed JSON may reorder keys and break the signature).
  await app.init();
  const fastify = app.getHttpAdapter().getInstance();
  fastify.removeContentTypeParser('application/json');
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (
      _req: unknown,
      body: Buffer,
      done: (err: null | Error, body: unknown) => void,
    ) => {
      try {
        const parsed: unknown = JSON.parse(body.toString('utf8'));
        const req = _req as Record<string, unknown>;
        req['rawBody'] = body;
        done(null, parsed);
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  await app.listen(env.PORT, '0.0.0.0');

  bootstrapLogger.info(
    { port: env.PORT, nodeEnv: env.NODE_ENV },
    'API service started',
  );
}

bootstrap().catch((err: unknown) => {
  process.stderr.write(
    `Fatal startup error: ${err instanceof Error ? err.stack : String(err)}\n`,
  );
  process.exitCode = 1;
});
