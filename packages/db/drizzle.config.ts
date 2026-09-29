import type { Config } from 'drizzle-kit';

const config: Config = {
  schema: './src/schema.ts',
  out: './src/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'postgres://localhost:5432/aireview',
  },
  verbose: true,
  strict: true,
};

export default config;
