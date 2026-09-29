import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { FindingDedupService } from '../src/dedup/dedup.service.js';
import type { DeduplicatedFinding } from '../src/dedup/dedup.service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFinding(
  fingerprint: string,
): DeduplicatedFinding['finding'] {
  return {
    fingerprint,
    source: 'graph',
    ruleOrCategory: 'layer-dependency',
    severity: 'high',
    file: 'src/app.ts',
    line: 10,
    rationale: 'imports from wrong layer',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FindingDedupService', () => {
  let service: FindingDedupService;
  let mockFindFingerprintsByPr: ReturnType<typeof vi.fn>;
  let mockFindSuppressedFingerprints: ReturnType<typeof vi.fn>;

  const REPO_ID = 100;
  const PR_NUMBER = 7;

  const FP_NEW = 'a'.repeat(64);
  const FP_EXISTING = 'b'.repeat(64);
  const FP_SUPPRESSED = 'c'.repeat(64);

  beforeEach(async () => {
    mockFindFingerprintsByPr = vi.fn().mockResolvedValue([]);
    mockFindSuppressedFingerprints = vi.fn().mockResolvedValue([]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        FindingDedupService,
        {
          provide: 'FINDING_REPOSITORY',
          useValue: {
            findFingerprintsByPr: mockFindFingerprintsByPr,
            findSuppressedFingerprints: mockFindSuppressedFingerprints,
          },
        },
        {
          provide: 'FEEDBACK_REPOSITORY',
          useValue: {},
        },
        {
          provide: 'PINO_LOGGER',
          useValue: {
            info: vi.fn(),
            debug: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(FindingDedupService);
  });

  it('marks a finding as new when fingerprint has not been seen before', async () => {
    mockFindFingerprintsByPr.mockResolvedValue([]);
    mockFindSuppressedFingerprints.mockResolvedValue([]);

    const results = await service.deduplicateFindings(REPO_ID, PR_NUMBER, [
      makeFinding(FP_NEW),
    ]);

    expect(results).toHaveLength(1);
    expect(results[0]!.isNew).toBe(true);
    expect(results[0]!.isSuppressed).toBe(false);
  });

  it('marks a finding as NOT new when fingerprint exists in a previous run', async () => {
    mockFindFingerprintsByPr.mockResolvedValue([FP_EXISTING]);
    mockFindSuppressedFingerprints.mockResolvedValue([]);

    const results = await service.deduplicateFindings(REPO_ID, PR_NUMBER, [
      makeFinding(FP_EXISTING),
    ]);

    expect(results).toHaveLength(1);
    expect(results[0]!.isNew).toBe(false);
    expect(results[0]!.isSuppressed).toBe(false);
  });

  it('marks a finding as suppressed when the fingerprint has an ignore feedback', async () => {
    mockFindFingerprintsByPr.mockResolvedValue([FP_SUPPRESSED]);
    mockFindSuppressedFingerprints.mockResolvedValue([FP_SUPPRESSED]);

    const results = await service.deduplicateFindings(REPO_ID, PR_NUMBER, [
      makeFinding(FP_SUPPRESSED),
    ]);

    expect(results).toHaveLength(1);
    expect(results[0]!.isSuppressed).toBe(true);
  });

  it('handles a mix of new, existing, and suppressed findings', async () => {
    mockFindFingerprintsByPr.mockResolvedValue([FP_EXISTING, FP_SUPPRESSED]);
    mockFindSuppressedFingerprints.mockResolvedValue([FP_SUPPRESSED]);

    const findings = [
      makeFinding(FP_NEW),
      makeFinding(FP_EXISTING),
      makeFinding(FP_SUPPRESSED),
    ];

    const results = await service.deduplicateFindings(REPO_ID, PR_NUMBER, findings);

    expect(results).toHaveLength(3);

    const newResult = results.find((r) => r.finding.fingerprint === FP_NEW);
    const existingResult = results.find((r) => r.finding.fingerprint === FP_EXISTING);
    const suppressedResult = results.find((r) => r.finding.fingerprint === FP_SUPPRESSED);

    expect(newResult).toBeDefined();
    expect(newResult!.isNew).toBe(true);
    expect(newResult!.isSuppressed).toBe(false);

    expect(existingResult).toBeDefined();
    expect(existingResult!.isNew).toBe(false);
    expect(existingResult!.isSuppressed).toBe(false);

    expect(suppressedResult).toBeDefined();
    expect(suppressedResult!.isNew).toBe(false);
    expect(suppressedResult!.isSuppressed).toBe(true);
  });

  it('marks a finding as both new and suppressed when it is in suppressed but not existing set', async () => {
    // Edge case: suppression data can exist for a fingerprint not yet in existingSet
    // (e.g., suppressed cross-PR). The service reflects both states independently.
    const FP_SUPPRESS_ONLY = 'd'.repeat(64);
    mockFindFingerprintsByPr.mockResolvedValue([]);
    mockFindSuppressedFingerprints.mockResolvedValue([FP_SUPPRESS_ONLY]);

    const results = await service.deduplicateFindings(REPO_ID, PR_NUMBER, [
      makeFinding(FP_SUPPRESS_ONLY),
    ]);

    expect(results).toHaveLength(1);
    expect(results[0]!.isNew).toBe(true);
    expect(results[0]!.isSuppressed).toBe(true);
  });

  it('returns an empty array when given no findings', async () => {
    const results = await service.deduplicateFindings(REPO_ID, PR_NUMBER, []);
    expect(results).toHaveLength(0);
  });

  it('calls findFingerprintsByPr with the correct repositoryId and prNumber', async () => {
    await service.deduplicateFindings(42, 99, [makeFinding(FP_NEW)]);

    expect(mockFindFingerprintsByPr).toHaveBeenCalledWith(42, 99);
    expect(mockFindSuppressedFingerprints).toHaveBeenCalledWith(42, 99);
  });

  it('fetches existing and suppressed fingerprints in parallel (both called)', async () => {
    await service.deduplicateFindings(REPO_ID, PR_NUMBER, [makeFinding(FP_NEW)]);

    expect(mockFindFingerprintsByPr).toHaveBeenCalledOnce();
    expect(mockFindSuppressedFingerprints).toHaveBeenCalledOnce();
  });
});
