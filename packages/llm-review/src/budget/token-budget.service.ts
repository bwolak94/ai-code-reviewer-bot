import { Injectable, Inject } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { Logger as PinoLogger } from 'pino';

const MAX_TOKENS_PER_INSTALLATION_MONTH = 100_000;
// 32 days in seconds
const BUDGET_TTL_SECONDS = 32 * 24 * 60 * 60;

/**
 * Lua script for atomic check-and-reserve:
 *   KEYS[1] = budget key
 *   ARGV[1] = estimated tokens (0 = read-only check)
 *   ARGV[2] = max tokens
 *   ARGV[3] = TTL in seconds
 * Returns: [exceeded (0|1), remaining]
 */
const CHECK_AND_RESERVE_SCRIPT = `
local current = tonumber(redis.call('GET', KEYS[1])) or 0
local estimated = tonumber(ARGV[1])
local max_tokens = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
if estimated > 0 and current + estimated > max_tokens then
  return {1, math.max(0, max_tokens - current)}
end
if estimated > 0 then
  redis.call('INCRBY', KEYS[1], estimated)
  redis.call('EXPIRE', KEYS[1], ttl)
end
local new_current = current + estimated
return {0, math.max(0, max_tokens - new_current)}
`;

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

  /**
   * Atomically checks whether the budget has capacity for `estimatedTokens`.
   * If `estimatedTokens > 0`, reserves them (increments the counter) in the same
   * atomic operation to prevent concurrent over-spend.
   */
  async checkBudget(
    installationId: number,
    estimatedTokens: number,
  ): Promise<{ exceeded: boolean; remaining: number }> {
    const key = this.buildBudgetKey(installationId);
    const result = (await this.redis.eval(
      CHECK_AND_RESERVE_SCRIPT,
      1,
      key,
      String(estimatedTokens),
      String(MAX_TOKENS_PER_INSTALLATION_MONTH),
      String(BUDGET_TTL_SECONDS),
    )) as [number, number];

    const exceeded = result[0] === 1;
    const remaining = Number(result[1]);

    if (exceeded) {
      this.logger.warn(
        { installationId, estimatedTokens, remaining },
        'token budget exceeded',
      );
    }

    return { exceeded, remaining };
  }

  /**
   * Records actual token usage for telemetry and audit logging.
   * The budget counter is managed by `checkBudget` (which reserves estimated tokens);
   * this method exists for observability purposes.
   */
  async recordUsage(
    installationId: number,
    runId: string,
    tokensIn: number,
    tokensOut: number,
  ): Promise<void> {
    this.logger.info(
      { installationId, runId, tokensIn, tokensOut },
      'token usage recorded',
    );
  }
}
