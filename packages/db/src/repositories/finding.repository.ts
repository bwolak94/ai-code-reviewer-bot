import { eq } from 'drizzle-orm';
import type { DrizzleDb } from '../client.js';
import { findings, type Finding, type NewFinding } from '../schema.js';

/**
 * Data access layer for the `findings` table.
 *
 * Findings represent individual rule violations or LLM-detected issues
 * associated with a review run. Fingerprints enable deduplication across runs.
 */
export class FindingRepository {
  constructor(private readonly db: DrizzleDb) {}

  /**
   * Inserts multiple findings for a given review run in a single query.
   * Returns all inserted rows with their generated UUIDs.
   */
  async insertFindings(
    runId: string,
    newFindings: NewFinding[],
  ): Promise<Finding[]> {
    if (newFindings.length === 0) {
      return [];
    }

    const rows = await this.db
      .insert(findings)
      .values(newFindings.map((f) => ({ ...f, runId })))
      .returning();

    return rows;
  }

  /**
   * Returns all findings associated with a specific review run.
   */
  async findByRunId(runId: string): Promise<Finding[]> {
    return this.db
      .select()
      .from(findings)
      .where(eq(findings.runId, runId));
  }

  /**
   * Returns the first finding matching the given fingerprint, or undefined.
   * Used for deduplication lookups across runs.
   */
  async findByFingerprint(fingerprint: string): Promise<Finding | undefined> {
    const rows = await this.db
      .select()
      .from(findings)
      .where(eq(findings.fingerprint, fingerprint))
      .limit(1);

    return rows[0];
  }
}
