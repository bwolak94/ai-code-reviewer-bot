import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { WebhookService } from '../src/webhook/webhook.service.js';
import { InstallationService } from '../src/installation/installation.service.js';
import { ReviewQueueService } from '../src/queue/review-queue.service.js';
import { CheckRunHandler } from '../src/webhook/handlers/check-run.handler.js';
import { ReviewCommentHandler } from '../src/webhook/handlers/review-comment.handler.js';
import { METRIC_WEBHOOK_RECEIVED } from '../src/metrics/metrics.module.js';

// ---------------------------------------------------------------------------
// Unit tests for WebhookService metric instrumentation
// ---------------------------------------------------------------------------

describe('WebhookService metrics', () => {
  let service: WebhookService;
  let mockMetricInc: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    mockMetricInc = vi.fn();

    const moduleRef = await Test.createTestingModule({
      providers: [
        WebhookService,
        {
          provide: 'PINO_LOGGER',
          useValue: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
        },
        {
          provide: METRIC_WEBHOOK_RECEIVED,
          useValue: { inc: mockMetricInc },
        },
        {
          provide: InstallationService,
          useValue: {
            handleCreated: vi.fn().mockResolvedValue(undefined),
            handleDeleted: vi.fn().mockResolvedValue(undefined),
            handleSuspend: vi.fn().mockResolvedValue(undefined),
            handleUnsuspend: vi.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: ReviewQueueService,
          useValue: { enqueueReviewJob: vi.fn().mockResolvedValue(undefined) },
        },
        {
          provide: CheckRunHandler,
          useValue: { handle: vi.fn().mockResolvedValue(undefined) },
        },
        {
          provide: ReviewCommentHandler,
          useValue: { handle: vi.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = moduleRef.get(WebhookService);
  });

  it('increments METRIC_WEBHOOK_RECEIVED with event and action labels', async () => {
    await service.route('pull_request', 'opened', {}, 'delivery-abc');

    expect(mockMetricInc).toHaveBeenCalledOnce();
    expect(mockMetricInc).toHaveBeenCalledWith({ event: 'pull_request', action: 'opened' });
  });

  it('increments METRIC_WEBHOOK_RECEIVED for every routed event regardless of type', async () => {
    await service.route('installation', 'created', { installation: { id: 1, account: { login: 'acme', type: 'Organization' } } }, 'delivery-xyz');

    expect(mockMetricInc).toHaveBeenCalledWith({ event: 'installation', action: 'created' });
  });
});
