import { Injectable, Inject } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { Logger as PinoLogger } from 'pino';

const MAX_TOKENS_PER_INSTALLATION_MONTH = 100_000;
// 32 days in seconds
const BUDGET_TTL_SECONDS = 32 * 24 * 60 * 60;

@Injectable()
export class TokenBudgetService {
  constructor(
    @Inject('REDIS_CACHE')
    private readonly redis: Redis,
    @Inject('PINO_LOGGER')
    private readonly logger: PinoLogger,
  ) {}

  private buildBudgetKey(installationId: number): string {
    const now = new Date();
    const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    return `budget:${installationId}:${month}`;
  }

  async checkBudget(
    installationId: number,
    estimatedTokens: number,
  ): Promise<{ exceeded: boolean; remaining: number }> {
    const key = this.buildBudgetKey(installationId);
    const raw = await this.redis.get(key);
    const current = raw !== null ? parseInt(raw, 10) : 0;
    const remaining = MAX_TOKENS_PER_INSTALLATION_MONTH - current;

    if (current + estimatedTokens > MAX_TOKENS_PER_INSTALLATION_MONTH) {
      this.logger.warn(
        { installationId, current, estimatedTokens, remaining },
        'token budget exceeded',
      );
      return { exceeded: true, remaining: Math.max(0, remaining) };
    }

    return { exceeded: false, remaining };
  }

  async recordUsage(
    installationId: number,
    runId: string,
    tokensIn: number,
    tokensOut: number,
  ): Promise<void> {
    const key = this.buildBudgetKey(installationId);
    const delta = tokensIn + tokensOut;

    const pipeline = this.redis.pipeline();
    pipeline.incrby(key, delta);
    pipeline.expire(key, BUDGET_TTL_SECONDS);
    await pipeline.exec();

    this.logger.info(
      { installationId, runId, tokensIn, tokensOut, delta },
      'token usage recorded',
    );
  }
}
