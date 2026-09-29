import { Injectable, Inject } from '@nestjs/common';
import type { Logger as PinoLogger } from 'pino';
import { FeedbackRepository } from '@repo/db';

interface ReviewCommentPayload {
  action: string;
  repository?: { id?: number };
  comment?: {
    body?: string;
    user?: { login?: string };
  };
  // pull_request_review_comment uses `comment`, issue_comment uses `comment` too.
}

/**
 * Regex that matches the hidden fingerprint marker embedded in every AI review
 * comment: `<!-- aireview:fp=<64-char hex> -->`.
 */
const FINGERPRINT_MARKER_RE = /<!--\s*aireview:fp=([a-f0-9]{64})\s*-->/;

/**
 * Regex matching the `@ai-reviewer ignore` command anywhere in a comment body.
 * Case-insensitive.
 */
const IGNORE_COMMAND_RE = /@ai-reviewer\s+ignore/i;

/**
 * Handles `pull_request_review_comment.created` (and optionally
 * `issue_comment.created`) events.
 *
 * Parses `@ai-reviewer ignore` commands from comment bodies. If the comment
 * also contains a fingerprint marker (embedded by the AI review comment), the
 * feedback is persisted so subsequent runs suppress the finding.
 */
@Injectable()
export class ReviewCommentHandler {
  constructor(
    @Inject('PINO_LOGGER')
    private readonly logger: PinoLogger,
    @Inject('FEEDBACK_REPOSITORY')
    private readonly feedbackRepository: FeedbackRepository,
  ) {}

  async handle(payload: unknown): Promise<void> {
    const p = payload as ReviewCommentPayload;

    const body = p.comment?.body ?? '';
    const actorLogin = p.comment?.user?.login;
    const repositoryId = p.repository?.id;

    if (actorLogin === undefined || actorLogin === '') {
      this.logger.debug(
        { action: p.action },
        'review-comment: no actor login — skipping',
      );
      return;
    }

    if (repositoryId === undefined) {
      this.logger.debug(
        { action: p.action },
        'review-comment: no repository id — skipping',
      );
      return;
    }

    // Check for @ai-reviewer ignore command.
    if (!IGNORE_COMMAND_RE.test(body)) {
      return;
    }

    // Extract the fingerprint marker from the comment body.
    const fpMatch = FINGERPRINT_MARKER_RE.exec(body);
    if (fpMatch === null) {
      this.logger.info(
        { actorLogin, action: p.action },
        'review-comment: @ai-reviewer ignore found but no fingerprint marker — cannot suppress',
      );
      return;
    }

    const fingerprint = fpMatch[1];
    if (fingerprint === undefined) {
      return;
    }

    this.logger.info(
      { actorLogin, fingerprint, repositoryId },
      'review-comment: persisting ignore feedback',
    );

    try {
      const result = await this.feedbackRepository.upsertByFingerprint(
        repositoryId,
        fingerprint,
        'ignore',
        actorLogin,
      );

      if (result === null) {
        this.logger.warn(
          { fingerprint, actorLogin, repositoryId },
          'review-comment: no finding found for fingerprint in this repository — feedback not stored',
        );
      }
    } catch (err) {
      this.logger.error(
        { err, fingerprint, actorLogin, repositoryId },
        'review-comment: failed to persist ignore feedback',
      );
    }
  }
}
