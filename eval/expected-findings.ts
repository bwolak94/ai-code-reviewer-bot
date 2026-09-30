export interface ExpectedFinding {
  fixture: string;
  file: string;          // relative path within fixture dir, e.g. "src/domain/user.service.ts"
                         // empty string means "any file in this fixture" (used for cycle rules)
  rule: string;          // rule name, e.g. "layer-dependency"
  severity: 'low' | 'medium' | 'high';
  mustMatch: boolean;    // true  = must be found (recall assertion)
                         // false = must NOT be found (precision / no-FP assertion)
                         //         run-eval labels these [FP/EXPLICIT] if they appear
}

export interface EvalResult {
  fixture: string;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
}

/**
 * Ground-truth findings for the deterministic eval harness.
 *
 * mustMatch: true  — the rule violation MUST be detected (recall assertion).
 * mustMatch: false — this violation must NOT appear (explicit precision guard).
 *                    run-eval counts any unmatched violation as an FP; when a
 *                    mustMatch: false entry matches it logs [FP/EXPLICIT] for
 *                    clarity, but the FP count is the same either way.
 *
 * LLM-only fixtures (logic-in-controller-pr, leaky-repository-pr) are excluded
 * from DETERMINISTIC_FIXTURES in run-eval.ts and are not evaluated here.
 * Their entries are kept for documentation and future LLM milestone use.
 */
export const EXPECTED_FINDINGS: ExpectedFinding[] = [
  // ---------------------------------------------------------------------------
  // clean-pr — no violations expected for either rule
  // ---------------------------------------------------------------------------
  {
    fixture: 'clean-pr',
    file: 'src/application/user.service.ts',
    rule: 'layer-dependency',
    severity: 'high',
    mustMatch: false,
  },
  {
    fixture: 'clean-pr',
    file: '',
    rule: 'no-cycles',
    severity: 'high',
    mustMatch: false,
  },

  // ---------------------------------------------------------------------------
  // layer-violation-pr — domain imports infrastructure (forbidden)
  // ---------------------------------------------------------------------------
  {
    fixture: 'layer-violation-pr',
    file: 'src/domain/user.service.ts',
    rule: 'layer-dependency',
    severity: 'high',
    mustMatch: true,
  },

  // ---------------------------------------------------------------------------
  // cycle-pr — circular dependency between src/a and src/b
  // file: "" means "any file in this fixture" — cycle may be reported on either
  // participant. The eval script checks any violation matching the rule.
  // ---------------------------------------------------------------------------
  {
    fixture: 'cycle-pr',
    file: '',
    rule: 'no-cycles',
    severity: 'high',
    mustMatch: true,
  },

  // ---------------------------------------------------------------------------
  // logic-in-controller-pr — LLM-only findings (future milestone)
  // These entries are never consulted by the deterministic harness.
  // ---------------------------------------------------------------------------
  {
    fixture: 'logic-in-controller-pr',
    file: 'src/app.controller.ts',
    rule: 'logic-in-controller',
    severity: 'high',
    mustMatch: false,
  },

  // ---------------------------------------------------------------------------
  // leaky-repository-pr — LLM-only findings (future milestone)
  // These entries are never consulted by the deterministic harness.
  // ---------------------------------------------------------------------------
  {
    fixture: 'leaky-repository-pr',
    file: 'src/user.repository.ts',
    rule: 'leaky-abstraction',
    severity: 'medium',
    mustMatch: false,
  },
];
