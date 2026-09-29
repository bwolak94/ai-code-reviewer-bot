import { Module } from '@nestjs/common';
import { DiffFilterService } from './diff-filter.service.js';

@Module({
  providers: [DiffFilterService],
  exports: [DiffFilterService],
})
export class DiffModule {}
