export interface DiffChunk {
  file: string;
  hunkText: string;
  startLine: number;
  endLine: number;
  estimatedTokens: number;
}

export interface TriageResult {
  score: number;
  rationale: string;
}

export interface DeterministicViolation {
  rule: string;
  file: string;
  line: number;
  message: string;
  severity: 'high' | 'medium' | 'low';
}

export interface NeighbouringFile {
  path: string;
  content: string;
}

export interface ReviewConfig {
  triageThreshold: number;
  confidenceThreshold: number;
  maxInlineComments: number;
  minSeverityInline: 'high' | 'medium' | 'low';
}
