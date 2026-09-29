import path from 'node:path';
import type { ModuleGraph, RuleViolation, RulesConfig } from '../types.js';
import { computeFingerprint } from '../fingerprint.js';

/**
 * Iterative Tarjan's Strongly Connected Components (SCC) algorithm.
 *
 * This implementation avoids recursion to prevent call stack overflow on
 * large dependency graphs (SEC requirement).
 *
 * Uses an explicit work stack where each entry tracks:
 * - The current node being processed
 * - The index of the next neighbor to visit
 *
 * Returns all SCCs. Callers filter for size > 1 to identify cycles.
 */
// LOW-2: Declare at module scope for visibility in tests and documentation.
interface StackFrame {
  node: string;
  neighborIdx: number;
}

function tarjanIterativeSCC(
  nodes: string[],
  adjacency: Map<string, string[]>,
): string[][] {
  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Map<string, boolean>();
  const sccStack: string[] = [];
  const sccs: string[][] = [];
  let indexCounter = 0;

  for (const startNode of nodes) {
    if (index.has(startNode)) continue;

    // Call stack for DFS
    const callStack: StackFrame[] = [];

    // Initialize DFS from startNode
    const initFrame = (node: string): void => {
      index.set(node, indexCounter);
      lowlink.set(node, indexCounter);
      indexCounter++;
      onStack.set(node, true);
      sccStack.push(node);
      callStack.push({ node, neighborIdx: 0 });
    };

    initFrame(startNode);

    while (callStack.length > 0) {
      const frame = callStack[callStack.length - 1];
      if (frame === undefined) break;

      const neighbors = adjacency.get(frame.node) ?? [];

      if (frame.neighborIdx < neighbors.length) {
        const neighbor = neighbors[frame.neighborIdx];
        if (neighbor === undefined) {
          frame.neighborIdx++;
          continue;
        }
        frame.neighborIdx++;

        if (!index.has(neighbor)) {
          // Tree edge — push new frame
          initFrame(neighbor);
        } else if (onStack.get(neighbor) === true) {
          // Back edge — update lowlink
          const currentLowlink = lowlink.get(frame.node) ?? 0;
          const neighborIndex = index.get(neighbor) ?? 0;
          lowlink.set(frame.node, Math.min(currentLowlink, neighborIndex));
        }
        // Cross/forward edge — no action needed
      } else {
        // All neighbors processed — pop this frame
        callStack.pop();

        // Update parent's lowlink
        const parentFrame = callStack[callStack.length - 1];
        if (parentFrame !== undefined) {
          const parentLowlink = lowlink.get(parentFrame.node) ?? 0;
          const nodeLowlink = lowlink.get(frame.node) ?? 0;
          lowlink.set(parentFrame.node, Math.min(parentLowlink, nodeLowlink));
        }

        // Check if this node is an SCC root
        const nodeLowlink = lowlink.get(frame.node) ?? 0;
        const nodeIndex = index.get(frame.node) ?? -1;

        if (nodeLowlink === nodeIndex) {
          // Pop the SCC from the Tarjan stack
          const scc: string[] = [];
          let w: string | undefined;
          do {
            w = sccStack.pop();
            if (w !== undefined) {
              onStack.set(w, false);
              scc.push(w);
            }
          } while (w !== undefined && w !== frame.node);
          sccs.push(scc);
        }
      }
    }
  }

  return sccs;
}

/**
 * Evaluates the no-cycles rule using Tarjan's SCC algorithm (iterative).
 *
 * Returns one violation per detected cycle (SCC with size > 1).
 * The violation's `file` is the first file alphabetically in the cycle.
 */
export function evaluateNoCycles(
  graph: ModuleGraph,
  config: RulesConfig['no-cycles'],
  workspaceDir: string,
): RuleViolation[] {
  if (config === undefined) {
    return [];
  }

  const severity = config.severity ?? 'high';
  const violations: RuleViolation[] = [];

  // Build adjacency list — only include real (non-external) nodes.
  // HIGH-5: Use Set<string> for O(1) dedup instead of Array.includes (O(n)).
  const adjacencySet = new Map<string, Set<string>>();
  const realNodes: string[] = [];

  for (const node of graph.nodes.keys()) {
    if (!node.startsWith('external:')) {
      adjacencySet.set(node, new Set());
      realNodes.push(node);
    }
  }

  for (const edge of graph.edges) {
    if (edge.from.startsWith('external:') || edge.to.startsWith('external:')) {
      continue;
    }

    adjacencySet.get(edge.from)?.add(edge.to);
  }

  // Convert Set adjacency to Array adjacency for Tarjan
  const adjacency = new Map<string, string[]>(
    [...adjacencySet.entries()].map(([k, v]) => [k, [...v]]),
  );

  const sccs = tarjanIterativeSCC(realNodes, adjacency);

  for (const scc of sccs) {
    // Only multi-node SCCs are cycles
    // (single-node SCCs are not cycles unless the node has a self-edge,
    //  but per spec "self-reference edge → 0 violations" for single-node SCC)
    if (scc.length <= 1) {
      continue;
    }

    // Sort files for deterministic fingerprint and output
    const sortedFiles = scc
      .map((f) => path.relative(workspaceDir, f))
      .sort();

    const firstFile = sortedFiles[0] ?? '';
    // CRIT-2: Use firstFile as canonical `file` arg and full cycle as snippet,
    // matching the documented (rule, file, snippet) contract.
    const fingerprint = computeFingerprint(
      'no-cycles',
      firstFile,
      sortedFiles.join(','),
    );

    violations.push({
      rule: 'no-cycles',
      file: firstFile,
      line: 1,
      message: `Cycle detected involving ${scc.length} file(s): ${sortedFiles.join(', ')}`,
      severity,
      fingerprint,
    });
  }

  return violations;
}
