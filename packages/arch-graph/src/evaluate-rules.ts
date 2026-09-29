import type { ModuleGraph, RuleViolation, RulesConfig } from './types.js';
import { evaluateLayerDependency } from './rules/layer-dependency.rule.js';
import { evaluateNoCycles } from './rules/no-cycles.rule.js';
import { evaluatePublicApiOnly } from './rules/public-api-only.rule.js';
import { evaluateForbiddenImport } from './rules/forbidden-import.rule.js';

/**
 * Runs all configured rules against a module graph and returns the combined
 * set of violations.
 */
export function evaluateRules(
  graph: ModuleGraph,
  rulesConfig: RulesConfig,
  workspaceDir: string,
): RuleViolation[] {
  const violations: RuleViolation[] = [];

  violations.push(
    ...evaluateLayerDependency(graph, rulesConfig['layer-dependency'], workspaceDir),
  );
  violations.push(
    ...evaluateNoCycles(graph, rulesConfig['no-cycles'], workspaceDir),
  );
  violations.push(
    ...evaluatePublicApiOnly(graph, rulesConfig['public-api-only'], workspaceDir),
  );
  violations.push(
    ...evaluateForbiddenImport(graph, rulesConfig['forbidden-import'], workspaceDir),
  );

  return violations;
}
