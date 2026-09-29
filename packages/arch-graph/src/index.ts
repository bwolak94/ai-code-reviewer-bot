export { buildGraph } from './graph-builder.js';
export type { BuildGraphOptions } from './graph-builder.js';

export { graphDelta } from './graph-delta.js';

export { evaluateRules } from './evaluate-rules.js';

export { computeFingerprint } from './fingerprint.js';

export { evaluateLayerDependency } from './rules/layer-dependency.rule.js';
export { evaluateNoCycles } from './rules/no-cycles.rule.js';
export { evaluatePublicApiOnly } from './rules/public-api-only.rule.js';
export { evaluateForbiddenImport } from './rules/forbidden-import.rule.js';

export type {
  GraphNode,
  GraphEdge,
  ModuleGraph,
  RuleViolation,
  LayerConfig,
  RulesConfig,
} from './types.js';
