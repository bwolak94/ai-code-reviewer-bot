import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadConfig, ConfigPathTraversalError } from '../src/loader.js';
import { DEFAULT_CONFIG } from '../src/defaults.js';

/**
 * Creates a temporary workspace directory for each test.
 */
function createTempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ai-review-config-test-'));
}

function writeConfig(workspaceDir: string, content: string, configPath = '.github/ai-review.yml'): void {
  const fullPath = path.join(workspaceDir, configPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf-8');
}

describe('loadConfig', () => {
  let workspaceDir: string;

  beforeEach(() => {
    workspaceDir = createTempWorkspace();
  });

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  it('returns DEFAULT_CONFIG when config file does not exist', () => {
    const config = loadConfig(workspaceDir);
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it('parses a valid YAML config with all required fields', () => {
    const yamlContent = `
version: 1
language: typescript
tsconfig: tsconfig.json
layers:
  domain:
    - src/domain/**
  infrastructure:
    - src/infrastructure/**
rules:
  layer-dependency:
    allow:
      application:
        - domain
      infrastructure:
        - domain
    severity: high
  no-cycles:
    scope: module
    severity: high
llm:
  enabled: true
  focus:
    - architecture
review:
  min_severity_inline: high
  max_inline_comments: 10
  ignore:
    - "**/*.spec.ts"
`;
    writeConfig(workspaceDir, yamlContent);

    const config = loadConfig(workspaceDir);

    expect(config.version).toBe(1);
    expect(config.language).toBe('typescript');
    expect(config.layers['domain']).toEqual(['src/domain/**']);
    expect(config.rules['layer-dependency']?.allow['application']).toEqual(['domain']);
    expect(config.rules['no-cycles']?.scope).toBe('module');
    expect(config.llm.enabled).toBe(true);
    expect(config.review.max_inline_comments).toBe(10);
  });

  it('applies defaults for missing optional fields', () => {
    const yamlContent = `
version: 1
`;
    writeConfig(workspaceDir, yamlContent);

    const config = loadConfig(workspaceDir);

    expect(config.version).toBe(1);
    expect(config.language).toBe('typescript');
    expect(config.tsconfig).toBe('tsconfig.json');
    expect(config.layers).toEqual({});
    expect(config.rules).toEqual({});
    expect(config.llm.enabled).toBe(true);
    expect(config.llm.focus).toEqual([]);
    expect(config.review.min_severity_inline).toBe('high');
    expect(config.review.max_inline_comments).toBe(10);
    expect(config.review.ignore).toEqual(['**/*.spec.ts', '**/generated/**', 'migrations/**']);
  });

  it('applies default severity for missing rules.no-cycles severity', () => {
    const yamlContent = `
version: 1
rules:
  no-cycles: {}
`;
    writeConfig(workspaceDir, yamlContent);

    const config = loadConfig(workspaceDir);

    expect(config.rules['no-cycles']?.severity).toBe('high');
  });

  it('throws ConfigPathTraversalError for llm.context path traversal (../../etc/passwd)', () => {
    const yamlContent = `
version: 1
llm:
  context: "../../etc/passwd"
`;
    writeConfig(workspaceDir, yamlContent);

    expect(() => loadConfig(workspaceDir)).toThrow(ConfigPathTraversalError);
    expect(() => loadConfig(workspaceDir)).toThrow('../../etc/passwd');
  });

  it('ConfigPathTraversalError is a typed error class (not generic Error)', () => {
    const yamlContent = `
version: 1
llm:
  context: "../outside/file.md"
`;
    writeConfig(workspaceDir, yamlContent);

    try {
      loadConfig(workspaceDir);
      expect.fail('should have thrown ConfigPathTraversalError');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigPathTraversalError);
      expect(err).toBeInstanceOf(Error);
      if (err instanceof ConfigPathTraversalError) {
        expect(err.name).toBe('ConfigPathTraversalError');
        expect(err.attemptedPath).toBe('../outside/file.md');
      }
    }
  });

  it('succeeds for llm.context within the workspace', () => {
    // Create a docs directory and arch file within the workspace
    const docsDir = path.join(workspaceDir, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, 'arch.md'), '# Architecture\n\nSome content here.', 'utf-8');

    const yamlContent = `
version: 1
llm:
  context: "docs/arch.md"
`;
    writeConfig(workspaceDir, yamlContent);

    const config = loadConfig(workspaceDir);

    expect(config.llm.context).toBe('# Architecture\n\nSome content here.');
  });

  it('truncates context file content to 8000 characters', () => {
    const docsDir = path.join(workspaceDir, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });

    // Write a file with more than 8000 characters
    const longContent = 'A'.repeat(10_000);
    fs.writeFileSync(path.join(docsDir, 'large.md'), longContent, 'utf-8');

    const yamlContent = `
version: 1
llm:
  context: "docs/large.md"
`;
    writeConfig(workspaceDir, yamlContent);

    const config = loadConfig(workspaceDir);

    expect(config.llm.context).toHaveLength(8000);
  });

  it('accepts a custom config path', () => {
    const yamlContent = `
version: 1
`;
    writeConfig(workspaceDir, yamlContent, 'custom/config.yml');

    const config = loadConfig(workspaceDir, 'custom/config.yml');

    expect(config.version).toBe(1);
  });

  it('returns DEFAULT_CONFIG for custom config path that does not exist', () => {
    const config = loadConfig(workspaceDir, 'non-existent/config.yml');
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it('throws for context path that is absolute', () => {
    const yamlContent = `
version: 1
llm:
  context: "/etc/passwd"
`;
    writeConfig(workspaceDir, yamlContent);

    // '/etc/passwd' is an absolute path; path.isAbsolute(rel) will be true
    // since path.relative(workspaceDir, '/etc/passwd') returns an absolute-rooted path
    // on some systems, and starts with '..' on others — both are caught.
    expect(() => loadConfig(workspaceDir)).toThrow(ConfigPathTraversalError);
  });
});
