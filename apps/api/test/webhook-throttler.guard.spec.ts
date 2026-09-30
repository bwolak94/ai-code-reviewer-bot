import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock @nestjs/throttler so ThrottlerGuard becomes a plain base class with no
// DI requirements. This lets us instantiate WebhookThrottlerGuard directly
// without wiring up the full NestJS DI container.
// ---------------------------------------------------------------------------
vi.mock('@nestjs/throttler', () => {
  class ThrottlerGuard {
    // Minimal stub — no constructor dependencies required.
  }
  return { ThrottlerGuard };
});

// Import after the mock is registered.
const { WebhookThrottlerGuard } = await import(
  '../src/webhook/webhook-throttler.guard.js'
);

// ---------------------------------------------------------------------------
// Helper: build a minimal request-shaped object accepted by getTracker().
// ---------------------------------------------------------------------------
function makeReq(overrides: {
  installationHeader?: string | string[];
  ip?: string;
  socketRemoteAddress?: string;
}): Record<string, unknown> {
  const headers: Record<string, string | string[] | undefined> = {};

  if (overrides.installationHeader !== undefined) {
    headers['x-github-hook-installation-target-id'] =
      overrides.installationHeader;
  }

  const req: Record<string, unknown> = { headers };

  if (overrides.ip !== undefined) {
    req['ip'] = overrides.ip;
  }

  if (overrides.socketRemoteAddress !== undefined) {
    req['socket'] = { remoteAddress: overrides.socketRemoteAddress };
  }

  return req;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WebhookThrottlerGuard.getTracker', () => {
  let guard: InstanceType<typeof WebhookThrottlerGuard>;

  beforeEach(() => {
    guard = new WebhookThrottlerGuard();
  });

  it('returns "installation:<id>" when the installation target header is a string', async () => {
    const req = makeReq({ installationHeader: '12345' });
    // getTracker is protected — cast to access it in tests.
    const tracker = await (
      guard as unknown as { getTracker(r: Record<string, unknown>): Promise<string> }
    ).getTracker(req);
    expect(tracker).toBe('installation:12345');
  });

  it('returns "installation:<first>" when the installation target header is an array', async () => {
    const req = makeReq({ installationHeader: ['12345', '99999'] });
    const tracker = await (
      guard as unknown as { getTracker(r: Record<string, unknown>): Promise<string> }
    ).getTracker(req);
    expect(tracker).toBe('installation:12345');
  });

  it('falls back to req.ip when the installation header is absent', async () => {
    const req = makeReq({ ip: '1.2.3.4' });
    const tracker = await (
      guard as unknown as { getTracker(r: Record<string, unknown>): Promise<string> }
    ).getTracker(req);
    expect(tracker).toBe('1.2.3.4');
  });

  it('falls back to req.socket.remoteAddress when both header and req.ip are absent', async () => {
    const req = makeReq({ socketRemoteAddress: '5.6.7.8' });
    const tracker = await (
      guard as unknown as { getTracker(r: Record<string, unknown>): Promise<string> }
    ).getTracker(req);
    expect(tracker).toBe('5.6.7.8');
  });

  it('returns "unknown" when all sources are absent', async () => {
    const req: Record<string, unknown> = { headers: {} };
    const tracker = await (
      guard as unknown as { getTracker(r: Record<string, unknown>): Promise<string> }
    ).getTracker(req);
    expect(tracker).toBe('unknown');
  });
});
