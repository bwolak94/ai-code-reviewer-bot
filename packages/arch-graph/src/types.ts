export interface GraphNode {
  filePath: string;       // absolute path
  moduleName: string;     // derived from tsconfig paths or directory name
  layerName: string | null; // null if not matched by any layer glob
}

export interface GraphEdge {
  from: string;           // absolute file path
  to: string;             // absolute file path (may be prefixed with 'external:' for bare specifiers)
  kind: 'static' | 'dynamic' | 'reexport';
  rawSpecifier?: string;  // original import string, e.g. '@nestjs/common'
}

export interface ModuleGraph {
  nodes: Map<string, GraphNode>;  // key: absolute filePath
  edges: GraphEdge[];
}

export interface RuleViolation {
  rule: string;
  file: string;           // relative to workspace root
  line: number;
  message: string;
  severity: 'high' | 'medium' | 'low';
  fingerprint: string;    // 64-char hex SHA-256
}

export interface LayerConfig {
  [layerName: string]: string[];  // glob patterns
}

// exactOptionalPropertyTypes: each optional property is typed as T | undefined
// so it is compatible with Zod's .optional() which also infers T | undefined.
export interface RulesConfig {
  'layer-dependency'?: {
    allow: Record<string, string[]>;
    severity?: 'high' | 'medium' | 'low' | undefined;
  } | undefined;
  'no-cycles'?: {
    scope?: 'file' | 'module' | undefined;
    severity?: 'high' | 'medium' | 'low' | undefined;
  } | undefined;
  'public-api-only'?: {
    modules: string[];
    severity?: 'high' | 'medium' | 'low' | undefined;
  } | undefined;
  'forbidden-import'?: Array<{
    from: string;
    deny: string[];
    severity?: 'high' | 'medium' | 'low' | undefined;
  }> | undefined;
}
