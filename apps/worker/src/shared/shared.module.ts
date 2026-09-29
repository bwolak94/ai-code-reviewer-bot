import { Global, Module } from '@nestjs/common';
import { pino } from 'pino';
import { Redis } from 'ioredis';
import { AppAuth } from '@repo/github';
import { getWorkerEnv } from '../config/env.js';

/**
 * Global module that provides shared infrastructure tokens:
 * - PINO_LOGGER: structured logger with token redaction (SEC-008)
 * - REDIS_CACHE: ioredis client for the cache Redis instance (port 6380)
 * - APP_AUTH: GitHub App authentication helper
 * - TOKEN_ENCRYPTION_KEY: 64-char hex key for AES-256-GCM encryption (SEC-003)
 * - SHUTDOWN_STATE: mutable flag for graceful shutdown health signalling
 *
 * Marked @Global() so all worker sub-modules (ReviewJobModule, GithubModule,
 * CloneModule, DiffModule) can inject these tokens without explicit imports.
 */
@Global()
@Module({
  providers: [
    {
      provide: 'PINO_LOGGER',
      useFactory: () => {
        const env = getWorkerEnv();
        return pino({
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
      },
    },
    {
      provide: 'REDIS_CACHE',
      useFactory: (): Redis => {
        const env = getWorkerEnv();
        return new Redis(env.REDIS_CACHE_URL, {
          lazyConnect: true,
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
        });
      },
    },
    {
      provide: 'APP_AUTH',
      useFactory: (): AppAuth => {
        const env = getWorkerEnv();
        return new AppAuth({
          appId: env.GITHUB_APP_ID,
          privateKey: env.GITHUB_PRIVATE_KEY,
        });
      },
    },
    {
      provide: 'TOKEN_ENCRYPTION_KEY',
      useFactory: (): string => getWorkerEnv().TOKEN_ENCRYPTION_KEY,
    },
    {
      // Mutable flag shared between the SIGTERM handler in main.ts and
      // WorkerHealthController to signal 503 during the drain window.
      provide: 'SHUTDOWN_STATE',
      useValue: { isShuttingDown: false } as { isShuttingDown: boolean },
    },
  ],
  exports: [
    'PINO_LOGGER',
    'REDIS_CACHE',
    'APP_AUTH',
    'TOKEN_ENCRYPTION_KEY',
    'SHUTDOWN_STATE',
  ],
})
export class SharedModule {}
