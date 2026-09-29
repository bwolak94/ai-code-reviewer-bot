import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { decoratorMetadata: true, legacyDecorator: true },
      },
      module: { type: 'es6' },
    }),
  ],
  test: {
    globals: false,
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/main.ts', 'src/**/*.module.ts'],
      thresholds: {
        // HMAC guard coverage requirement from task-001 acceptance criteria.
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
    // Allow top-level await in ESM test files.
    pool: 'forks',
  },
});
