import type { RuleViolation } from './types.js';

/**
 * Returns only the violations in `head` that are NOT present in `base`,
 * comparing by fingerprint (SHA-256 hex string).
 *
 * This implements the zero-legacy-debt guarantee: violations that already
 * existed in the base branch are excluded, so only newly introduced violations
 * are returned.
 */
export function graphDelta(
  base: RuleViolation[],
  head: RuleViolation[],
): RuleViolation[] {
  const baseFingerprints = new Set<string>(base.map((v) => v.fingerprint));
  return head.filter((v) => !baseFingerprints.has(v.fingerprint));
}
