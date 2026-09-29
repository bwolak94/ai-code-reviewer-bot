import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { AiReviewConfigSchema } from './schema.js';
import { DEFAULT_CONFIG } from './defaults.js';
import type { AiReviewConfig } from './schema.js';

/**
 * Thrown when the `llm.context` path in ai-review.yml attempts to traverse
 * outside the workspace directory (SEC-006).
 */
export class ConfigPathTraversalError extends Error {
  readonly attemptedPath: string;

  constructor(attemptedPath: string) {
    super(
      `Path traversal detected: "${attemptedPath}" resolves outside the workspace directory`,
    );
    this.name = 'ConfigPathTraversalError';
    this.attemptedPath = attemptedPath;
  }
}

/**
 * Loads and validates the .github/ai-review.yml configuration from the
 * cloned workspace directory.
 *
 * - If the file does not exist, returns DEFAULT_CONFIG.
 * - Validates the file against the Zod schema, applying defaults for missing fields.
 * - If `llm.context` is set, validates the path against traversal (SEC-006):
 *   resolves the path relative to workspaceDir and rejects it if it goes outside.
 * - Reads the context file and slices to 8000 characters (SEC-006 size cap).
 *
 * @param workspaceDir - Absolute path to the workspace root (cloned repo directory)
 * @param configPath - Relative path to the config file (default: '.github/ai-review.yml')
 */
export function loadConfig(
  workspaceDir: string,
  configPath = '.github/ai-review.yml',
): AiReviewConfig {
  // HIGH-1: Validate configPath against path traversal (SEC-006).
  const absConfigPath = path.resolve(workspaceDir, configPath);
  const configRel = path.relative(workspaceDir, absConfigPath);
  if (configRel.startsWith('..') || path.isAbsolute(configRel)) {
    throw new ConfigPathTraversalError(configPath);
  }

  const configFilePath = absConfigPath;

  let rawContent: string;
  try {
    rawContent = fs.readFileSync(configFilePath, 'utf-8');
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      return DEFAULT_CONFIG;
    }
    throw err;
  }

  const parsed = yaml.load(rawContent);
  const validated = AiReviewConfigSchema.parse(parsed);

  // SEC-006: Path traversal protection for llm.context
  if (validated.llm.context !== undefined) {
    const rawContextPath = validated.llm.context;
    const abs = path.resolve(workspaceDir, rawContextPath);
    const rel = path.relative(workspaceDir, abs);

    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new ConfigPathTraversalError(rawContextPath);
    }

    // Read context file and apply 8000-character cap (SEC-006 size cap ~2000 tokens)
    const contextContent = fs.readFileSync(abs, 'utf-8').slice(0, 8000);

    // Return config with the resolved context content (replace path with content)
    return {
      ...validated,
      llm: {
        ...validated.llm,
        context: contextContent,
      },
    };
  }

  return validated;
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
