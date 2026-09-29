import path from 'node:path';
import micromatch from 'micromatch';
import type { ModuleGraph, RuleViolation, RulesConfig } from '../types.js';
import { computeFingerprint } from '../fingerprint.js';

/**
 * Evaluates the forbidden-import rule.
 *
 * For each `{ from, deny }` entry in the config:
 * - Find all files whose relative path matches the `from` glob
 * - For each such file, check all outgoing edges
 * - If the import target (raw specifier or resolved path) matches any `deny` pattern → violation
 *
 * Bare module specifiers (e.g. '@nestjs/common') are checked against deny
 * patterns using the rawSpecifier stored on the edge.
 */
export function evaluateForbiddenImport(
  graph: ModuleGraph,
  config: RulesConfig['forbidden-import'],
  workspaceDir: string,
): RuleViolation[] {
  if (config === undefined || config.length === 0) {
    return [];
  }

  const violations: RuleViolation[] = [];

  // Build a map from file path → outgoing edges for efficient lookup
  const outgoingEdges = new Map<string, typeof graph.edges>();
  for (const edge of graph.edges) {
    const existing = outgoingEdges.get(edge.from);
    if (existing !== undefined) {
      existing.push(edge);
    } else {
      outgoingEdges.set(edge.from, [edge]);
    }
  }

  for (const rule of config) {
    const severity = rule.severity ?? 'high';

    // Find files matching the 'from' glob
    for (const [filePath] of graph.nodes) {
      if (filePath.startsWith('external:')) continue;

      const relativeFilePath = path.relative(workspaceDir, filePath);

      if (!micromatch.isMatch(relativeFilePath, rule.from, { dot: true })) {
        continue;
      }

      const edges = outgoingEdges.get(filePath) ?? [];

      for (const edge of edges) {
        // Determine what to check against deny patterns:
        // 1. The raw specifier (for bare module names like '@nestjs/common')
        // 2. The relative path of the resolved target (for file imports)
        const rawSpecifier = edge.rawSpecifier ?? '';

        // Check raw specifier against deny patterns (handles bare module names)
        let isDenied = false;
        let matchedDenyPattern = '';

        for (const denyPattern of rule.deny) {
          // Check the raw specifier first (for bare module specifiers)
          if (rawSpecifier.length > 0 && micromatch.isMatch(rawSpecifier, denyPattern, { dot: true })) {
            isDenied = true;
            matchedDenyPattern = denyPattern;
            break;
          }

          // Also check the resolved path if it's not external
          if (!edge.to.startsWith('external:')) {
            const relTo = path.relative(workspaceDir, edge.to);
            if (micromatch.isMatch(relTo, denyPattern, { dot: true })) {
              isDenied = true;
              matchedDenyPattern = denyPattern;
              break;
            }
          }
        }

        if (!isDenied) continue;

        const importTarget = rawSpecifier.length > 0
          ? rawSpecifier
          : (edge.to.startsWith('external:') ? edge.to.slice('external:'.length) : edge.to);

        const fingerprint = computeFingerprint(
          'forbidden-import',
          relativeFilePath,
          matchedDenyPattern + ':' + importTarget,
        );

        violations.push({
          rule: 'forbidden-import',
          file: relativeFilePath,
          line: 1,
          message: `File "${relativeFilePath}" imports "${importTarget}" which matches the forbidden pattern "${matchedDenyPattern}"`,
          severity,
          fingerprint,
        });
      }
    }
  }

  return violations;
}
