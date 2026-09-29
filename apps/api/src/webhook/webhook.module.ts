import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller.js';
import { WebhookService } from './webhook.service.js';
import { WebhookGuard } from './webhook.guard.js';
import { DedupService } from './dedup.service.js';
import { InstallationModule } from '../installation/installation.module.js';
import { RedisModule } from '../redis/redis.module.js';
import { LoggerModule } from '../logger/logger.module.js';

@Module({
  imports: [InstallationModule, RedisModule, LoggerModule],
  controllers: [WebhookController],
  providers: [WebhookService, WebhookGuard, DedupService],
  exports: [WebhookGuard],
})
export class WebhookModule {}
