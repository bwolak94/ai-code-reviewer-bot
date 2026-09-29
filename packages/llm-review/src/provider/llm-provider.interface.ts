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

export interface LLMProvider {
  review(input: ReviewInput): Promise<Finding[]>;
  triage(chunk: DiffChunk): Promise<TriageResult>;
}
