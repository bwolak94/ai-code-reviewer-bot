import { z } from 'zod';

const WorkerEnvSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),

  // GitHub App
  GITHUB_APP_ID: z.string().min(1),
  GITHUB_PRIVATE_KEY: z
    .string()
    .min(100, 'GITHUB_PRIVATE_KEY appears truncated — expected a full PEM private key'),

  // Redis
  REDIS_QUEUE_URL: z.string().url(),
  REDIS_CACHE_URL: z.string().url(),

  // Database
  DATABASE_URL: z.string().url(),

  // Security — AES-256-GCM key for installation token encryption at rest (SEC-003).
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .length(64, 'TOKEN_ENCRYPTION_KEY must be 32 bytes as 64-char hex string'),

  // LLM
  ANTHROPIC_API_KEY: z.string().min(1).optional(),

  // Worker config
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(4),
  WORKER_MAX_WORKSPACE_MB: z.coerce.number().int().positive().default(512),
});

export type WorkerEnv = z.infer<typeof WorkerEnvSchema>;

let _env: WorkerEnv | undefined;

export function validateWorkerEnv(raw: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const result = WorkerEnvSchema.safeParse(raw);

  if (!result.success) {
    const formatted = result.error.errors
      .map((e) => `  ${e.path.join('.')}: ${e.message}`)
      .join('\n');
    throw new Error(`Worker environment validation failed:\n${formatted}`);
  }

  _env = result.data;
  return result.data;
}

export function getWorkerEnv(): WorkerEnv {
  if (_env === undefined) {
    throw new Error(
      'getWorkerEnv() called before validateWorkerEnv() — call validateWorkerEnv() in main.ts first.',
    );
  }
  return _env;
}
