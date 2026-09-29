import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { InstallationTokenService } from '../src/github/installation-token.service.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** A valid 32-byte key expressed as 64 hex chars. */
const VALID_KEY = 'a'.repeat(64); // 64 'a' chars = 32 bytes of 0xaa

const INSTALLATION_ID = 42;
const PLAINTEXT_TOKEN = 'ghs_test_installation_token_value_xyz';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildModule(
  redisGetReturn: string | null,
  tokenFromGithub: string = PLAINTEXT_TOKEN,
) {
  const mockRedisGet = vi.fn().mockResolvedValue(redisGetReturn);
  const mockRedisSet = vi.fn().mockResolvedValue('OK');
  const mockRedisDel = vi.fn().mockResolvedValue(1);

  const mockGetInstallationToken = vi.fn().mockResolvedValue(tokenFromGithub);

  const loggerInfoSpy = vi.fn();
  const loggerWarnSpy = vi.fn();
  const loggerDebugSpy = vi.fn();

  return Test.createTestingModule({
    providers: [
      InstallationTokenService,
      {
        provide: 'REDIS_CACHE',
        useValue: {
          get: mockRedisGet,
          set: mockRedisSet,
          del: mockRedisDel,
        },
      },
      {
        provide: 'APP_AUTH',
        useValue: {
          getInstallationToken: mockGetInstallationToken,
        },
      },
      {
        provide: 'PINO_LOGGER',
        useValue: {
          info: loggerInfoSpy,
          warn: loggerWarnSpy,
          debug: loggerDebugSpy,
          error: vi.fn(),
        },
      },
      {
        provide: 'TOKEN_ENCRYPTION_KEY',
        useValue: VALID_KEY,
      },
    ],
  })
    .compile()
    .then((moduleRef) => ({
      service: moduleRef.get(InstallationTokenService),
      mockRedisGet,
      mockRedisSet,
      mockGetInstallationToken,
      loggerInfoSpy,
      loggerWarnSpy,
      loggerDebugSpy,
    }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InstallationTokenService', () => {
  describe('cache miss → GitHub API call', () => {
    it('calls GitHub when Redis returns null and caches the encrypted value', async () => {
      const {
        service,
        mockRedisGet,
        mockRedisSet,
        mockGetInstallationToken,
      } = await buildModule(null);

      const token = await service.getInstallationToken(INSTALLATION_ID);

      expect(token).toBe(PLAINTEXT_TOKEN);
      expect(mockRedisGet).toHaveBeenCalledWith(`token:${INSTALLATION_ID}`);
      expect(mockGetInstallationToken).toHaveBeenCalledWith(INSTALLATION_ID);
      expect(mockRedisSet).toHaveBeenCalledOnce();

      // The stored value must not equal the plaintext token (it must be encrypted).
      const storedValue = mockRedisSet.mock.calls[0]?.[1] as string;
      expect(storedValue).not.toBe(PLAINTEXT_TOKEN);
      expect(typeof storedValue).toBe('string');
      expect(storedValue.length).toBeGreaterThan(PLAINTEXT_TOKEN.length);
    });

    it('sets TTL to 55 minutes (3300 seconds) when caching', async () => {
      const { service, mockRedisSet } = await buildModule(null);

      await service.getInstallationToken(INSTALLATION_ID);

      const setArgs = mockRedisSet.mock.calls[0] as unknown[];
      // Expected call: redis.set(key, encrypted, 'EX', 3300)
      expect(setArgs[2]).toBe('EX');
      expect(setArgs[3]).toBe(3300);
    });

    it('stores an iv:authTag:ciphertext formatted string in Redis', async () => {
      const { service, mockRedisSet } = await buildModule(null);

      await service.getInstallationToken(INSTALLATION_ID);

      const storedValue = mockRedisSet.mock.calls[0]?.[1] as string;
      const parts = storedValue.split(':');
      // iv:authTag:ciphertext = exactly 3 colon-separated hex strings
      expect(parts).toHaveLength(3);
      expect(parts.every((p) => /^[0-9a-f]+$/i.test(p))).toBe(true);
    });
  });

  describe('cache hit → decrypt without GitHub call', () => {
    it('decrypts the cached value and returns the plaintext token', async () => {
      // First pass: get a real encrypted value by doing a cache miss.
      const { service: s1, mockRedisSet } = await buildModule(null);
      await s1.getInstallationToken(INSTALLATION_ID);
      const encryptedValue = mockRedisSet.mock.calls[0]?.[1] as string;

      // Second pass: simulate a cache hit with the encrypted value.
      const {
        service: s2,
        mockGetInstallationToken,
      } = await buildModule(encryptedValue);

      const token = await s2.getInstallationToken(INSTALLATION_ID);

      expect(token).toBe(PLAINTEXT_TOKEN);
      // GitHub should NOT have been called on cache hit.
      expect(mockGetInstallationToken).not.toHaveBeenCalled();
    });
  });

  describe('security — token never appears in logs', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('does not log the raw token in logger.info on cache miss', async () => {
      const { service, loggerInfoSpy } = await buildModule(null);

      await service.getInstallationToken(INSTALLATION_ID);

      for (const call of loggerInfoSpy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(PLAINTEXT_TOKEN);
      }
    });

    it('does not log the raw token in logger.debug on cache miss', async () => {
      const { service, loggerDebugSpy } = await buildModule(null);

      await service.getInstallationToken(INSTALLATION_ID);

      for (const call of loggerDebugSpy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(PLAINTEXT_TOKEN);
      }
    });

    it('does not log the raw token in any logger call on cache hit', async () => {
      // Get encrypted value.
      const { service: s1, mockRedisSet } = await buildModule(null);
      await s1.getInstallationToken(INSTALLATION_ID);
      const encrypted = mockRedisSet.mock.calls[0]?.[1] as string;

      const { service: s2, loggerInfoSpy, loggerDebugSpy, loggerWarnSpy } = await buildModule(encrypted);

      await s2.getInstallationToken(INSTALLATION_ID);

      for (const spy of [loggerInfoSpy, loggerDebugSpy, loggerWarnSpy]) {
        for (const call of spy.mock.calls) {
          expect(JSON.stringify(call)).not.toContain(PLAINTEXT_TOKEN);
        }
      }
    });
  });

  describe('encryption integrity', () => {
    it('encrypted value differs from plaintext', async () => {
      const { service, mockRedisSet } = await buildModule(null);

      await service.getInstallationToken(INSTALLATION_ID);

      const stored = mockRedisSet.mock.calls[0]?.[1] as string;
      expect(stored).not.toBe(PLAINTEXT_TOKEN);
      expect(stored).not.toContain(PLAINTEXT_TOKEN);
    });

    it('round-trip: encrypt then decrypt returns original value', async () => {
      const { service: s1, mockRedisSet } = await buildModule(null);
      await s1.getInstallationToken(INSTALLATION_ID);
      const encrypted = mockRedisSet.mock.calls[0]?.[1] as string;

      // Use the same key — decrypt via cache hit path.
      const { service: s2 } = await buildModule(encrypted);
      const recovered = await s2.getInstallationToken(INSTALLATION_ID);

      expect(recovered).toBe(PLAINTEXT_TOKEN);
    });
  });

  describe('constructor validation', () => {
    it('throws if TOKEN_ENCRYPTION_KEY is not 64 hex chars', async () => {
      await expect(
        Test.createTestingModule({
          providers: [
            InstallationTokenService,
            { provide: 'REDIS_CACHE', useValue: { get: vi.fn(), set: vi.fn() } },
            { provide: 'APP_AUTH', useValue: {} },
            { provide: 'PINO_LOGGER', useValue: { info: vi.fn(), debug: vi.fn() } },
            { provide: 'TOKEN_ENCRYPTION_KEY', useValue: 'tooshort' },
          ],
        }).compile(),
      ).rejects.toThrow('TOKEN_ENCRYPTION_KEY must be exactly 64 hex characters');
    });
  });
});
