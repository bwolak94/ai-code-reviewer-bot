import { eq } from 'drizzle-orm';
import type { DrizzleDb } from '../client.js';
import {
  installations,
  repositories,
  type Installation,
  type NewInstallation,
  type NewRepository,
  type Repository,
} from '../schema.js';

export interface InstallationWithRepositories extends Installation {
  repositories: Repository[];
}

/**
 * Data access layer for the `installations` and `repositories` tables.
 *
 * All methods accept an explicit `db` instance to support both the root
 * connection and the tenant-scoped transaction passed from `withTenantContext`.
 */
export class InstallationRepository {
  constructor(private readonly db: DrizzleDb) {}

  /**
   * Upserts an installation record. On conflict (same PK), updates
   * accountLogin, accountType, and updatedAt.
   */
  async upsertInstallation(
    data: NewInstallation,
  ): Promise<Installation> {
    const rows = await this.db
      .insert(installations)
      .values(data)
      .onConflictDoUpdate({
        target: installations.id,
        set: {
          accountLogin: data.accountLogin,
          accountType: data.accountType,
          updatedAt: new Date(),
        },
      })
      .returning();

    const row = rows[0];
    if (row === undefined) {
      throw new Error(
        `upsertInstallation: no row returned for id=${String(data.id)}`,
      );
    }
    return row;
  }

  /**
   * Upserts a repository record. On conflict (same PK), updates fullName.
   */
  async upsertRepository(data: NewRepository): Promise<Repository> {
    const rows = await this.db
      .insert(repositories)
      .values(data)
      .onConflictDoUpdate({
        target: repositories.id,
        set: {
          fullName: data.fullName,
        },
      })
      .returning();

    const row = rows[0];
    if (row === undefined) {
      throw new Error(
        `upsertRepository: no row returned for id=${String(data.id)}`,
      );
    }
    return row;
  }

  /**
   * Sets `suspended_at` to the provided timestamp for the given installation.
   */
  async suspendInstallation(
    id: number,
    suspendedAt: Date,
  ): Promise<void> {
    await this.db
      .update(installations)
      .set({ suspendedAt, updatedAt: new Date() })
      .where(eq(installations.id, id));
  }

  /**
   * Clears `suspended_at` (sets to NULL) for the given installation.
   */
  async unsuspendInstallation(id: number): Promise<void> {
    await this.db
      .update(installations)
      .set({ suspendedAt: null, updatedAt: new Date() })
      .where(eq(installations.id, id));
  }

  /**
   * Returns a single repository row by its GitHub repository ID,
   * or `undefined` if not found.
   *
   * The fullName field (e.g. "owner/repo") can be split on the first `/`
   * to obtain the owner login and repository slug for GitHub API calls.
   */
  async findRepositoryById(id: number): Promise<Repository | undefined> {
    const rows = await this.db
      .select()
      .from(repositories)
      .where(eq(repositories.id, id))
      .limit(1);

    return rows[0];
  }

  /**
   * Returns an installation row with all its associated repositories,
   * or `undefined` if not found.
   */
  async findByInstallationId(
    id: number,
  ): Promise<InstallationWithRepositories | undefined> {
    const installationRows = await this.db
      .select()
      .from(installations)
      .where(eq(installations.id, id))
      .limit(1);

    const installation = installationRows[0];
    if (installation === undefined) {
      return undefined;
    }

    const repos = await this.db
      .select()
      .from(repositories)
      .where(eq(repositories.installationId, id));

    return { ...installation, repositories: repos };
  }
}
