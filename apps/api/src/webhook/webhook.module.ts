import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller.js';
import { WebhookService } from './webhook.service.js';
import { WebhookGuard } from './webhook.guard.js';
import { WebhookThrottlerGuard } from './webhook-throttler.guard.js';
import { DedupService } from './dedup.service.js';
import { CheckRunHandler } from './handlers/check-run.handler.js';
import { ReviewCommentHandler } from './handlers/review-comment.handler.js';
import { InstallationModule } from '../installation/installation.module.js';
import { RedisModule } from '../redis/redis.module.js';
import { LoggerModule } from '../logger/logger.module.js';
import { QueueModule } from '../queue/queue.module.js';

@Module({
  imports: [InstallationModule, RedisModule, LoggerModule, QueueModule],
  controllers: [WebhookController],
  providers: [
    WebhookService,
    WebhookGuard,
    WebhookThrottlerGuard,
    DedupService,
    CheckRunHandler,
    ReviewCommentHandler,
  ],
  exports: [WebhookGuard],
})
export class WebhookModule {}
