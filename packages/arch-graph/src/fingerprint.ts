import { createHash } from 'node:crypto';

/**
 * Computes a SHA-256 based fingerprint for a rule violation.
 * SEC-025: SHA-256 only, never SHA-1.
 *
 * @param rule - The rule name (e.g. 'layer-dependency')
 * @param file - The file path relative to the workspace root
 * @param snippet - A discriminating snippet (e.g. import target, cycle members)
 * @returns 64-character lowercase hex string
 */
export function computeFingerprint(
  rule: string,
  file: string,
  snippet: string,
): string {
  // MED-2: Use null-byte separators to prevent prefix-collision attacks.
  // LOW-4: SHA-256 hex is always exactly 64 chars; no slice needed.
  return createHash('sha256')
    .update(rule).update('\0')
    .update(file).update('\0')
    .update(snippet)
    .digest('hex');
}
