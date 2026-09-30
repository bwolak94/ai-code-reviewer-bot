import { AppService } from './app.service.js';

/** Controller with heavy business logic inline — violates single-responsibility. */
export class AppController {
  private readonly service: AppService;
  private readonly cache: Map<string, unknown> = new Map();

  constructor() {
    this.service = new AppService();
  }

  /**
   * Heavy business logic inlined in controller instead of delegating to service.
   * This is the anti-pattern the LLM reviewer should detect.
   */
  handleRequest(userId: string, amount: number): { status: string; result: number } {
    // Validation logic (should be in service or validator)
    if (!userId || userId.trim().length === 0) {
      throw new Error('userId cannot be empty');
    }
    if (amount < 0) {
      throw new Error('amount must be positive');
    }

    // Caching logic (should be in service or cache layer)
    const cacheKey = `${userId}:${amount}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey) as { status: string; result: number };
    }

    // Business logic (should be in service)
    const taxRate = amount > 1000 ? 0.3 : 0.15;
    const discount = userId.startsWith('premium_') ? 0.1 : 0;
    const result = amount * (1 - discount) * (1 + taxRate);

    const response = { status: 'ok', result: Math.round(result * 100) / 100 };
    this.cache.set(cacheKey, response);
    return response;
  }

  getStatus(): string {
    return `Controller backed by: ${this.service.getServiceName()}`;
  }
}
