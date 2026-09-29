/**
 * ReviewJobPayload — the minimal set of identifiers placed in a BullMQ job.
 *
 * SEC-004: No display names (repositoryFullName, accountLogin, etc.) are
 * stored in the Redis queue. Worker resolves those from the database using
 * the IDs. This limits exposure of PII/metadata in the queue datastore.
 */
export interface ReviewJobPayload {
  installationId: number;
  repositoryId: number;
  prNumber: number;
  baseSha: string;
  headSha: string;
  baseRef: string;
  headRef: string;
  enqueuedAt: string; // ISO 8601
}

/**
 * Review run status values — mirrors the `status` column in `review_runs`.
 */
export type ReviewRunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'superseded';

/**
 * DiffFilterResult returned by DiffFilterService.
 */
export interface DiffFilterResult {
  filteredFiles: string[];
  summaryOnlyMode: boolean;
  totalChangedLines: number;
}
