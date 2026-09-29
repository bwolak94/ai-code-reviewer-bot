import { Octokit } from '@octokit/rest';

export interface InlineComment {
  path: string;
  line: number;
  body: string;
}

export interface CreatePullRequestReviewParams {
  octokit: Octokit;
  owner: string;
  repo: string;
  prNumber: number;
  commitId: string;
  comments: InlineComment[];
  summaryBody: string;
}

/**
 * Creates a pull request review with inline comments and a summary body.
 *
 * Uses COMMENT event so the review does not block merges.
 * If comments array is empty, still posts the summary body.
 */
export async function createPullRequestReview(
  params: CreatePullRequestReviewParams,
): Promise<void> {
  const { octokit, owner, repo, prNumber, commitId, comments, summaryBody } = params;

  await octokit.rest.pulls.createReview({
    owner,
    repo,
    pull_number: prNumber,
    commit_id: commitId,
    event: 'COMMENT',
    body: summaryBody,
    comments: comments.map((c) => ({
      path: c.path,
      line: c.line,
      body: c.body,
      side: 'RIGHT' as const,
    })),
  });
}
