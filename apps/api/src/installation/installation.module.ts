import { Module } from '@nestjs/common';
import { InstallationService } from './installation.service.js';
import { InstallationController } from './installation.controller.js';
import { LoggerModule } from '../logger/logger.module.js';

/**
 * InstallationModule handles GitHub App installation lifecycle events.
 *
 * DbModule is @Global(), so InstallationRepository is available here
 * without explicit import.
 */
@Module({
  imports: [LoggerModule],
  controllers: [InstallationController],
  providers: [InstallationService],
  exports: [InstallationService],
})
export class InstallationModule {}
