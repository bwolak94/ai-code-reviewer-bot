import { Injectable, Inject } from '@nestjs/common';
import type { Logger as PinoLogger } from 'pino';
import { FindingRepository, FeedbackRepository } from '@repo/db';

export interface DeduplicatedFinding {
  finding: {
    fingerprint: string;
    source: string;
    ruleOrCategory: string;
    severity: string;
    file: string;
    line: number | null;
    rationale: string;
  };
  isNew: boolean;
  isSuppressed: boolean;
}

/**
 * Annotates a set of findings for a PR with deduplication metadata.
 *
 * - `isNew`: false if the fingerprint was already seen in a previous run for this PR.
 * - `isSuppressed`: true if a user has issued an `@ai-reviewer ignore` command for
 *   this fingerprint.
 *
 * **Important**: `findFingerprintsByPr` returns fingerprints from ALL persisted runs
 * for this repo+PR. Call `deduplicateFindings` BEFORE inserting the current run's
 * findings to ensure new findings from the current batch are correctly marked as
 * `isNew: true`.
 */
@Injectable()
export class FindingDedupService {
  constructor(
    @Inject('FINDING_REPOSITORY')
    private readonly findingRepo: FindingRepository,
    @Inject('FEEDBACK_REPOSITORY')
    private readonly feedbackRepo: FeedbackRepository,
    @Inject('PINO_LOGGER')
    private readonly logger: PinoLogger,
  ) {}

  /**
   * Given a list of findings for a PR, annotates each with isNew/isSuppressed
   * based on the finding history in the database for that repository + PR.
   */
  async deduplicateFindings(
    repositoryId: number,
    prNumber: number,
    findings: DeduplicatedFinding['finding'][],
  ): Promise<DeduplicatedFinding[]> {
    const [existingFingerprints, suppressedFingerprints] = await Promise.all([
      this.findingRepo.findFingerprintsByPr(repositoryId, prNumber),
      this.findingRepo.findSuppressedFingerprints(repositoryId, prNumber),
    ]);

    const existingSet = new Set(existingFingerprints);
    const suppressedSet = new Set(suppressedFingerprints);

    this.logger.debug(
      {
        repositoryId,
        prNumber,
        existingCount: existingSet.size,
        suppressedCount: suppressedSet.size,
        incomingCount: findings.length,
      },
      'dedup: loaded prior fingerprints',
    );

    return findings.map((finding) => ({
      finding,
      isNew: !existingSet.has(finding.fingerprint),
      isSuppressed: suppressedSet.has(finding.fingerprint),
    }));
  }
}
