import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildGraph } from '@repo/arch-graph';
import { evaluateRules } from '@repo/arch-graph';
import type { RuleViolation } from '@repo/arch-graph';
import { loadConfig } from '@repo/config';
import { EXPECTED_FINDINGS } from './expected-findings.js';
import type { EvalResult } from './expected-findings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Thresholds — deterministic rules must be perfect.
// ---------------------------------------------------------------------------
const PRECISION_THRESHOLD = 1.0;
const RECALL_THRESHOLD = 1.0;

// ---------------------------------------------------------------------------
// Deterministic fixtures (LLM-only fixtures are excluded here).
// ---------------------------------------------------------------------------
const DETERMINISTIC_FIXTURES = ['clean-pr', 'layer-violation-pr', 'cycle-pr'] as const;

type FixtureName = (typeof DETERMINISTIC_FIXTURES)[number];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeMetrics(tp: number, fp: number, fn: number): {
  precision: number;
  recall: number;
  f1: number;
} {
  const precision = tp + fp === 0 ? 1.0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1.0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0.0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1 };
}

function fmt(n: number): string {
  return n.toFixed(2);
}

/**
 * Returns true if a violation matches a mustMatch expected finding.
 * - When expected.file is non-empty: violation.file must include expected.file.
 * - When expected.file is empty (cycle rule): any violation matching the rule qualifies.
 */
function violationMatchesExpected(
  violation: RuleViolation,
  expected: { rule: string; file: string },
): boolean {
  if (violation.rule !== expected.rule) {
    return false;
  }
  if (expected.file === '') {
    // Any file is acceptable (used for cycle violations)
    return true;
  }
  return violation.file.includes(expected.file);
}

// ---------------------------------------------------------------------------
// Main evaluation loop
// ---------------------------------------------------------------------------

async function runEval(): Promise<void> {
  const results: EvalResult[] = [];

  for (const fixtureName of DETERMINISTIC_FIXTURES) {
    const fixtureDir = path.join(__dirname, 'fixtures', fixtureName);

    // Load config from fixture
    const config = loadConfig(fixtureDir);

    // Build dependency graph
    let violations: RuleViolation[] = [];
    try {
      const graph = buildGraph({
        workspaceDir: fixtureDir,
        tsconfigPath: config.tsconfig,
        layers: config.layers,
      });

      // Only evaluate if graph has nodes
      if (graph.nodes.size > 0) {
        violations = evaluateRules(graph, config.rules, fixtureDir);
      }
    } catch (err) {
      // Treat graph build errors as empty results but surface the error
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  [WARN] Failed to build graph for ${fixtureName}: ${message}`);
    }

    // Retrieve expected findings for this fixture
    const fixtureExpected = EXPECTED_FINDINGS.filter((e) => e.fixture === fixtureName);
    const mustMatchExpected = fixtureExpected.filter((e) => e.mustMatch);

    // Compute TP and FN from mustMatch entries
    let truePositives = 0;
    let falseNegatives = 0;

    for (const expected of mustMatchExpected) {
      const found = violations.some((v) => violationMatchesExpected(v, expected));
      if (found) {
        truePositives++;
      } else {
        falseNegatives++;
        console.error(
          `  [FN] ${fixtureName}: expected rule="${expected.rule}" file="${expected.file}" was NOT found`,
        );
      }
    }

    // Compute FP: any violation that does not match any mustMatch expected entry
    let falsePositives = 0;
    for (const violation of violations) {
      const isExpected = mustMatchExpected.some((e) => violationMatchesExpected(violation, e));
      if (!isExpected) {
        falsePositives++;
        console.error(
          `  [FP] ${fixtureName}: unexpected violation rule="${violation.rule}" file="${violation.file}"`,
        );
      }
    }

    const { precision, recall, f1 } = computeMetrics(truePositives, falsePositives, falseNegatives);

    results.push({
      fixture: fixtureName,
      truePositives,
      falsePositives,
      falseNegatives,
      precision,
      recall,
      f1,
    });
  }

  // ---------------------------------------------------------------------------
  // Aggregate metrics
  // ---------------------------------------------------------------------------
  const aggTP = results.reduce((s, r) => s + r.truePositives, 0);
  const aggFP = results.reduce((s, r) => s + r.falsePositives, 0);
  const aggFN = results.reduce((s, r) => s + r.falseNegatives, 0);
  const { precision: aggPrecision, recall: aggRecall, f1: aggF1 } = computeMetrics(
    aggTP,
    aggFP,
    aggFN,
  );

  // ---------------------------------------------------------------------------
  // Print markdown table
  // ---------------------------------------------------------------------------
  console.log('');
  console.log('## Eval Results');
  console.log('');
  console.log('| Fixture | TP | FP | FN | Precision | Recall | F1 |');
  console.log('|---|---|---|---|---|---|---|');

  for (const r of results) {
    console.log(
      `| ${r.fixture} | ${r.truePositives} | ${r.falsePositives} | ${r.falseNegatives} | ${fmt(r.precision)} | ${fmt(r.recall)} | ${fmt(r.f1)} |`,
    );
  }

  console.log(
    `| **aggregate** | ${aggTP} | ${aggFP} | ${aggFN} | **${fmt(aggPrecision)}** | **${fmt(aggRecall)}** | **${fmt(aggF1)}** |`,
  );
  console.log('');

  // ---------------------------------------------------------------------------
  // Threshold check — exit 1 on any failure
  // ---------------------------------------------------------------------------
  let allPassed = true;

  for (const r of results) {
    if (r.precision < PRECISION_THRESHOLD) {
      console.error(
        `FAIL: fixture "${r.fixture}" precision=${fmt(r.precision)} < threshold=${PRECISION_THRESHOLD}`,
      );
      allPassed = false;
    }
    if (r.recall < RECALL_THRESHOLD) {
      console.error(
        `FAIL: fixture "${r.fixture}" recall=${fmt(r.recall)} < threshold=${RECALL_THRESHOLD}`,
      );
      allPassed = false;
    }
  }

  if (allPassed) {
    console.log('All deterministic thresholds passed. ✓');
    process.exit(0);
  } else {
    console.error('');
    console.error('One or more deterministic thresholds FAILED. ✗');
    process.exit(1);
  }
}

runEval().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Fatal eval error: ${message}`);
  process.exit(1);
});
