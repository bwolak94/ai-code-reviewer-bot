export interface ExpectedFinding {
  fixture: string;
  file: string;          // relative path within fixture dir, e.g. "src/domain/user.service.ts"
                         // empty string means "any file in this fixture" (used for cycle rules)
  rule: string;          // rule name, e.g. "layer-dependency"
  severity: 'low' | 'medium' | 'high';
  mustMatch: boolean;    // true = must be found (recall), false = must NOT be found (precision)
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
 * mustMatch: true  — the rule violation MUST be detected (recall assertion)
 * mustMatch: false — the rule violation must NOT appear (precision / no-FP assertion)
 *
 * NOTE: logic-in-controller-pr and leaky-repository-pr findings are LLM-only.
 *       They are all marked mustMatch: false so the deterministic eval skips them.
 *       These fixtures will be evaluated in a future milestone when LLM evaluation
 *       is enabled.
 */
export const EXPECTED_FINDINGS: ExpectedFinding[] = [
  // ---------------------------------------------------------------------------
  // clean-pr — no violations expected
  // ---------------------------------------------------------------------------
  {
    fixture: 'clean-pr',
    file: 'src/application/user.service.ts',
    rule: 'layer-dependency',
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
  // ---------------------------------------------------------------------------
  {
    fixture: 'leaky-repository-pr',
    file: 'src/user.repository.ts',
    rule: 'leaky-abstraction',
    severity: 'medium',
    mustMatch: false,
  },
];
