import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { computeFingerprint } from '../src/fingerprint.js';

describe('computeFingerprint', () => {
  it('returns a 64-character hex string', () => {
    const result = computeFingerprint('layer-dependency', 'src/domain/user.ts', 'infrastructure');
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]+$/);
  });

  it('produces the same output for the same inputs', () => {
    const a = computeFingerprint('no-cycles', 'src/a.ts,src/b.ts', '');
    const b = computeFingerprint('no-cycles', 'src/a.ts,src/b.ts', '');
    expect(a).toBe(b);
  });

  it('produces different outputs for different inputs', () => {
    const a = computeFingerprint('layer-dependency', 'src/domain/x.ts', 'infra');
    const b = computeFingerprint('layer-dependency', 'src/domain/y.ts', 'infra');
    expect(a).not.toBe(b);
  });

  it('uses SHA-256 (not SHA-1) — output matches manual sha256 computation', () => {
    const rule = 'layer-dependency';
    const file = 'src/domain/user.ts';
    const snippet = 'infrastructure';

    // Uses null-byte separators (MED-2) to prevent prefix-collision attacks
    const expected = createHash('sha256')
      .update(rule).update('\0')
      .update(file).update('\0')
      .update(snippet)
      .digest('hex');

    expect(computeFingerprint(rule, file, snippet)).toBe(expected);
  });

  it('SHA-1 would produce a different result — confirm we are not using SHA-1', () => {
    const rule = 'no-cycles';
    const file = 'src/a.ts';
    const snippet = '';

    const sha1Result = createHash('sha1')
      .update(rule).update('\0')
      .update(file).update('\0')
      .update(snippet)
      .digest('hex')
      .slice(0, 40); // SHA-1 is 40 hex chars

    const sha256Result = computeFingerprint(rule, file, snippet);

    expect(sha256Result).not.toBe(sha1Result);
  });

  it('different snippet for same rule and file produces different fingerprint', () => {
    const a = computeFingerprint('layer-dependency', 'src/domain/x.ts', 'infrastructure');
    const b = computeFingerprint('layer-dependency', 'src/domain/x.ts', 'presentation');
    expect(a).not.toBe(b);
  });

  it('empty snippet is valid', () => {
    const result = computeFingerprint('no-cycles', 'src/a.ts,src/b.ts', '');
    expect(result).toHaveLength(64);
  });
});
