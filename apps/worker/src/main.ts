import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestApplication } from '@nestjs/core';
import { pino } from 'pino';
import { AppModule } from './app.module.js';
import { ReviewJobProcessor } from './review-job/review-job.processor.js';
import { validateWorkerEnv } from './config/env.js';

const env = validateWorkerEnv();

/**
 * Bootstrap logger used during startup before the DI-managed PINO_LOGGER
 * token is available. Mirrors the same redact configuration as LoggerModule.
 *
 * SEC-008: Redact paths prevent tokens from appearing in log output.
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
  const app = await NestFactory.create<NestApplication>(AppModule, {
    bufferLogs: true,
  });

  app.useLogger({
    log: (msg: string) => bootstrapLogger.info(msg),
    error: (msg: string, trace?: string) =>
      bootstrapLogger.error({ trace }, msg),
    warn: (msg: string) => bootstrapLogger.warn(msg),
    debug: (msg: string) => bootstrapLogger.debug(msg),
    verbose: (msg: string) => bootstrapLogger.trace(msg),
  });

  // Listen on port 3001 for health checks (separate from API on 3000).
  await app.listen(3001, '0.0.0.0');

  bootstrapLogger.info(
    { port: 3001, nodeEnv: env.NODE_ENV },
    'worker service ready',
  );

  // ─── Graceful Shutdown (SIGTERM) ────────────────────────────────────────────
  // Per devops-review.md Section 2.2:
  //   1. Set health endpoint to 503 (prevents new traffic)
  //   2. Call worker.pause() — stops fetching new jobs but allows in-flight completion
  //   3. Wait up to 90 seconds for the 'paused' event
  //   4. Close connections and exit 0

  const shutdownState = app.get<{ isShuttingDown: boolean }>('SHUTDOWN_STATE');

  process.on('SIGTERM', () => {
    bootstrapLogger.info('SIGTERM received — initiating graceful shutdown');

    // Step 1: Signal health endpoint to return 503 (load balancer stops routing).
    shutdownState.isShuttingDown = true;

    const SHUTDOWN_TIMEOUT_MS = 90_000;

    const shutdownTimer = setTimeout(() => {
      bootstrapLogger.error(
        { timeoutMs: SHUTDOWN_TIMEOUT_MS },
        'graceful shutdown timed out — forcing exit',
      );
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    shutdownTimer.unref();

    // Step 2: Pause the BullMQ worker — stops fetching new jobs but allows
    // any in-flight job to run to completion (per BullMQ semantics).
    // ReviewJobProcessor.pauseWorker() delegates to this.worker.pause().
    const processor = app.get(ReviewJobProcessor);
    processor
      .pauseWorker()
      .then(() => {
        bootstrapLogger.info('BullMQ worker paused — waiting for in-flight jobs');
        // Step 3: Close all NestJS connections (DB pool, Redis, HTTP server).
        return app.close();
      })
      .then(() => {
        bootstrapLogger.info('worker service shut down cleanly');
        clearTimeout(shutdownTimer);
        process.exit(0);
      })
      .catch((err: unknown) => {
        bootstrapLogger.error(
          { err },
          'error during graceful shutdown — forcing exit',
        );
        clearTimeout(shutdownTimer);
        process.exit(1);
      });
  });
}

bootstrap().catch((err: unknown) => {
  process.stderr.write(
    `Fatal worker startup error: ${err instanceof Error ? err.stack : String(err)}\n`,
  );
  process.exitCode = 1;
});
