import type { Finding } from '../schema/finding.schema.js';
import type {
  DiffChunk,
  TriageResult,
  DeterministicViolation,
  NeighbouringFile,
  ReviewConfig,
} from '../types.js';

export interface ReviewInput {
  diffChunks: DiffChunk[];
  deterministicViolations: DeterministicViolation[];
  archContext: string;
  neighbouringFiles: NeighbouringFile[];
  config: ReviewConfig;
}

export interface ReviewResult {
  findings: Finding[];
  tokensIn: number;
  tokensOut: number;
}

export interface LLMProvider {
  review(input: ReviewInput): Promise<ReviewResult>;
  triage(chunk: DiffChunk): Promise<TriageResult>;
}
