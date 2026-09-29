import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  // GitHub App
  GITHUB_APP_ID: z.string().min(1),
  // RSA PEM keys are ~1700+ chars minimum; min(100) catches obviously wrong values
  // (truncated secret injection, placeholder strings) at startup rather than runtime.
  // SEC-032: fail-fast validation for private key format.
  GITHUB_PRIVATE_KEY: z
    .string()
    .min(100, 'GITHUB_PRIVATE_KEY appears truncated — expected a full PEM private key'),
  GITHUB_WEBHOOK_SECRET: z.string().min(1),

  // Redis
  REDIS_QUEUE_URL: z.string().url(),
  REDIS_CACHE_URL: z.string().url(),

  // Database
  DATABASE_URL: z.string().url(),
});

export type Env = z.infer<typeof EnvSchema>;

let _env: Env | undefined;

/**
 * Validates and returns the current process environment against the schema.
 * Throws a ZodError with a descriptive message if any variable is missing or
 * malformed. Called once at bootstrap to fail fast on misconfiguration.
 */
export function validateEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(raw);

  if (!result.success) {
    const formatted = result.error.errors
      .map((e) => `  ${e.path.join('.')}: ${e.message}`)
      .join('\n');
    throw new Error(`Environment validation failed:\n${formatted}`);
  }

  _env = result.data;
  return result.data;
}

/**
 * Returns the validated environment object. Must be called after
 * `validateEnv()` has run during bootstrap.
 */
export function getEnv(): Env {
  if (_env === undefined) {
    throw new Error(
      'getEnv() called before validateEnv() — call validateEnv() in main.ts first.',
    );
  }
  return _env;
}
