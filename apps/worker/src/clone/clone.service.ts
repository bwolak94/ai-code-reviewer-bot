import { Injectable, Inject } from '@nestjs/common';
import { simpleGit } from 'simple-git';
import type { Logger as PinoLogger } from 'pino';

/**
 * Thrown when the derived clone URL hostname is not exactly 'github.com'.
 * SEC-005: Prevents SSRF via a crafted repository URL.
 */
export class InvalidCloneUrlException extends Error {
  constructor(hostname: string) {
    super(
      `Invalid clone URL hostname: "${hostname}". Only github.com is permitted.`,
    );
    this.name = 'InvalidCloneUrlException';
  }
}

export interface CloneResult {
  repoDir: string;
}

/**
 * Performs shallow git clones of GitHub repositories using installation tokens.
 *
 * Security controls:
 * - SEC-005: Domain validation — only github.com hostnames are accepted.
 * - SEC-008: Clone URL (which contains the token) is NEVER logged. Only
 *   `{ action: 'clone', owner, repo }` appears in structured logs.
 */
@Injectable()
export class CloneService {
  private static readonly ALLOWED_HOSTNAME = 'github.com';

  constructor(
    @Inject('PINO_LOGGER')
    private readonly logger: PinoLogger,
  ) {}

  /**
   * Performs a shallow clone (--depth=1 --no-tags) of a GitHub repository
   * into the specified workspace directory.
   *
   * @param owner   - GitHub repository owner (org or user)
   * @param repo    - GitHub repository name
   * @param ref     - Git ref to clone (branch name or SHA)
   * @param token   - GitHub installation access token (NEVER logged)
   * @param destDir - Destination directory for the clone
   */
  async clone(
    owner: string,
    repo: string,
    ref: string,
    token: string,
    destDir: string,
  ): Promise<CloneResult> {
    // SEC-005: Construct and validate the URL hostname before any network call.
    const cloneUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
    const parsedUrl = new URL(cloneUrl);

    if (parsedUrl.hostname !== CloneService.ALLOWED_HOSTNAME) {
      throw new InvalidCloneUrlException(parsedUrl.hostname);
    }

    // SEC-008: Only log owner and repo — never the full URL containing the token.
    this.logger.info({ action: 'clone', owner, repo, ref }, 'cloning repository');

    const git = simpleGit();

    await git.clone(cloneUrl, destDir, [
      '--depth=1',
      '--no-tags',
      '--branch',
      ref,
      '--single-branch',
    ]);

    this.logger.info({ action: 'clone', owner, repo, ref }, 'clone complete');

    return { repoDir: destDir };
  }
}
