import { Injectable, Inject, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import type { Logger as PinoLogger } from 'pino';
import { sql } from '@repo/db';
import type { DrizzleDb } from '@repo/db';

/**
 * Purges review_runs (and cascaded findings) older than RETENTION_DAYS.
 *
 * This is a cross-tenant maintenance operation; it intentionally does NOT
 * use withTenantContext because it needs to operate across all installations.
 *
 * Scheduled nightly at approximately 03:00 UTC via setTimeout + setInterval
 * started in onModuleInit. The interval handle is stored so it can be cleared
 * cleanly in onModuleDestroy, preventing handle leaks on shutdown.
 */
@Injectable()
export class RetentionService implements OnModuleInit, OnModuleDestroy {
  private static readonly RETENTION_DAYS = 90;

  private intervalHandle: ReturnType<typeof setInterval> | undefined;

  constructor(
    @Inject('DRIZZLE_DB')
    private readonly db: DrizzleDb,
    @Inject('PINO_LOGGER')
    private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    // Capture a single timestamp to avoid TOCTOU between the comparison guard
    // and the delay calculation below.
    const now = Date.now();

    // Schedule the first run at the next 03:00 UTC today (if not past) or tomorrow,
    // then every 24h thereafter.
    const nowUtc = new Date(now);
    const todayRun = new Date(
      Date.UTC(
        nowUtc.getUTCFullYear(),
        nowUtc.getUTCMonth(),
        nowUtc.getUTCDate(),
        3, 0, 0, 0, // 03:00:00.000 UTC today
      ),
    );

    // MED-03: If 03:00 UTC today has already passed, schedule for tomorrow.
    const firstRunTime = todayRun.getTime() > now
      ? todayRun
      : new Date(todayRun.getTime() + 24 * 60 * 60 * 1000);

    const msUntilFirstRun = firstRunTime.getTime() - now;

    const startInterval = (): void => {
      void this.purgeOldRuns();
      // CRIT-02: Store the handle so it can be cleared in onModuleDestroy.
      this.intervalHandle = setInterval(() => {
        void this.purgeOldRuns();
      }, 24 * 60 * 60 * 1000);
      this.intervalHandle.unref();
    };

    setTimeout(startInterval, msUntilFirstRun).unref();
  }

  onModuleDestroy(): void {
    if (this.intervalHandle !== undefined) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
  }

  /**
   * Deletes review_runs rows older than RETENTION_DAYS days.
   * The ON DELETE CASCADE FK on `findings.run_id` handles child row deletion.
   *
   * Uses a Drizzle sql template with a parameterized cutoff timestamp to avoid
   * raw string interpolation into the query.
   */
  async purgeOldRuns(): Promise<void> {
    const days = RetentionService.RETENTION_DAYS;

    try {
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const result = await this.db.execute(
        sql`DELETE FROM review_runs WHERE created_at < ${cutoff.toISOString()}::timestamptz`,
      );

      this.logger.info(
        {
          retentionDays: days,
          rowCount: (result as unknown as { rowCount?: number }).rowCount ?? 0,
        },
        'retention purge completed',
      );
    } catch (err) {
      this.logger.error({ err }, 'retention purge failed');
    }
  }
}
