import type { AiReviewConfig } from './schema.js';

/**
 * Default configuration object with all fields filled in.
 * This is the value returned when no .github/ai-review.yml file is present.
 */
export const DEFAULT_CONFIG: AiReviewConfig = {
  version: 1,
  language: 'typescript',
  tsconfig: 'tsconfig.json',
  layers: {},
  rules: {},
  llm: {
    enabled: true,
    focus: [],
  },
  review: {
    min_severity_inline: 'high',
    max_inline_comments: 10,
    ignore: ['**/*.spec.ts', '**/generated/**', 'migrations/**'],
  },
};
