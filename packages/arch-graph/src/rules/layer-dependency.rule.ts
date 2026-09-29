import path from 'node:path';
import type { ModuleGraph, RuleViolation, RulesConfig } from '../types.js';
import { computeFingerprint } from '../fingerprint.js';

/**
 * Evaluates the layer-dependency rule.
 *
 * For each edge where both source and target have a known layer, checks whether
 * the direction is explicitly permitted in the `allow` configuration.
 * An import from layer A → layer B is allowed only if B is listed in allow[A].
 */
export function evaluateLayerDependency(
  graph: ModuleGraph,
  config: RulesConfig['layer-dependency'],
  workspaceDir: string,
): RuleViolation[] {
  if (config === undefined) {
    return [];
  }

  const severity = config.severity ?? 'high';
  const violations: RuleViolation[] = [];

  for (const edge of graph.edges) {
    // Skip external nodes (bare specifiers won't have layer info in the allow map)
    if (edge.from.startsWith('external:') || edge.to.startsWith('external:')) {
      continue;
    }

    const fromNode = graph.nodes.get(edge.from);
    const toNode = graph.nodes.get(edge.to);

    if (fromNode === undefined || toNode === undefined) {
      continue;
    }

    const fromLayer = fromNode.layerName;
    const toLayer = toNode.layerName;

    // Skip edges where either side has no layer assignment
    if (fromLayer === null || toLayer === null) {
      continue;
    }

    // Same layer imports are always allowed
    if (fromLayer === toLayer) {
      continue;
    }

    const allowedTargets = config.allow[fromLayer] ?? [];
    if (!allowedTargets.includes(toLayer)) {
      const relativeFromPath = path.relative(workspaceDir, edge.from);
      // CRIT-1: Include target file path in snippet to distinguish multiple
      // violations from the same source file to the same forbidden layer.
      const relativeToPath = path.relative(workspaceDir, edge.to);
      const fingerprint = computeFingerprint(
        'layer-dependency',
        relativeFromPath,
        toLayer + ':' + relativeToPath,
      );

      violations.push({
        rule: 'layer-dependency',
        file: relativeFromPath,
        line: 1,
        message: `Layer "${fromLayer}" is not allowed to import from layer "${toLayer}"`,
        severity,
        fingerprint,
      });
    }
  }

  return violations;
}
