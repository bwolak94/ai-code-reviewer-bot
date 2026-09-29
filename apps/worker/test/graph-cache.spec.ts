import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { createHmac } from 'node:crypto';
import { GraphCacheService } from '../src/arch/graph-cache.service.js';
import type { RuleViolation } from '@repo/arch-graph';

// Mock getWorkerEnv to provide required env vars
vi.mock('../src/config/env.js', () => ({
  getWorkerEnv: vi.fn(() => ({
    NODE_ENV: 'test',
    GITHUB_APP_ID: 'test-app-id',
    GITHUB_PRIVATE_KEY: 'x'.repeat(200),
    GITHUB_WEBHOOK_SECRET: 'test-webhook-secret-for-hmac-derivation',
    REDIS_QUEUE_URL: 'redis://localhost:6379',
    REDIS_CACHE_URL: 'redis://localhost:6380',
    DATABASE_URL: 'postgresql://localhost/test',
    TOKEN_ENCRYPTION_KEY: 'a'.repeat(64),
    WORKER_CONCURRENCY: 4,
    WORKER_MAX_WORKSPACE_MB: 512,
  })),
}));

const TEST_WEBHOOK_SECRET = 'test-webhook-secret-for-hmac-derivation';

/**
 * Derives the same HMAC key that GraphCacheService uses internally.
 * Returns a Buffer to match the service's HIGH-4 change.
 */
function deriveHmacKey(): Buffer {
  return createHmac('sha256', TEST_WEBHOOK_SECRET)
    .update('graph-cache-v1')
    .digest(); // Returns Buffer, matching service internals
}

function computeHmac(key: Buffer, data: string): string {
  return createHmac('sha256', key).update(data).digest('hex');
}

function makeViolation(overrides: Partial<RuleViolation> = {}): RuleViolation {
  return {
    rule: 'layer-dependency',
    file: 'src/domain/user.ts',
    line: 1,
    message: 'Layer violation',
    severity: 'high',
    fingerprint: 'a'.repeat(64),
    ...overrides,
  };
}

describe('GraphCacheService', () => {
  let service: GraphCacheService;
  let mockRedisGet: ReturnType<typeof vi.fn>;
  let mockRedisSet: ReturnType<typeof vi.fn>;
  let mockLogger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();

    mockRedisGet = vi.fn().mockResolvedValue(null);
    mockRedisSet = vi.fn().mockResolvedValue('OK');

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        GraphCacheService,
        {
          provide: 'REDIS_CACHE',
          useValue: {
            get: mockRedisGet,
            set: mockRedisSet,
          },
        },
        {
          provide: 'PINO_LOGGER',
          useValue: mockLogger,
        },
      ],
    }).compile();

    service = moduleRef.get(GraphCacheService);
  });

  describe('getBaseGraph', () => {
    it('returns null on cache miss (Redis returns null)', async () => {
      mockRedisGet.mockResolvedValue(null);

      const result = await service.getBaseGraph(100, 'abc1234');

      expect(result).toBeNull();
      expect(mockRedisGet).toHaveBeenCalledWith('bgraph:100:abc1234');
    });

    it('returns violations on valid cache hit with correct HMAC', async () => {
      const violations = [makeViolation()];
      const data = JSON.stringify(violations);
      const hmacKey = deriveHmacKey();
      const hmac = computeHmac(hmacKey, data);

      mockRedisGet.mockResolvedValue(JSON.stringify({ data, hmac }));

      const result = await service.getBaseGraph(100, 'abc1234');

      expect(result).toEqual(violations);
    });

    it('returns null and logs warning when HMAC is tampered (one char flipped)', async () => {
      const violations = [makeViolation()];
      const data = JSON.stringify(violations);
      const hmacKey = deriveHmacKey();
      const validHmac = computeHmac(hmacKey, data);

      // Flip the first character of the HMAC to tamper with it
      const tamperedHmac =
        (validHmac[0] === 'a' ? 'b' : 'a') + validHmac.slice(1);

      mockRedisGet.mockResolvedValue(
        JSON.stringify({ data, hmac: tamperedHmac }),
      );

      const result = await service.getBaseGraph(100, 'abc1234');

      expect(result).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'bgraph:100:abc1234' }),
        expect.stringContaining('HMAC'),
      );
    });

    it('returns null and logs warning when stored data is tampered (HMAC mismatch)', async () => {
      const violations = [makeViolation()];
      const originalData = JSON.stringify(violations);
      const hmacKey = deriveHmacKey();

      // Compute HMAC for original data
      const hmac = computeHmac(hmacKey, originalData);

      // Tamper the data itself (replace last ']' with 'x' to change content)
      const tamperedData = originalData.slice(0, -1) + 'x';

      mockRedisGet.mockResolvedValue(
        JSON.stringify({ data: tamperedData, hmac }),
      );

      const result = await service.getBaseGraph(100, 'abc1234');

      expect(result).toBeNull();
      // MED-7: Assert the specific HMAC verification failure message.
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'bgraph:100:abc1234' }),
        expect.stringContaining('HMAC verification failed'),
      );
    });

    it('returns null when stored JSON is unparseable', async () => {
      mockRedisGet.mockResolvedValue('not-valid-json{{{');

      const result = await service.getBaseGraph(100, 'abc1234');

      expect(result).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe('setBaseGraph', () => {
    it('stores violations with HMAC in Redis with 7-day TTL', async () => {
      const violations = [makeViolation()];

      await service.setBaseGraph(100, 'abc1234', violations);

      expect(mockRedisSet).toHaveBeenCalledOnce();
      const [key, value, exFlag, ttl] = mockRedisSet.mock.calls[0] as [
        string,
        string,
        string,
        number,
      ];

      expect(key).toBe('bgraph:100:abc1234');
      expect(exFlag).toBe('EX');
      expect(ttl).toBe(604_800);

      const stored = JSON.parse(value) as { data: string; hmac: string };
      expect(stored.data).toBeDefined();
      expect(stored.hmac).toBeDefined();

      const parsedViolations = JSON.parse(stored.data) as RuleViolation[];
      expect(parsedViolations).toEqual(violations);
    });

    it('stored HMAC can be verified by getBaseGraph (round-trip)', async () => {
      const violations = [
        makeViolation({ file: 'src/a.ts', fingerprint: 'b'.repeat(64) }),
        makeViolation({ file: 'src/b.ts', fingerprint: 'c'.repeat(64) }),
      ];

      let storedValue: string | undefined;

      mockRedisSet.mockImplementation(
        (_key: string, value: string) => {
          storedValue = value;
          return Promise.resolve('OK');
        },
      );

      await service.setBaseGraph(200, 'bcd4567', violations);

      // Now simulate a get with the stored value
      mockRedisGet.mockResolvedValue(storedValue ?? null);

      const result = await service.getBaseGraph(200, 'bcd4567');

      expect(result).toEqual(violations);
    });

    it('stores an empty violations array without error', async () => {
      await service.setBaseGraph(100, 'cde5678', []);

      expect(mockRedisSet).toHaveBeenCalledOnce();
    });
  });
});
