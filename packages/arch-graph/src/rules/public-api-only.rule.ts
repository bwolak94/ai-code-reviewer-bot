import path from 'node:path';
import micromatch from 'micromatch';
import type { ModuleGraph, RuleViolation, RulesConfig } from '../types.js';
import { computeFingerprint } from '../fingerprint.js';

/**
 * Evaluates the public-api-only rule.
 *
 * For each module root pattern in `config.modules`, flags any cross-module
 * import that bypasses the module's index.ts public API.
 *
 * A violation occurs when:
 * - File A is OUTSIDE module M
 * - File A imports from a file INSIDE module M
 * - The imported file is NOT the module's index.ts
 */
export function evaluatePublicApiOnly(
  graph: ModuleGraph,
  config: RulesConfig['public-api-only'],
  workspaceDir: string,
): RuleViolation[] {
  if (config === undefined) {
    return [];
  }

  const severity = config.severity ?? 'medium';
  const violations: RuleViolation[] = [];

  // For each module pattern, identify module root directories
  // config.modules contains glob patterns like 'src/moduleA/**' or 'src/*/
  for (const moduleGlob of config.modules) {
    // Find all files that belong to this module
    const moduleFiles = new Set<string>();

    for (const [filePath] of graph.nodes) {
      if (filePath.startsWith('external:')) continue;

      const relativePath = path.relative(workspaceDir, filePath);
      if (micromatch.isMatch(relativePath, moduleGlob, { dot: true })) {
        moduleFiles.add(filePath);
      }
    }

    if (moduleFiles.size === 0) continue;

    // Derive module root directory from the glob pattern
    // For 'src/moduleA/**', the root is 'src/moduleA'
    // For 'src/**', the root is 'src'
    const moduleRoot = getModuleRoot(moduleGlob, workspaceDir);

    // Identify the public API entry point(s)
    const publicApiPaths = new Set<string>();
    for (const filePath of moduleFiles) {
      const relativePath = path.relative(workspaceDir, filePath);
      const basename = path.basename(relativePath);
      if (basename === 'index.ts' || basename === 'index.js') {
        publicApiPaths.add(filePath);
      }
    }

    // Check all edges where:
    // - 'from' is OUTSIDE the module
    // - 'to' is INSIDE the module
    // - 'to' is NOT an index.ts file
    for (const edge of graph.edges) {
      if (edge.from.startsWith('external:') || edge.to.startsWith('external:')) {
        continue;
      }

      const isToInModule = moduleFiles.has(edge.to);
      if (!isToInModule) continue;

      const isToPublicApi = publicApiPaths.has(edge.to);
      if (isToPublicApi) continue;

      // Check if 'from' is outside the module
      const fromRelative = path.relative(workspaceDir, edge.from);
      const isFromInModule = micromatch.isMatch(fromRelative, moduleGlob, { dot: true });
      if (isFromInModule) continue;

      // Also check if the from file is within the same module root directory
      // (to handle sibling files within the same module)
      if (moduleRoot !== null) {
        const fromAbs = edge.from;
        const isFromWithinModuleRoot = fromAbs.startsWith(moduleRoot + path.sep) ||
          fromAbs.startsWith(moduleRoot + '/');
        if (isFromWithinModuleRoot) continue;
      }

      const relFrom = path.relative(workspaceDir, edge.from);
      const relTo = path.relative(workspaceDir, edge.to);

      const fingerprint = computeFingerprint('public-api-only', relFrom, relTo);

      violations.push({
        rule: 'public-api-only',
        file: relFrom,
        line: 1,
        message: `File "${relFrom}" imports from internal path "${relTo}" instead of the module's public API (index.ts)`,
        severity,
        fingerprint,
      });
    }
  }

  return violations;
}

/**
 * Extracts the module root directory from a glob pattern.
 * For 'src/moduleA/**' returns the absolute path of 'src/moduleA'.
 * Returns null if the pattern is too dynamic to determine a root.
 */
function getModuleRoot(moduleGlob: string, workspaceDir: string): string | null {
  // Find the first glob-special character
  const specialIdx = moduleGlob.search(/[*?{[]/);
  if (specialIdx === -1) {
    // No glob chars — treat entire pattern as directory
    return path.join(workspaceDir, moduleGlob);
  }

  // Get the part before the first glob character
  const prefix = moduleGlob.slice(0, specialIdx);
  // Remove trailing slash
  const cleanPrefix = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;

  if (cleanPrefix.length === 0) {
    return null;
  }

  // MED-1: Only use the prefix as a module root when it contains at least one
  // path separator, meaning it points to a specific sub-directory (e.g.
  // 'src/moduleA' from 'src/moduleA/**'). A single-segment prefix like 'src'
  // (from 'src/*/') is a parent that covers multiple modules and would
  // incorrectly suppress violations for all files under that directory.
  // In those cases, rely solely on the micromatch isFromInModule check.
  if (!cleanPrefix.includes('/')) {
    return null;
  }

  return path.join(workspaceDir, cleanPrefix);
}
