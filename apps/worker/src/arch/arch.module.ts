import { Module } from '@nestjs/common';
import { GraphCacheService } from './graph-cache.service.js';

/**
 * NestJS module providing the GraphCacheService for HMAC-signed
 * base graph caching in Redis.
 *
 * Depends on SharedModule (via @Global()) for REDIS_CACHE and PINO_LOGGER.
 */
@Module({
  providers: [GraphCacheService],
  exports: [GraphCacheService],
})
export class ArchModule {}
