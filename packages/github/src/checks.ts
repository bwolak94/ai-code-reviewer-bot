import { Octokit } from '@octokit/rest';
import type { AppAuth } from './app-auth.js';
import type {
  CreateCheckRunParams,
  UpdateCheckRunParams,
  CheckRunAnnotation,
} from './types.js';

/**
 * Creates a new check run on a pull request with status `queued`.
 * Returns the numeric check run ID for subsequent updates.
 *
 * SEC-008: The installation token is fetched internally and never exposed
 * to callers.
 */
export async function createCheckRun(
  auth: AppAuth,
  params: CreateCheckRunParams,
): Promise<number> {
  const token = await auth.getInstallationToken(params.installationId);
  const octokit = new Octokit({ auth: token });

  const response = await octokit.rest.checks.create({
    owner: params.owner,
    repo: params.repo,
    name: params.name,
    head_sha: params.headSha,
    status: 'queued',
  });

  return response.data.id;
}

/**
 * Updates an existing check run with a new status, optional conclusion, and
 * optional output (summary + annotations).
 *
 * Annotations are serialized from the strongly-typed `CheckRunAnnotation`
 * interface into the snake_case shape expected by the GitHub Checks API.
 */
export async function updateCheckRun(
  auth: AppAuth,
  params: UpdateCheckRunParams,
): Promise<void> {
  const token = await auth.getInstallationToken(params.installationId);
  const octokit = new Octokit({ auth: token });

  const annotations = params.output?.annotations?.map(
    (a: CheckRunAnnotation) => ({
      path: a.path,
      start_line: a.startLine,
      end_line: a.endLine,
      annotation_level: a.annotationLevel,
      message: a.message,
      ...(a.title !== undefined ? { title: a.title } : {}),
    }),
  );

  await octokit.rest.checks.update({
    owner: params.owner,
    repo: params.repo,
    check_run_id: params.checkRunId,
    status: params.status,
    ...(params.conclusion !== undefined
      ? { conclusion: params.conclusion }
      : {}),
    ...(params.output !== undefined
      ? {
          output: {
            title: params.output.title,
            summary: params.output.summary,
            ...(annotations !== undefined ? { annotations } : {}),
          },
        }
      : {}),
  });
}
