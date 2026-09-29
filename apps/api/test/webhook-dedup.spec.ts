import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';

// Mock ioredis so tests do not require a running Redis instance.
const redisMock = {
  set: vi.fn(),
};

vi.mock('ioredis', () => ({
  default: vi.fn(() => redisMock),
}));

// Mock env.
vi.mock('../src/config/env.js', () => ({
  getEnv: () => ({
    GITHUB_WEBHOOK_SECRET: 'test-webhook-secret',
    NODE_ENV: 'test',
    PORT: 3000,
    GITHUB_APP_ID: 'test-app-id',
    GITHUB_PRIVATE_KEY: 'test-private-key',
    REDIS_QUEUE_URL: 'redis://localhost:6379',
    REDIS_CACHE_URL: 'redis://localhost:6380',
    DATABASE_URL: 'postgres://localhost:5432/test',
  }),
  validateEnv: () => ({}),
}));

const { DedupService } = await import('../src/webhook/dedup.service.js');

describe('DedupService', () => {
  let service: InstanceType<typeof DedupService>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new DedupService(redisMock as never);
  });

  describe('UUID format validation (SEC-026)', () => {
    it('accepts a valid UUID v4 delivery ID', async () => {
      redisMock.set.mockResolvedValueOnce('OK');

      const result = await service.isDuplicate(
        'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      );

      expect(result).toBe(false);
    });

    it('throws BadRequestException for a UUID without hyphens', async () => {
      await expect(
        service.isDuplicate('a1b2c3d4e5f67890abcdef1234567890ab'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for a UUID with trailing whitespace', async () => {
      await expect(
        service.isDuplicate('a1b2c3d4-e5f6-7890-abcd-ef1234567890 '),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for an empty string', async () => {
      await expect(service.isDuplicate('')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for a wildcard character', async () => {
      await expect(
        service.isDuplicate('a1b2c3d4-e5f6-*890-abcd-ef1234567890'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for an ID that is too short', async () => {
      await expect(service.isDuplicate('a1b2c3d4-short')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('does not call Redis when the delivery ID is invalid', async () => {
      try {
        await service.isDuplicate('invalid!@#$%');
      } catch {
        // expected
      }

      expect(redisMock.set).not.toHaveBeenCalled();
    });
  });

  describe('Redis SET NX deduplication', () => {
    const VALID_DELIVERY_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

    it('calls Redis SET with correct key, value, EX flag, and 86400 TTL', async () => {
      redisMock.set.mockResolvedValueOnce('OK');

      await service.isDuplicate(VALID_DELIVERY_ID);

      expect(redisMock.set).toHaveBeenCalledWith(
        `dedup:delivery:${VALID_DELIVERY_ID}`,
        '1',
        'EX',
        86_400,
        'NX',
      );
    });

    it('returns false (not a duplicate) when Redis SET NX succeeds (returns "OK")', async () => {
      redisMock.set.mockResolvedValueOnce('OK');

      const result = await service.isDuplicate(VALID_DELIVERY_ID);

      expect(result).toBe(false);
    });

    it('returns true (is a duplicate) when Redis SET NX returns null (key already exists)', async () => {
      redisMock.set.mockResolvedValueOnce(null);

      const result = await service.isDuplicate(VALID_DELIVERY_ID);

      expect(result).toBe(true);
    });

    it('calls Redis SET only once even when called concurrently with the same ID', async () => {
      // First call succeeds, second returns null (duplicate).
      redisMock.set
        .mockResolvedValueOnce('OK')
        .mockResolvedValueOnce(null);

      const [first, second] = await Promise.all([
        service.isDuplicate(VALID_DELIVERY_ID),
        service.isDuplicate(VALID_DELIVERY_ID),
      ]);

      // One of the two calls found the key already set.
      expect(first).toBe(false);
      expect(second).toBe(true);
      expect(redisMock.set).toHaveBeenCalledTimes(2);
    });

    it('uses TTL of exactly 86400 seconds — NOT 3600 (INCONSISTENCY-01 fix)', async () => {
      redisMock.set.mockResolvedValueOnce('OK');

      await service.isDuplicate(VALID_DELIVERY_ID);

      const callArgs = redisMock.set.mock.calls[0] as unknown[];
      const ttlIndex = callArgs.indexOf('EX');
      const ttlValue = callArgs[ttlIndex + 1];

      expect(ttlValue).toBe(86_400);
      expect(ttlValue).not.toBe(3_600);
    });
  });
});
