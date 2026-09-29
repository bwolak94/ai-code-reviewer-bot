import { Module } from '@nestjs/common';
import { AnthropicProvider } from './provider/anthropic.provider.js';
import { OllamaProvider } from './provider/ollama.provider.js';
import { TokenBudgetService } from './budget/token-budget.service.js';
import { TwoStageRouter } from './routing/two-stage-router.js';
import type { LLMProvider } from './provider/llm-provider.interface.js';
import type { Logger as PinoLogger } from 'pino';
import { LLM_PROVIDER } from './constants.js';

export { LLM_PROVIDER } from './constants.js';

@Module({
  providers: [
    TokenBudgetService,
    TwoStageRouter,
    {
      provide: LLM_PROVIDER,
      useFactory: (
        budget: TokenBudgetService,
        apiKey: string,
        logger: PinoLogger,
      ): LLMProvider => {
        const backend = process.env['LLM_BACKEND'] ?? 'anthropic';
        if (backend === 'ollama') {
          return new OllamaProvider();
        }
        return new AnthropicProvider(budget, apiKey, logger);
      },
      inject: [TokenBudgetService, { token: 'ANTHROPIC_API_KEY', optional: true }, 'PINO_LOGGER'],
    },
  ],
  exports: [LLM_PROVIDER, TwoStageRouter, TokenBudgetService],
})
export class LlmReviewModule {}
