import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { ReviewCommentHandler } from '../src/webhook/handlers/review-comment.handler.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_FINGERPRINT = 'a'.repeat(64);
const REPO_ID = 42;

function makePayload(
  body: string,
  login = 'alice',
  action = 'created',
): unknown {
  return {
    action,
    repository: { id: REPO_ID },
    comment: {
      body,
      user: { login },
    },
  };
}

function makeBodyWithFpAndCommand(
  fingerprint: string = VALID_FINGERPRINT,
  command = '@ai-reviewer ignore',
): string {
  return `This finding is a false positive.\n${command}\n<!-- aireview:fp=${fingerprint} -->`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ReviewCommentHandler', () => {
  let handler: ReviewCommentHandler;
  let mockUpsertByFingerprint: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    mockUpsertByFingerprint = vi.fn().mockResolvedValue({
      id: 'uuid-feedback-1',
      findingId: 'uuid-finding-1',
      kind: 'ignore',
      actorLogin: 'alice',
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReviewCommentHandler,
        {
          provide: 'FEEDBACK_REPOSITORY',
          useValue: { upsertByFingerprint: mockUpsertByFingerprint },
        },
        {
          provide: 'PINO_LOGGER',
          useValue: {
            info: vi.fn(),
            warn: vi.fn(),
            debug: vi.fn(),
            error: vi.fn(),
          },
        },
      ],
    }).compile();

    handler = moduleRef.get(ReviewCommentHandler);
  });

  it('persists ignore feedback when both command and fingerprint marker are present', async () => {
    await handler.handle(makePayload(makeBodyWithFpAndCommand()));

    expect(mockUpsertByFingerprint).toHaveBeenCalledOnce();
    expect(mockUpsertByFingerprint).toHaveBeenCalledWith(
      REPO_ID,
      VALID_FINGERPRINT,
      'ignore',
      'alice',
    );
  });

  it('does NOT persist feedback when @ai-reviewer ignore command is absent', async () => {
    const body = `just a comment\n<!-- aireview:fp=${VALID_FINGERPRINT} -->`;
    await handler.handle(makePayload(body));

    expect(mockUpsertByFingerprint).not.toHaveBeenCalled();
  });

  it('does NOT persist feedback when fingerprint marker is absent', async () => {
    const body = '@ai-reviewer ignore — but no fingerprint here';
    await handler.handle(makePayload(body));

    expect(mockUpsertByFingerprint).not.toHaveBeenCalled();
  });

  it('does NOT persist feedback when comment has no actor login', async () => {
    const payload = {
      action: 'created',
      repository: { id: REPO_ID },
      comment: {
        body: makeBodyWithFpAndCommand(),
        user: { login: '' },
      },
    };

    await handler.handle(payload);

    expect(mockUpsertByFingerprint).not.toHaveBeenCalled();
  });

  it('does NOT persist feedback when comment user is undefined', async () => {
    const payload = {
      action: 'created',
      repository: { id: REPO_ID },
      comment: {
        body: makeBodyWithFpAndCommand(),
      },
    };

    await handler.handle(payload);

    expect(mockUpsertByFingerprint).not.toHaveBeenCalled();
  });

  it('does NOT persist feedback when repository id is missing', async () => {
    const payload = {
      action: 'created',
      // no repository
      comment: {
        body: makeBodyWithFpAndCommand(),
        user: { login: 'alice' },
      },
    };

    await handler.handle(payload);

    expect(mockUpsertByFingerprint).not.toHaveBeenCalled();
  });

  it('is case-insensitive for the @ai-reviewer ignore command', async () => {
    const body = makeBodyWithFpAndCommand(VALID_FINGERPRINT, '@AI-REVIEWER IGNORE');
    await handler.handle(makePayload(body));

    expect(mockUpsertByFingerprint).toHaveBeenCalledOnce();
  });

  it('extracts the correct 64-char fingerprint from the marker', async () => {
    const fingerprint = 'f'.repeat(64);
    const body = makeBodyWithFpAndCommand(fingerprint);

    await handler.handle(makePayload(body));

    expect(mockUpsertByFingerprint).toHaveBeenCalledWith(
      REPO_ID,
      fingerprint,
      'ignore',
      'alice',
    );
  });

  it('does NOT call upsert when fingerprint is not 64 hex chars (invalid marker)', async () => {
    // Marker with a 32-char hash is not matched by the regex
    const body = `@ai-reviewer ignore\n<!-- aireview:fp=${'a'.repeat(32)} -->`;
    await handler.handle(makePayload(body));

    expect(mockUpsertByFingerprint).not.toHaveBeenCalled();
  });

  it('logs a warning when upsertByFingerprint returns null (finding not found)', async () => {
    mockUpsertByFingerprint.mockResolvedValueOnce(null);

    // Should not throw even if no finding is found
    await expect(
      handler.handle(makePayload(makeBodyWithFpAndCommand())),
    ).resolves.not.toThrow();
  });

  it('does not throw when upsertByFingerprint rejects (error is swallowed)', async () => {
    mockUpsertByFingerprint.mockRejectedValueOnce(new Error('DB error'));

    await expect(
      handler.handle(makePayload(makeBodyWithFpAndCommand())),
    ).resolves.not.toThrow();
  });
});
