import { App } from '@octokit/app';
import type { InstallationTokenCache } from './types.js';

interface AppAuthOptions {
  appId: number | string;
  privateKey: string;
}

/**
 * Manages GitHub App JWT generation and installation token exchange.
 * Tokens are cached in-memory (M1) with a 5-minute expiry buffer to prevent
 * using tokens that are about to expire.
 *
 * SEC-008: Callers must ensure tokens are never logged directly.
 */
export class AppAuth {
  private readonly app: App;
  private readonly tokenCache = new Map<number, InstallationTokenCache>();

  constructor(options: AppAuthOptions) {
    this.app = new App({
      appId: options.appId,
      privateKey: options.privateKey,
    });
  }

  /**
   * Returns a valid installation access token, fetching a fresh one if the
   * cached token is missing or will expire within 5 minutes.
   */
  async getInstallationToken(installationId: number): Promise<string> {
    const cached = this.tokenCache.get(installationId);
    const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);

    if (cached !== undefined && cached.expiresAt > fiveMinutesFromNow) {
      return cached.token;
    }

    const octokit = await this.app.getInstallationOctokit(installationId);

    // Perform a lightweight authenticated request to retrieve the token and
    // its expiry from the auth state injected by @octokit/auth-app.
    const authResult = await octokit.auth({
      type: 'installation',
      installationId,
    }) as { token: string; expiresAt: string };

    const expiresAt = new Date(authResult.expiresAt);

    this.tokenCache.set(installationId, {
      token: authResult.token,
      expiresAt,
    });

    return authResult.token;
  }

  /**
   * Evicts a cached token for a given installation. Call this when an API
   * request returns 401, indicating the token was revoked or expired early.
   */
  evictToken(installationId: number): void {
    this.tokenCache.delete(installationId);
  }
}
