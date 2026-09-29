import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import * as schema from './schema.js';

export type DbSchema = typeof schema;
export type DrizzleDb = ReturnType<typeof drizzle<DbSchema>>;

/**
 * Creates a PostgreSQL connection pool and a Drizzle ORM instance.
 * The DATABASE_URL environment variable must be set before calling this.
 *
 * Connection pool is configured conservatively for a microservice context:
 * max 20 connections, 30s idle timeout, 10s connection timeout.
 */
export function createDb(databaseUrl: string): { db: DrizzleDb; pool: Pool } {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  const db = drizzle(pool, { schema });

  return { db, pool };
}

/**
 * Executes a callback within a transaction with the multi-tenant RLS context
 * set via `SET LOCAL app.current_installation_id`.
 *
 * All DB queries for a given installation must be wrapped in this helper to
 * ensure row-level security policies (applied at the PostgreSQL level) receive
 * the correct tenant context.
 *
 * NOTE: `SET LOCAL` is transaction-scoped and resets automatically when the
 * transaction ends, so no explicit cleanup is needed.
 */
export async function withTenantContext<T>(
  db: DrizzleDb,
  installationId: number,
  fn: (db: DrizzleDb) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    // Use a parameterised-style execute to set the session-local tenant context.
    // Note: SET LOCAL does not support query parameters in PostgreSQL, so we
    // cast the integer to a string and use a template literal — safe because
    // installationId is typed as `number` (not user input).
    await tx.execute(sql.raw(`SET LOCAL app.current_installation_id = '${installationId}'`));
    // Cast is safe: drizzle transaction type is compatible for our usage.
    return fn(tx as unknown as DrizzleDb);
  });
}
