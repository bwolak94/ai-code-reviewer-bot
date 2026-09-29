import { eq, and, sql } from 'drizzle-orm';
import type { DrizzleDb } from '../client.js';
import { usagePeriods } from '../schema.js';

/**
 * Data access layer for the `usage_periods` table.
 *
 * Tracks monthly token consumption per installation for billing cap enforcement.
 * Period format: "YYYY-MM-01" (first day of the month, stored as a date type).
 */
export class UsagePeriodRepository {
  constructor(private readonly db: DrizzleDb) {}

  /**
   * Returns the current month's period key as "YYYY-MM-01".
   */
  private getCurrentPeriod(): string {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    return `${year}-${month}-01`;
  }

  /**
   * Atomically adds `delta` tokens to the monthly counter for this installation.
   * Creates the row if it does not exist (INSERT … ON CONFLICT DO UPDATE).
   * Period format: "YYYY-MM-01" (first day of month, since the column is date type).
   */
  async incrementUsage(installationId: number, delta: number): Promise<void> {
    if (delta <= 0) {
      return;
    }

    const period = this.getCurrentPeriod();

    await this.db
      .insert(usagePeriods)
      .values({
        installationId,
        period,
        tokensTotal: delta,
      })
      .onConflictDoUpdate({
        target: [usagePeriods.installationId, usagePeriods.period],
        set: {
          tokensTotal: sql`${usagePeriods.tokensTotal} + ${delta}`,
        },
      });
  }

  /**
   * Returns total tokens consumed this month for the given installation.
   * Returns 0 if no record exists.
   */
  async getMonthlyUsage(installationId: number): Promise<number> {
    const period = this.getCurrentPeriod();

    const rows = await this.db
      .select({ tokensTotal: usagePeriods.tokensTotal })
      .from(usagePeriods)
      .where(
        and(
          eq(usagePeriods.installationId, installationId),
          eq(usagePeriods.period, period),
        ),
      )
      .limit(1);

    return rows[0]?.tokensTotal ?? 0;
  }
}
