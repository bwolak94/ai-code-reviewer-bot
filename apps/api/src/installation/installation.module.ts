import { Module } from '@nestjs/common';
import { InstallationService } from './installation.service.js';
import { InstallationController } from './installation.controller.js';
import { LoggerModule } from '../logger/logger.module.js';

@Module({
  imports: [LoggerModule],
  controllers: [InstallationController],
  providers: [InstallationService],
  exports: [InstallationService],
})
export class InstallationModule {}
