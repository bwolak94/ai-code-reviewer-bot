import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { createHmac } from 'node:crypto';
import nock from 'nock';
import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const TEST_SECRET = 'test-webhook-secret';
const VALID_DELIVERY_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const SECOND_DELIVERY_ID = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';

// ─── Load the fixture payload ────────────────────────────────────────────────
const fixtureRaw = readFileSync(
  join(__dirname, 'fixtures', 'pull_request_opened.json'),
  'utf8',
);
const fixture = JSON.parse(fixtureRaw) as Record<string, unknown>;
// Remove _meta so the actual payload doesn't include test metadata.
const { _meta: _discarded, ...payload } = fixture;
const payloadBuffer = Buffer.from(JSON.stringify(payload), 'utf8');

function computeSignature(body: Buffer): string {
  return `sha256=${createHmac('sha256', TEST_SECRET).update(body).digest('hex')}`;
}

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Redis mock: tracks keys set via SET NX.
const redisStore = new Map<string, string>();
const redisMock = {
  set: vi.fn(
    async (
      key: string,
      _value: string,
      _exFlag: string,
      _ttl: number,
      _nxFlag: string,
    ) => {
      if (redisStore.has(key)) {
        return null; // NX: key already exists
      }
      redisStore.set(key, '1');
      return 'OK';
    },
  ),
};

vi.mock('ioredis', () => ({
  Redis: vi.fn(() => redisMock),
}));

vi.mock('../src/config/env.js', () => ({
  getEnv: () => ({
    GITHUB_WEBHOOK_SECRET: TEST_SECRET,
    NODE_ENV: 'test',
    PORT: 3001,
    GITHUB_APP_ID: '12345',
    GITHUB_PRIVATE_KEY:
      '-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----',
    REDIS_QUEUE_URL: 'redis://localhost:6379',
    REDIS_CACHE_URL: 'redis://localhost:6380',
    DATABASE_URL: 'postgres://localhost:5432/test',
  }),
  validateEnv: () => ({}),
}));

// ─── App setup ───────────────────────────────────────────────────────────────
const { AppModule } = await import('../src/app.module.js');

describe('WebhookController (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    const adapter = new FastifyAdapter({ logger: false });
    app = moduleRef.createNestApplication<NestFastifyApplication>(adapter);

    await app.init();

    // NestJS Fastify adapter registers its own application/json parser during init.
    // Replace it so the raw body buffer is available for HMAC verification in
    // WebhookGuard — mirrors what main.ts does in production.
    const httpInstance = app.getHttpAdapter().getInstance();
    httpInstance.removeContentTypeParser('application/json');
    httpInstance.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer' },
      (
        _req: unknown,
        body: Buffer,
        done: (err: null | Error, body: unknown) => void,
      ) => {
        try {
          const parsed: unknown = JSON.parse(body.toString('utf8'));
          const req = _req as Record<string, unknown>;
          req['rawBody'] = body;
          done(null, parsed);
        } catch (err) {
          done(err as Error, undefined);
        }
      },
    );
    await app.getHttpAdapter().getInstance().ready();

    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');
  });

  afterAll(async () => {
    nock.enableNetConnect();
    await app.close();
  });

  beforeEach(() => {
    redisStore.clear();
    vi.clearAllMocks();
    nock.cleanAll();
  });

  it('returns 200 for GET /health', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { status: string; timestamp: string };
    expect(body.status).toBe('ok');
    expect(typeof body.timestamp).toBe('string');
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });

  it('returns 202 for a POST to /webhooks/github with a valid HMAC', async () => {
    const sig = computeSignature(payloadBuffer);

    // In M1 there is no GitHub API call — check runs are a stub.
    // The test asserts the HTTP contract only.
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/github',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
        'x-github-delivery': VALID_DELIVERY_ID,
        'x-hub-signature-256': sig,
      },
      payload: payloadBuffer,
    });

    expect(response.statusCode).toBe(202);
  });

  it('returns 401 for a POST to /webhooks/github with an invalid HMAC', async () => {
    const wrongSig = computeSignature(Buffer.from('wrong-body', 'utf8'));

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/github',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
        'x-github-delivery': VALID_DELIVERY_ID,
        'x-hub-signature-256': wrongSig,
      },
      payload: payloadBuffer,
    });

    expect(response.statusCode).toBe(401);
  });

  it('returns 401 when the X-Hub-Signature-256 header is missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/github',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
        'x-github-delivery': VALID_DELIVERY_ID,
      },
      payload: payloadBuffer,
    });

    expect(response.statusCode).toBe(401);
  });

  it('returns 400 for a malformed delivery ID (no hyphens)', async () => {
    const sig = computeSignature(payloadBuffer);

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/github',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
        'x-github-delivery': 'a1b2c3d4e5f67890abcdef1234567890ab', // no hyphens
        'x-hub-signature-256': sig,
      },
      payload: payloadBuffer,
    });

    expect(response.statusCode).toBe(400);
  });

  it('returns 202 for a duplicate delivery and does not re-process', async () => {
    const sig = computeSignature(payloadBuffer);

    // First request — registers the delivery ID in Redis.
    const first = await app.inject({
      method: 'POST',
      url: '/webhooks/github',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
        'x-github-delivery': SECOND_DELIVERY_ID,
        'x-hub-signature-256': sig,
      },
      payload: payloadBuffer,
    });

    expect(first.statusCode).toBe(202);

    // Second request with the same delivery ID — must be treated as duplicate.
    const second = await app.inject({
      method: 'POST',
      url: '/webhooks/github',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
        'x-github-delivery': SECOND_DELIVERY_ID,
        'x-hub-signature-256': sig,
      },
      payload: payloadBuffer,
    });

    expect(second.statusCode).toBe(202);

    // Redis SET NX was called twice (once per request) but the second returned null.
    expect(redisMock.set).toHaveBeenCalledTimes(2);

    // Both calls used the same key, confirming the dedup key is based on delivery ID.
    const calls = redisMock.set.mock.calls as unknown[][];
    expect(calls[0]?.[0]).toBe(`dedup:delivery:${SECOND_DELIVERY_ID}`);
    expect(calls[1]?.[0]).toBe(`dedup:delivery:${SECOND_DELIVERY_ID}`);
  });

  it('mocks GitHub check-run creation via nock (demonstrates integration point for M2)', async () => {
    // In M1, the webhook returns 202 without calling the GitHub API.
    // This test demonstrates that nock is correctly configured to intercept
    // outbound API calls and that no unintended HTTP requests escape.
    const githubMock = nock('https://api.github.com')
      .post(/\/repos\/.+\/check-runs$/)
      .reply(201, {
        id: 99887766,
        status: 'queued',
        name: 'ai-code-review',
      });

    const sig = computeSignature(payloadBuffer);

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/github',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
        'x-github-delivery': 'c3d4e5f6-a7b8-9012-cdef-234567890123',
        'x-hub-signature-256': sig,
      },
      payload: payloadBuffer,
    });

    expect(response.statusCode).toBe(202);

    // In M1, the nock interceptor is NOT called because check run creation
    // is a stub. M2 will enqueue a job that calls the GitHub API, at which
    // point this assertion changes to: expect(githubMock.isDone()).toBe(true).
    expect(githubMock.isDone()).toBe(false);

    // Clean up unused interceptor.
    nock.cleanAll();
  });
});
