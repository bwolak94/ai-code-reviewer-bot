import { Module } from '@nestjs/common';
import { InstallationTokenService } from './installation-token.service.js';

/**
 * Provides GitHub-related services for the worker.
 *
 * Tokens (REDIS_CACHE, APP_AUTH, TOKEN_ENCRYPTION_KEY, PINO_LOGGER) are
 * provided by the root AppModule and made available here via NestJS module
 * resolution — they must be registered globally or passed via imports.
 *
 * Since AppModule registers these as module-level providers, sub-modules
 * that are children of AppModule can access them if they are in the same
 * dependency graph. We export InstallationTokenService so ReviewJobModule
 * can inject it into ReviewJobProcessor.
 */
@Module({
  providers: [InstallationTokenService],
  exports: [InstallationTokenService],
})
export class GithubModule {}
