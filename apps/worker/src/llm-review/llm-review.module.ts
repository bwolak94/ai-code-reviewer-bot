import { Module } from '@nestjs/common';
import { LlmReviewModule } from '@repo/llm-review';
import { LlmReviewService } from './llm-review.service.js';

@Module({
  imports: [LlmReviewModule],
  providers: [LlmReviewService],
  exports: [LlmReviewService],
})
export class WorkerLlmReviewModule {}
