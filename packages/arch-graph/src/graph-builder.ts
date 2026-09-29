import path from 'node:path';
import { Project, SyntaxKind } from 'ts-morph';
import micromatch from 'micromatch';
import type { GraphNode, GraphEdge, ModuleGraph, LayerConfig } from './types.js';

export interface BuildGraphOptions {
  workspaceDir: string;
  tsconfigPath: string;
  layers: LayerConfig;
}

/**
 * Builds a module dependency graph from a TypeScript project using ts-morph.
 *
 * Static analysis only — never calls project.resolveSourceFileDependencies()
 * or executes any JavaScript. External (unresolvable) imports are stored as
 * nodes with the prefix 'external:' so that forbidden-import rule can still
 * match them.
 */
export function buildGraph(opts: BuildGraphOptions): ModuleGraph {
  const { workspaceDir, tsconfigPath, layers } = opts;

  const project = new Project({
    tsConfigFilePath: path.join(workspaceDir, tsconfigPath),
    skipAddingFilesFromTsConfig: false,
  });

  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];

  const sourceFiles = project.getSourceFiles();

  // First pass: register all source file nodes
  for (const sf of sourceFiles) {
    const filePath = sf.getFilePath();
    const relativePath = path.relative(workspaceDir, filePath);
    const layerName = assignLayer(relativePath, layers);
    const moduleName = deriveModuleName(relativePath);

    nodes.set(filePath, {
      filePath,
      moduleName,
      layerName,
    });
  }

  // Second pass: extract edges
  for (const sf of sourceFiles) {
    const fromPath = sf.getFilePath();

    // Static imports
    for (const importDecl of sf.getImportDeclarations()) {
      const rawSpecifier = importDecl.getModuleSpecifierValue();
      const resolvedFile = importDecl.getModuleSpecifierSourceFile();

      if (resolvedFile !== undefined) {
        const toPath = resolvedFile.getFilePath();
        ensureExternalNode(toPath, nodes, workspaceDir, layers);
        edges.push({ from: fromPath, to: toPath, kind: 'static', rawSpecifier });
      } else {
        // Unresolvable (bare specifier or missing dep) — store as external node
        const externalPath = `external:${rawSpecifier}`;
        ensureExternalNodeForSpecifier(externalPath, rawSpecifier, nodes);
        edges.push({ from: fromPath, to: externalPath, kind: 'static', rawSpecifier });
      }
    }

    // Dynamic imports: import('...')
    const callExpressions = sf.getDescendantsOfKind(SyntaxKind.CallExpression);
    for (const callExpr of callExpressions) {
      const expr = callExpr.getExpression();
      if (expr.getKind() !== SyntaxKind.ImportKeyword) {
        continue;
      }
      const args = callExpr.getArguments();
      const firstArg = args[0];
      if (firstArg === undefined) {
        continue;
      }
      // Try to get the string literal value
      const rawSpecifier = firstArg.getKind() === SyntaxKind.StringLiteral
        ? (firstArg.getText().slice(1, -1))
        : null;

      if (rawSpecifier === null) {
        continue;
      }

      // Try to resolve via the import declaration approach — for dynamic imports
      // we use the type checker
      const resolvedSymbol = firstArg.getType().getSymbol();
      const resolvedFile = resolvedSymbol?.getDeclarations()?.[0]?.getSourceFile();

      if (resolvedFile !== undefined) {
        const toPath = resolvedFile.getFilePath();
        ensureExternalNode(toPath, nodes, workspaceDir, layers);
        edges.push({ from: fromPath, to: toPath, kind: 'dynamic', rawSpecifier });
      } else {
        const externalPath = `external:${rawSpecifier}`;
        ensureExternalNodeForSpecifier(externalPath, rawSpecifier, nodes);
        edges.push({ from: fromPath, to: externalPath, kind: 'dynamic', rawSpecifier });
      }
    }

    // Re-exports with a module specifier: export { x } from '...'
    for (const exportDecl of sf.getExportDeclarations()) {
      if (!exportDecl.hasModuleSpecifier()) {
        continue;
      }
      const rawSpecifier = exportDecl.getModuleSpecifierValue() ?? '';
      const resolvedFile = exportDecl.getModuleSpecifierSourceFile();

      if (resolvedFile !== undefined) {
        const toPath = resolvedFile.getFilePath();
        ensureExternalNode(toPath, nodes, workspaceDir, layers);
        edges.push({ from: fromPath, to: toPath, kind: 'reexport', rawSpecifier });
      } else {
        const externalPath = `external:${rawSpecifier}`;
        ensureExternalNodeForSpecifier(externalPath, rawSpecifier, nodes);
        edges.push({ from: fromPath, to: externalPath, kind: 'reexport', rawSpecifier });
      }
    }
  }

  return { nodes, edges };
}

/**
 * Assigns a layer name to a file based on its path relative to the workspace root.
 * Returns null if no layer matches.
 */
function assignLayer(relativePath: string, layers: LayerConfig): string | null {
  for (const [layerName, globs] of Object.entries(layers)) {
    if (micromatch.isMatch(relativePath, globs, { dot: true })) {
      return layerName;
    }
  }
  return null;
}

/**
 * Derives a module name from the relative file path.
 * Uses the directory name portion as the module name.
 */
function deriveModuleName(relativePath: string): string {
  // LOW-1: Use path.sep so this works correctly on Windows where ts-morph may
  // return backslash-separated paths.
  const parts = relativePath.split(path.sep);
  // Use the top-level directory as module name, or 'root' if in root
  if (parts.length > 1) {
    return parts[0] ?? 'root';
  }
  return path.basename(relativePath, path.extname(relativePath));
}

/**
 * Ensures an external node exists in the node map for a resolved file
 * that may not have been in the original source files list (e.g., lib files).
 */
function ensureExternalNode(
  filePath: string,
  nodes: Map<string, GraphNode>,
  workspaceDir: string,
  layers: LayerConfig,
): void {
  if (!nodes.has(filePath)) {
    const relativePath = path.relative(workspaceDir, filePath);
    nodes.set(filePath, {
      filePath,
      moduleName: deriveModuleName(relativePath),
      layerName: assignLayer(relativePath, layers),
    });
  }
}

/**
 * Ensures a synthetic external node exists for a bare module specifier.
 */
function ensureExternalNodeForSpecifier(
  externalPath: string,
  rawSpecifier: string,
  nodes: Map<string, GraphNode>,
): void {
  if (!nodes.has(externalPath)) {
    nodes.set(externalPath, {
      filePath: externalPath,
      moduleName: rawSpecifier,
      layerName: null,
    });
  }
}
