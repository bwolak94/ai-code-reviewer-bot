import { Octokit } from '@octokit/rest';
import type { CheckRunAnnotation } from './types.js';

/**
 * Minimal violation shape needed for annotation publishing.
 * Defined locally so packages/github does not depend on packages/arch-graph.
 */
export interface ViolationForAnnotation {
  rule: string;
  file: string;
  line: number;
  message: string;
  severity: 'high' | 'medium' | 'low';
  fingerprint: string;
}

export interface PublishAnnotationsParams {
  octokit: Octokit;
  owner: string;
  repo: string;
  checkRunId: number;
  violations: ViolationForAnnotation[];
  conclusion: 'success' | 'failure' | 'neutral';
  summaryTitle: string;
}

/**
 * Maps violation severity to GitHub Check Run annotation level.
 */
function severityToAnnotationLevel(
  severity: ViolationForAnnotation['severity'],
): CheckRunAnnotation['annotationLevel'] {
  switch (severity) {
    case 'high':
      return 'failure';
    case 'medium':
      return 'warning';
    case 'low':
      return 'notice';
  }
}

/**
 * Builds a markdown summary table for the check run output.
 */
function buildSummaryMarkdown(violations: ViolationForAnnotation[]): string {
  if (violations.length === 0) {
    return '## Architectural Review\n\nNo violations found.';
  }

  // HIGH-3: Escape pipe characters to prevent broken Markdown table cells.
  const escapePipes = (s: string): string => s.replace(/\|/g, '\\|');

  const rows = violations
    .map(
      (v) =>
        `| \`${v.rule}\` | \`${v.file}\` | ${v.line} | ${escapePipes(v.message)} |`,
    )
    .join('\n');

  return `## Architectural Review\n\n**${violations.length} violation(s) found**\n\n| Rule | File | Line | Message |\n|---|---|---|---|\n${rows}`;
}

/**
 * Publishes check run annotations for a set of rule violations.
 *
 * GitHub Checks API has a 50-annotation-per-request limit. This function
 * paginates by sending multiple update calls for batches of up to 50
 * annotations.
 *
 * The first call sets the check run to 'completed' with the full summary.
 * Subsequent calls (for overflow annotations) use additional update calls.
 */
export async function publishCheckRunAnnotations(
  params: PublishAnnotationsParams,
): Promise<void> {
  const { octokit, owner, repo, checkRunId, violations, conclusion, summaryTitle } = params;

  const summary = buildSummaryMarkdown(violations);

  const annotations: CheckRunAnnotation[] = violations.map((v) => ({
    path: v.file,
    startLine: v.line,
    endLine: v.line,
    annotationLevel: severityToAnnotationLevel(v.severity),
    message: `${v.message}\n<!-- aireview:fp=${v.fingerprint} -->`,
    title: `[${v.rule}] ${v.file}:${v.line}`,
  }));

  const BATCH_SIZE = 50;

  // First batch — also sets status to completed with summary
  const firstBatch = annotations.slice(0, BATCH_SIZE);

  await octokit.rest.checks.update({
    owner,
    repo,
    check_run_id: checkRunId,
    status: 'completed',
    conclusion,
    output: {
      title: summaryTitle,
      summary,
      annotations: firstBatch.map((a) => ({
        path: a.path,
        start_line: a.startLine,
        end_line: a.endLine,
        annotation_level: a.annotationLevel,
        message: a.message,
        ...(a.title !== undefined ? { title: a.title } : {}),
      })),
    },
  });

  // Subsequent batches for overflow annotations.
  // MED-5: Omit status/conclusion/summary on overflow batches — only append annotations.
  for (let i = BATCH_SIZE; i < annotations.length; i += BATCH_SIZE) {
    const batch = annotations.slice(i, i + BATCH_SIZE);

    await octokit.rest.checks.update({
      owner,
      repo,
      check_run_id: checkRunId,
      output: {
        title: summaryTitle,
        summary: '',
        annotations: batch.map((a) => ({
          path: a.path,
          start_line: a.startLine,
          end_line: a.endLine,
          annotation_level: a.annotationLevel,
          message: a.message,
          ...(a.title !== undefined ? { title: a.title } : {}),
        })),
      },
    });
  }
}

/**
 * Determines the check run conclusion based on the violations' severities
 * and the minimum severity threshold for inline comments.
 */
export function determineConclusion(
  violations: ViolationForAnnotation[],
  minSeverityInline: 'high' | 'medium' | 'low' = 'high',
): 'success' | 'failure' | 'neutral' {
  if (violations.length === 0) {
    return 'success';
  }

  const hasHigh = violations.some((v) => v.severity === 'high');
  const hasMedium = violations.some((v) => v.severity === 'medium');

  if (minSeverityInline === 'high') {
    return hasHigh ? 'failure' : 'neutral';
  }
  if (minSeverityInline === 'medium') {
    return hasHigh || hasMedium ? 'failure' : 'neutral';
  }
  // 'low' — any violation is a failure
  return 'failure';
}
