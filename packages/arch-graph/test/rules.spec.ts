import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGraph } from '../src/graph-builder.js';
import { evaluateLayerDependency } from '../src/rules/layer-dependency.rule.js';
import { evaluateNoCycles } from '../src/rules/no-cycles.rule.js';
import { evaluatePublicApiOnly } from '../src/rules/public-api-only.rule.js';
import { evaluateForbiddenImport } from '../src/rules/forbidden-import.rule.js';
import { graphDelta } from '../src/graph-delta.js';
import type { ModuleGraph, RuleViolation } from '../src/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function fixtureDir(name: string): string {
  return path.join(FIXTURES_DIR, name);
}

// ---------------------------------------------------------------------------
// layer-dependency rule
// ---------------------------------------------------------------------------

describe('layer-dependency rule', () => {
  const layerConfig = {
    domain: ['src/domain/**'],
    application: ['src/application/**'],
    infrastructure: ['src/infrastructure/**'],
  };

  const allowConfig = {
    allow: {
      application: ['domain'],
      infrastructure: ['domain'],
    },
    severity: 'high' as const,
  };

  it('detects domain importing from infrastructure (violation)', () => {
    const workspaceDir = fixtureDir('layer-violation');
    const graph = buildGraph({
      workspaceDir,
      tsconfigPath: 'tsconfig.json',
      layers: layerConfig,
    });

    const violations = evaluateLayerDependency(graph, allowConfig, workspaceDir);

    expect(violations.length).toBeGreaterThanOrEqual(1);

    const domainViolation = violations.find(
      (v) => v.file.includes('domain') && v.message.includes('infrastructure'),
    );
    expect(domainViolation).toBeDefined();
    expect(domainViolation?.severity).toBe('high');
    expect(domainViolation?.rule).toBe('layer-dependency');
  });

  it('returns 0 violations for clean project when allow config is correct', () => {
    const workspaceDir = fixtureDir('clean-project');
    const graph = buildGraph({
      workspaceDir,
      tsconfigPath: 'tsconfig.json',
      layers: layerConfig,
    });

    const violations = evaluateLayerDependency(graph, allowConfig, workspaceDir);

    expect(violations).toHaveLength(0);
  });

  it('returns empty array when config is undefined', () => {
    const workspaceDir = fixtureDir('layer-violation');
    const graph = buildGraph({
      workspaceDir,
      tsconfigPath: 'tsconfig.json',
      layers: layerConfig,
    });

    const violations = evaluateLayerDependency(graph, undefined, workspaceDir);
    expect(violations).toHaveLength(0);
  });

  it('fingerprint is 64 hex characters', () => {
    const workspaceDir = fixtureDir('layer-violation');
    const graph = buildGraph({
      workspaceDir,
      tsconfigPath: 'tsconfig.json',
      layers: layerConfig,
    });

    const violations = evaluateLayerDependency(graph, allowConfig, workspaceDir);
    for (const v of violations) {
      expect(v.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('violation in base graph is excluded from delta', () => {
    const workspaceDir = fixtureDir('layer-violation');
    const graph = buildGraph({
      workspaceDir,
      tsconfigPath: 'tsconfig.json',
      layers: layerConfig,
    });

    const violations = evaluateLayerDependency(graph, allowConfig, workspaceDir);
    expect(violations.length).toBeGreaterThan(0);

    // Same violations in base → delta is empty
    const delta = graphDelta(violations, violations);
    expect(delta).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// no-cycles rule
// ---------------------------------------------------------------------------

describe('no-cycles rule', () => {
  const noCyclesConfig = { severity: 'high' as const };

  it('detects a cycle in the cycle fixture (a→b→c→a)', () => {
    const workspaceDir = fixtureDir('cycle');
    const graph = buildGraph({
      workspaceDir,
      tsconfigPath: 'tsconfig.json',
      layers: {},
    });

    const violations = evaluateNoCycles(graph, noCyclesConfig, workspaceDir);

    expect(violations).toHaveLength(1);
    const v = violations[0];
    expect(v?.rule).toBe('no-cycles');
    expect(v?.severity).toBe('high');
    expect(v?.message).toContain('src/a.ts');
    expect(v?.message).toContain('src/b.ts');
    expect(v?.message).toContain('src/c.ts');
  });

  it('returns 0 violations for clean (acyclic) project', () => {
    const workspaceDir = fixtureDir('clean-project');
    const graph = buildGraph({
      workspaceDir,
      tsconfigPath: 'tsconfig.json',
      layers: {},
    });

    const violations = evaluateNoCycles(graph, noCyclesConfig, workspaceDir);
    expect(violations).toHaveLength(0);
  });

  it('returns empty array when config is undefined', () => {
    const workspaceDir = fixtureDir('cycle');
    const graph = buildGraph({
      workspaceDir,
      tsconfigPath: 'tsconfig.json',
      layers: {},
    });

    const violations = evaluateNoCycles(graph, undefined, workspaceDir);
    expect(violations).toHaveLength(0);
  });

  it('cycle violation fingerprint is 64 hex characters', () => {
    const workspaceDir = fixtureDir('cycle');
    const graph = buildGraph({
      workspaceDir,
      tsconfigPath: 'tsconfig.json',
      layers: {},
    });

    const violations = evaluateNoCycles(graph, noCyclesConfig, workspaceDir);
    for (const v of violations) {
      expect(v.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('handles a graph with a self-referencing node without crashing', () => {
    // Build a synthetic graph with a self-reference
    const nodeFile = '/workspace/src/self.ts';
    const graph: ModuleGraph = {
      nodes: new Map([
        [nodeFile, { filePath: nodeFile, moduleName: 'src', layerName: null }],
      ]),
      edges: [{ from: nodeFile, to: nodeFile, kind: 'static' }],
    };

    // Self-reference is not a multi-node SCC; should return 0 violations
    // (single-node SCCs are not flagged unless self-referencing)
    const violations = evaluateNoCycles(graph, noCyclesConfig, '/workspace');
    // Self-reference edge means it IS a cycle but it's debatable
    // Per spec: "self-reference edge → 0 (not a multi-node SCC)"
    // Our implementation treats SCC size > 1 as cycle; self-reference has SCC size 1
    expect(violations).toHaveLength(0);
  });

  it('does not count the cycle twice', () => {
    const workspaceDir = fixtureDir('cycle');
    const graph = buildGraph({
      workspaceDir,
      tsconfigPath: 'tsconfig.json',
      layers: {},
    });

    const violations = evaluateNoCycles(graph, noCyclesConfig, workspaceDir);
    // One cycle (a→b→c→a) should produce exactly 1 violation
    expect(violations).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// public-api-only rule
// ---------------------------------------------------------------------------

describe('public-api-only rule', () => {
  const publicApiConfig = {
    modules: ['src/moduleA/**'],
    severity: 'medium' as const,
  };

  it('detects bypass of public API (moduleB imports moduleA internal directly)', () => {
    const workspaceDir = fixtureDir('public-api-bypass');
    const graph = buildGraph({
      workspaceDir,
      tsconfigPath: 'tsconfig.json',
      layers: {},
    });

    const violations = evaluatePublicApiOnly(graph, publicApiConfig, workspaceDir);

    expect(violations.length).toBeGreaterThanOrEqual(1);

    const bypassViolation = violations.find(
      (v) => v.file.includes('moduleB') && v.message.includes('internal'),
    );
    expect(bypassViolation).toBeDefined();
    expect(bypassViolation?.severity).toBe('medium');
    expect(bypassViolation?.rule).toBe('public-api-only');
  });

  it('returns 0 violations when config is undefined', () => {
    const workspaceDir = fixtureDir('public-api-bypass');
    const graph = buildGraph({
      workspaceDir,
      tsconfigPath: 'tsconfig.json',
      layers: {},
    });

    const violations = evaluatePublicApiOnly(graph, undefined, workspaceDir);
    expect(violations).toHaveLength(0);
  });

  it('does not flag index.ts re-export of internal as violation', () => {
    const workspaceDir = fixtureDir('public-api-bypass');
    const graph = buildGraph({
      workspaceDir,
      tsconfigPath: 'tsconfig.json',
      layers: {},
    });

    // The index.ts itself re-exports from internal — that should NOT be flagged
    // because index.ts IS within moduleA
    const violations = evaluatePublicApiOnly(graph, publicApiConfig, workspaceDir);

    // Check that no violation points to index.ts as the violating file
    const indexViolation = violations.find((v) => v.file.endsWith('moduleA/index.ts'));
    expect(indexViolation).toBeUndefined();
  });

  it('fingerprint is 64 hex characters', () => {
    const workspaceDir = fixtureDir('public-api-bypass');
    const graph = buildGraph({
      workspaceDir,
      tsconfigPath: 'tsconfig.json',
      layers: {},
    });

    const violations = evaluatePublicApiOnly(graph, publicApiConfig, workspaceDir);
    for (const v of violations) {
      expect(v.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

// ---------------------------------------------------------------------------
// forbidden-import rule
// ---------------------------------------------------------------------------

describe('forbidden-import rule', () => {
  it('detects domain file importing @nestjs/common (mock graph)', () => {
    const workspaceDir = '/workspace';
    const domainFile = '/workspace/src/domain/user.service.ts';
    const externalNestjs = 'external:@nestjs/common';

    const graph: ModuleGraph = {
      nodes: new Map([
        [
          domainFile,
          {
            filePath: domainFile,
            moduleName: 'domain',
            layerName: 'domain',
          },
        ],
        [
          externalNestjs,
          {
            filePath: externalNestjs,
            moduleName: '@nestjs/common',
            layerName: null,
          },
        ],
      ]),
      edges: [
        {
          from: domainFile,
          to: externalNestjs,
          kind: 'static',
          rawSpecifier: '@nestjs/common',
        },
      ],
    };

    const config = [
      {
        from: 'src/domain/**',
        deny: ['@nestjs/*'],
        severity: 'high' as const,
      },
    ];

    const violations = evaluateForbiddenImport(graph, config, workspaceDir);

    expect(violations).toHaveLength(1);
    expect(violations[0]?.rule).toBe('forbidden-import');
    expect(violations[0]?.severity).toBe('high');
    expect(violations[0]?.message).toContain('@nestjs/common');
    expect(violations[0]?.file).toBe('src/domain/user.service.ts');
  });

  it('does not flag infra file importing typeorm (not in domain layer deny list)', () => {
    const workspaceDir = '/workspace';
    const infraFile = '/workspace/src/infrastructure/db.ts';
    const externalTypeorm = 'external:typeorm';

    const graph: ModuleGraph = {
      nodes: new Map([
        [
          infraFile,
          {
            filePath: infraFile,
            moduleName: 'infrastructure',
            layerName: 'infrastructure',
          },
        ],
        [
          externalTypeorm,
          {
            filePath: externalTypeorm,
            moduleName: 'typeorm',
            layerName: null,
          },
        ],
      ]),
      edges: [
        {
          from: infraFile,
          to: externalTypeorm,
          kind: 'static',
          rawSpecifier: 'typeorm',
        },
      ],
    };

    // Only domain layer is denied from importing @nestjs/*
    const config = [
      {
        from: 'src/domain/**',
        deny: ['@nestjs/*'],
        severity: 'high' as const,
      },
    ];

    const violations = evaluateForbiddenImport(graph, config, workspaceDir);

    // infra is not in 'src/domain/**' so it should have 0 violations
    expect(violations).toHaveLength(0);
  });

  it('returns empty array when config is undefined', () => {
    const workspaceDir = '/workspace';
    const domainFile = '/workspace/src/domain/user.service.ts';
    const externalNestjs = 'external:@nestjs/common';

    const graph: ModuleGraph = {
      nodes: new Map([
        [domainFile, { filePath: domainFile, moduleName: 'domain', layerName: 'domain' }],
        [externalNestjs, { filePath: externalNestjs, moduleName: '@nestjs/common', layerName: null }],
      ]),
      edges: [
        { from: domainFile, to: externalNestjs, kind: 'static', rawSpecifier: '@nestjs/common' },
      ],
    };

    const violations = evaluateForbiddenImport(graph, undefined, workspaceDir);
    expect(violations).toHaveLength(0);
  });

  it('fingerprint is 64 hex characters', () => {
    const workspaceDir = '/workspace';
    const domainFile = '/workspace/src/domain/user.service.ts';
    const externalNestjs = 'external:@nestjs/common';

    const graph: ModuleGraph = {
      nodes: new Map([
        [domainFile, { filePath: domainFile, moduleName: 'domain', layerName: 'domain' }],
        [externalNestjs, { filePath: externalNestjs, moduleName: '@nestjs/common', layerName: null }],
      ]),
      edges: [
        { from: domainFile, to: externalNestjs, kind: 'static', rawSpecifier: '@nestjs/common' },
      ],
    };

    const config = [
      { from: 'src/domain/**', deny: ['@nestjs/*'], severity: 'high' as const },
    ];

    const violations = evaluateForbiddenImport(graph, config, workspaceDir);
    for (const v of violations) {
      expect(v.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('does not flag domain file importing allowed packages', () => {
    const workspaceDir = '/workspace';
    const domainFile = '/workspace/src/domain/user.service.ts';
    const externalZod = 'external:zod';

    const graph: ModuleGraph = {
      nodes: new Map([
        [domainFile, { filePath: domainFile, moduleName: 'domain', layerName: 'domain' }],
        [externalZod, { filePath: externalZod, moduleName: 'zod', layerName: null }],
      ]),
      edges: [
        { from: domainFile, to: externalZod, kind: 'static', rawSpecifier: 'zod' },
      ],
    };

    const config = [
      { from: 'src/domain/**', deny: ['@nestjs/*'], severity: 'high' as const },
    ];

    const violations = evaluateForbiddenImport(graph, config, workspaceDir);
    expect(violations).toHaveLength(0);
  });
});
