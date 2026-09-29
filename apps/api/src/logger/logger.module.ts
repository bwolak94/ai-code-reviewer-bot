import { Module } from '@nestjs/common';
import { pino } from 'pino';
import { getEnv } from '../config/env.js';

/**
 * Provides the shared Pino logger instance as a NestJS injectable token.
 *
 * SEC-008: The logger is configured with redact paths to prevent installation
 * tokens, authorization headers, and other sensitive values from appearing in
 * structured log output.
 *
 * The `PINO_LOGGER` token is the canonical injection token for the logger.
 * All services should inject it using @Inject('PINO_LOGGER').
 */
@Module({
  providers: [
    {
      provide: 'PINO_LOGGER',
      useFactory: () => {
        const env = getEnv();
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
  ],
  exports: ['PINO_LOGGER'],
})
export class LoggerModule {}
