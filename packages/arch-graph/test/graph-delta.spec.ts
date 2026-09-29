import { describe, it, expect } from 'vitest';
import { graphDelta } from '../src/graph-delta.js';
import { computeFingerprint } from '../src/fingerprint.js';
import type { RuleViolation } from '../src/types.js';

function makeViolation(
  rule: string,
  file: string,
  line: number,
  snippet: string,
  overrides: Partial<RuleViolation> = {},
): RuleViolation {
  return {
    rule,
    file,
    line,
    message: `Violation in ${file}`,
    severity: 'high',
    fingerprint: computeFingerprint(rule, file, snippet),
    ...overrides,
  };
}

describe('graphDelta', () => {
  it('returns empty array when base and head are both empty', () => {
    expect(graphDelta([], [])).toEqual([]);
  });

  it('returns all head violations when base is empty', () => {
    const head = [
      makeViolation('layer-dependency', 'src/a.ts', 1, 'infra'),
      makeViolation('no-cycles', 'src/b.ts', 1, ''),
    ];
    const result = graphDelta([], head);
    expect(result).toHaveLength(2);
    expect(result).toEqual(head);
  });

  it('returns empty array when head is empty', () => {
    const base = [makeViolation('layer-dependency', 'src/a.ts', 1, 'infra')];
    expect(graphDelta(base, [])).toEqual([]);
  });

  it('excludes violations whose fingerprint exists in base', () => {
    const violationA = makeViolation('layer-dependency', 'src/a.ts', 1, 'infra');
    const violationB = makeViolation('layer-dependency', 'src/b.ts', 1, 'infra');
    const violationC = makeViolation('no-cycles', 'src/c.ts', 1, '');

    // base has A + B, head has B + C
    const base = [violationA, violationB];
    const head = [violationB, violationC];

    const result = graphDelta(base, head);

    expect(result).toHaveLength(1);
    expect(result[0]?.fingerprint).toBe(violationC.fingerprint);
  });

  it('returns only new violations (C) when base has A+B and head has B+C', () => {
    const a = makeViolation('layer-dependency', 'src/a.ts', 1, 'infra');
    const b = makeViolation('layer-dependency', 'src/b.ts', 1, 'infra');
    const c = makeViolation('no-cycles', 'src/c.ts', 1, '');

    const result = graphDelta([a, b], [b, c]);

    expect(result).toHaveLength(1);
    expect(result[0]?.file).toBe('src/c.ts');
  });

  it('treats the same violation with different line number as new (different fingerprint)', () => {
    // Fingerprint includes the snippet/specifier, NOT the line number
    // But if the snippet changes (e.g., import target changes), it's a new violation
    const violationLine1 = makeViolation('layer-dependency', 'src/a.ts', 1, 'infra-line1');
    const violationLine2 = makeViolation('layer-dependency', 'src/a.ts', 5, 'infra-line2');

    // Different snippets mean different fingerprints — treated as new
    const result = graphDelta([violationLine1], [violationLine2]);
    expect(result).toHaveLength(1);
    expect(result[0]?.file).toBe('src/a.ts');
  });

  it('excludes identical violations (same fingerprint) from the result', () => {
    const violation = makeViolation('layer-dependency', 'src/a.ts', 1, 'infra');
    const result = graphDelta([violation], [violation]);
    expect(result).toHaveLength(0);
  });

  it('uses fingerprint equality, not object reference equality', () => {
    // Two different objects with the same fingerprint content
    const v1 = makeViolation('layer-dependency', 'src/a.ts', 1, 'infra');
    const v2 = { ...v1 }; // different object reference, same fingerprint

    const result = graphDelta([v1], [v2]);
    expect(result).toHaveLength(0);
  });

  it('handles violation that moves from old line to new line with different fingerprint', () => {
    // Simulates when same logical violation moves to a different line due to code changes
    // If fingerprint includes line number, it would appear as new
    // Our fingerprint uses rule+file+snippet, so line number change alone doesn't change fingerprint
    // But snippet change (import target changes) does create a new fingerprint
    const baseViolation = makeViolation('forbidden-import', 'src/domain/x.ts', 10, '@nestjs/common');
    const headViolation: RuleViolation = {
      ...baseViolation,
      line: 15, // line moved but same import
    };

    // Same fingerprint (fingerprint does not include line) → excluded
    expect(headViolation.fingerprint).toBe(baseViolation.fingerprint);
    const result = graphDelta([baseViolation], [headViolation]);
    expect(result).toHaveLength(0);
  });
});
