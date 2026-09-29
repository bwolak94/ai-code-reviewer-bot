import { eq, and, desc } from 'drizzle-orm';
import type { DrizzleDb } from '../client.js';
import {
  reviewRuns,
  type ReviewRun,
  type NewReviewRun,
} from '../schema.js';
import type { ReviewRunStatus } from '../types.js';

/**
 * Data access layer for the `review_runs` table.
 */
export class ReviewRunRepository {
  constructor(private readonly db: DrizzleDb) {}

  /**
   * Inserts a new review run and returns the generated UUID.
   */
  async createRun(data: NewReviewRun): Promise<ReviewRun> {
    const rows = await this.db
      .insert(reviewRuns)
      .values(data)
      .returning();

    const row = rows[0];
    if (row === undefined) {
      throw new Error('createRun: no row returned after INSERT');
    }
    return row;
  }

  /**
   * Updates the status (and optional extra fields) of a review run.
   */
  async updateRunStatus(
    id: string,
    status: ReviewRunStatus,
    extra?: {
      checkRunId?: number;
      tokensIn?: number;
      tokensOut?: number;
      durationMs?: number;
    },
  ): Promise<void> {
    await this.db
      .update(reviewRuns)
      .set({
        status,
        ...(extra?.checkRunId !== undefined
          ? { checkRunId: extra.checkRunId }
          : {}),
        ...(extra?.tokensIn !== undefined ? { tokensIn: extra.tokensIn } : {}),
        ...(extra?.tokensOut !== undefined
          ? { tokensOut: extra.tokensOut }
          : {}),
        ...(extra?.durationMs !== undefined
          ? { durationMs: extra.durationMs }
          : {}),
      })
      .where(eq(reviewRuns.id, id));
  }

  /**
   * Finds a review run by its associated GitHub Check Run ID.
   * Used when re-requesting a check run via the GitHub UI.
   */
  async findRunByCheckRunId(checkRunId: number): Promise<ReviewRun | undefined> {
    const rows = await this.db
      .select()
      .from(reviewRuns)
      .where(eq(reviewRuns.checkRunId, checkRunId))
      .limit(1);

    return rows[0];
  }

  /**
   * Returns the most recent review run for a given repository + PR combination.
   */
  async findLatestRunForPr(
    repositoryId: number,
    prNumber: number,
  ): Promise<ReviewRun | undefined> {
    const rows = await this.db
      .select()
      .from(reviewRuns)
      .where(
        and(
          eq(reviewRuns.repositoryId, repositoryId),
          eq(reviewRuns.prNumber, prNumber),
        ),
      )
      .orderBy(desc(reviewRuns.createdAt))
      .limit(1);

    return rows[0];
  }
}
