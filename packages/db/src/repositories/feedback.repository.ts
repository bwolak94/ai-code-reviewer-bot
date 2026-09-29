import { eq, and } from 'drizzle-orm';
import type { DrizzleDb } from '../client.js';
import { feedback, findings, reviewRuns, type Feedback } from '../schema.js';

/**
 * Data access layer for the `feedback` table.
 *
 * Feedback entries represent user signals (ignore, thumbs up/down) tied to a
 * specific finding, identified by its fingerprint.
 */
export class FeedbackRepository {
  constructor(private readonly db: DrizzleDb) {}

  /**
   * Upserts a feedback entry for a finding identified by fingerprint,
   * scoped to a specific repository to prevent cross-tenant suppression.
   *
   * The finding is resolved by fingerprint + repositoryId (via review_runs JOIN)
   * so a user cannot suppress findings from a repository they do not own.
   * Uses INSERT … ON CONFLICT DO UPDATE to avoid TOCTOU races.
   * Returns null if no finding with the given fingerprint exists in this repository.
   */
  async upsertByFingerprint(
    repositoryId: number,
    fingerprint: string,
    kind: 'ignore' | 'up' | 'down',
    actorLogin: string,
  ): Promise<Feedback | null> {
    // Resolve the finding by fingerprint, scoped to the repository.
    const findingRows = await this.db
      .select({ id: findings.id })
      .from(findings)
      .innerJoin(reviewRuns, eq(findings.runId, reviewRuns.id))
      .where(
        and(
          eq(findings.fingerprint, fingerprint),
          eq(reviewRuns.repositoryId, repositoryId),
        ),
      )
      .limit(1);

    const finding = findingRows[0];
    if (finding === undefined) {
      return null;
    }

    // Atomic upsert — INSERT or UPDATE on (findingId, actorLogin) unique constraint.
    const result = await this.db
      .insert(feedback)
      .values({ findingId: finding.id, kind, actorLogin })
      .onConflictDoUpdate({
        target: [feedback.findingId, feedback.actorLogin],
        set: { kind },
      })
      .returning();

    return result[0] ?? null;
  }

  /**
   * Returns all feedback entries for a given finding ID.
   */
  async findByFindingId(findingId: string): Promise<Feedback[]> {
    return this.db
      .select()
      .from(feedback)
      .where(eq(feedback.findingId, findingId));
  }
}
