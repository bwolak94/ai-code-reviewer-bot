import { Module } from '@nestjs/common';
import { CloneService } from './clone.service.js';
import { WorkspaceService } from './workspace.service.js';

@Module({
  providers: [CloneService, WorkspaceService],
  exports: [CloneService, WorkspaceService],
})
export class CloneModule {}
